/**
 * langgraph-tool — Puente entre el agente y un flujo de Node-RED.
 *
 * La idea del proyecto: una "herramienta" no es código especial, es un flujo
 * normal de Node-RED que sabe responder algo. Este nodo le pasa el pedido a
 * ese flujo y devuelve la respuesta al modelo.
 *
 * ¿Cómo se hablan?
 *   1. El agente anota en el expediente (msg.state.tool_request) qué
 *      herramienta quiere usar y con qué dato. Lo hace el nodo LLM cuando
 *      el modelo pide una herramienta de forma nativa; también se puede
 *      armar a mano con un nodo Function o un Change.
 *   2. El router manda el mensaje por su salida "tool".
 *   3. Este nodo ve el pedido, llama al flujo por HTTP y guarda la respuesta
 *      en el expediente como mensaje de herramienta (con su identificador)
 *      o como mensaje de usuario si el pedido vino del modo manual.
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
    const { HumanMessage, ToolMessage } = require("@langchain/core/messages");

    function LangGraphToolNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // Nombre con el que el agente pide esta herramienta.
        node.toolName = (config.toolName || "").trim();
        // Texto que lee el modelo para saber cuándo conviene usar esta
        // herramienta. Sin descripción, el modelo igual la ve, pero elige
        // mucho mejor si le explicamos para qué sirve.
        node.toolDescription = (config.description || "").trim();
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

            // Cómo se guarda el resultado depende de cómo llegó el pedido:
            //   - con "id": el modelo lo pidió de forma nativa y espera un
            //     mensaje de herramienta identificado. Si guardáramos otra
            //     cosa, el proveedor rechazaría la próxima llamada.
            //   - sin "id": el pedido se armó a mano (Function/Change). Se
            //     guarda como mensaje de usuario, que funciona con todos.
            const guardarResultado = function (texto) {
                if (pedido.id) {
                    appendMessage(state, new ToolMessage({
                        content: texto,
                        tool_call_id: pedido.id,
                        name: node.toolName
                    }));
                } else {
                    appendMessage(state, new HumanMessage(
                        '[Resultado de la herramienta "' + node.toolName + '"] ' + texto
                    ));
                }
            };

            const guardarFallo = function (texto) {
                if (pedido.id) {
                    appendMessage(state, new ToolMessage({
                        content:
                            'La herramienta "' + node.toolName + '" falló: ' + texto +
                            ". No vuelvas a pedir esta herramienta; respondé al usuario " +
                            "explicando que el dato no está disponible.",
                        tool_call_id: pedido.id,
                        name: node.toolName
                    }));
                } else {
                    appendMessage(state, new HumanMessage(
                        '[La herramienta "' + node.toolName + '" falló] ' + texto
                    ));
                }
            };

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
                // Al flujo le mandamos solo lo que necesita. El identificador
                // es un asunto interno entre el modelo y el grafo.
                opciones.body = JSON.stringify({
                    name: pedido.name,
                    input: pedido.input || ""
                });
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
                    guardarResultado(texto);

                    state.next_node = "llm";
                    node.status({ fill: "green", shape: "dot", text: "ok" });
                    send(msg);
                    if (done) { done(); }
                })
                .catch(function (err) {
                    // Si la herramienta falla, no cortamos el grafo: se lo
                    // contamos al modelo para que pueda explicarlo o intentar
                    // otra cosa.
                    guardarFallo(err.message);

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
