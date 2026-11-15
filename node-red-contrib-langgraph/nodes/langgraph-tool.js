/**
 * langgraph-tool — Puente entre el agente y un flujo de Node-RED.
 *
 * La idea del proyecto: una "herramienta" no es código especial, es un flujo
 * normal de Node-RED que sabe responder algo. Este nodo le pasa el pedido a
 * ese flujo y devuelve la respuesta al modelo.
 *
 * ¿Cómo se hablan?
 *   1. El agente anota en el expediente (msg.state.tool_request) qué
 *      herramienta quiere usar y con qué dato. Eso lo puede hacer un nodo
 *      Function, un Change o el propio LLM con una convención de texto.
 *   2. El router manda el mensaje por su salida "tool".
 *   3. Este nodo ve el pedido, llama al flujo por HTTP y guarda la respuesta
 *      en el expediente como si fuera un mensaje más.
 *   4. Deja el destino en "llm" para que el modelo lea el resultado y
 *      responda.
 *
 * ¿Por qué HTTP y no otra cosa?
 * Porque es la forma más simple y estable de llamar a otro flujo desde
 * Node-RED, y además deja la herramienta desacoplada: se puede probar sola
 * con curl, usar desde otro lado, o reemplazar sin tocar el agente.
 */
module.exports = function (RED) {
    const { assertState, appendMessage } = require("../lib/state");
    const { HumanMessage } = require("@langchain/core/messages");

    function LangGraphToolNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Nombre con el que el agente pide esta herramienta.
        node.toolName = (config.toolName || "").trim();
        // Dirección del flujo que hace el trabajo (por ejemplo
        // http://localhost:1880/tool/clima).
        node.url = (config.url || "").trim();
        node.method = (config.method || "POST").toUpperCase();

        const tiempo = parseInt(config.timeout, 10);
        node.timeout = Number.isInteger(tiempo) && tiempo > 0 ? tiempo : 15000;

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            let state;
            try {
                state = assertState(msg, "langgraph-tool");
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                if (done) { done(err); } else { node.error(err, msg); }
                return;
            }

            const pedido = state.tool_request;

            // Si el pedido no es para esta herramienta, dejamos pasar el
            // mensaje sin tocarlo. Así se pueden encadenar varias herramientas
            // y cada una atiende solo lo suyo.
            if (!pedido || pedido.name !== node.toolName) {
                send(msg);
                if (done) { done(); }
                return;
            }

            if (!node.url) {
                const err = new Error(
                    "langgraph-tool: falta la URL del flujo que hace de herramienta."
                );
                node.status({ fill: "red", shape: "ring", text: "falta URL" });
                if (done) { done(err); } else { node.error(err, msg); }
                return;
            }

            // Ya tomamos el pedido: lo borramos para que no se ejecute dos
            // veces si hay más herramientas encadenadas detrás.
            delete state.tool_request;

            node.status({ fill: "blue", shape: "ring", text: "llamando a " + node.toolName });

            let direccion = node.url;
            const opciones = {
                method: node.method,
                // Si el flujo no contesta a tiempo, no dejamos el grafo colgado.
                signal: AbortSignal.timeout(node.timeout)
            };

            if (node.method === "GET") {
                const separador = direccion.indexOf("?") === -1 ? "?" : "&";
                direccion += separador + "input=" + encodeURIComponent(pedido.input || "");
            } else {
                opciones.headers = { "Content-Type": "application/json" };
                opciones.body = JSON.stringify(pedido);
            }

            fetch(direccion, opciones)
                .then(function (respuesta) {
                    if (!respuesta.ok) {
                        return respuesta.text().then(function (detalle) {
                            throw new Error(
                                "el flujo respondió " + respuesta.status + ": " +
                                detalle.slice(0, 200)
                            );
                        });
                    }
                    const tipo = respuesta.headers.get("content-type") || "";
                    if (tipo.indexOf("application/json") !== -1) {
                        return respuesta.json().then(function (datos) {
                            // Convención: si el flujo devuelve { output: "..." },
                            // usamos ese texto. Si no, pasamos todo el JSON.
                            if (datos && typeof datos.output === "string") {
                                return datos.output;
                            }
                            return JSON.stringify(datos);
                        });
                    }
                    return respuesta.text();
                })
                .then(function (resultado) {
                    const texto = String(resultado || "").trim() || "(sin respuesta)";

                    // Guardamos el resultado como un mensaje más del historial.
                    // Usamos un mensaje "human" a propósito: algunos proveedores
                    // solo aceptan mensajes de herramienta cuando el modelo pidió
                    // la herramienta a su manera. Así funciona con todos.
                    appendMessage(state, new HumanMessage(
                        '[Resultado de la herramienta "' + node.toolName + '"] ' + texto
                    ));

                    state.next_node = "llm";
                    node.status({ fill: "green", shape: "dot", text: "ok" });
                    send(msg);
                    if (done) { done(); }
                })
                .catch(function (err) {
                    // Si la herramienta falla, no cortamos el grafo: se lo
                    // contamos al modelo para que pueda explicarlo o intentar
                    // otra cosa.
                    appendMessage(state, new HumanMessage(
                        '[La herramienta "' + node.toolName + '" falló] ' + err.message
                    ));

                    state.next_node = "llm";
                    node.status({ fill: "red", shape: "dot", text: "falló" });
                    node.warn("langgraph-tool " + node.toolName + ": " + err.message);
                    send(msg);
                    if (done) { done(); }
                });
        });
    }

    RED.nodes.registerType("langgraph-tool", LangGraphToolNode);
};
