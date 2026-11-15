/**
 * langgraph-end — Consolidador de salida del grafo.
 * Publica el contenido del último mensaje del asistente en msg.payload y deja
 * el expediente (msg.state) en un estado final.
 *
 * Dos cuidados importantes:
 *
 * 1. Si no hay respuesta del asistente, NO toca msg.payload. Ese caso aparece
 *    en los flujos de prompt chaining que igual pasaron por un start: hay
 *    expediente, pero el LLM escribió su respuesta directamente en el
 *    mensaje. Antes se publicaba un texto vacío y se borraba el resultado.
 *
 * 2. Si el expediente ya llegó a un estado final (por ejemplo el límite de
 *    vueltas que marcará el router), no lo pisa con COMPLETED. Así el motivo
 *    real del final no se pierde.
 *
 * 3. Si el inicio tenía la memoria activada, guarda el historial en el contexto
 *    de la pestaña para la próxima corrida. Antes de guardar limpia los pedidos
 *    de herramienta que quedaron sin respuesta.
 *
 * Las reglas para leer el expediente viven en lib/state.js, compartidas con
 * los demás nodos.
 */
module.exports = function (RED) {
    const {
        lastAssistant,
        messageText,
        isTerminal,
        sanitizeForResume,
        CONVERSATION_PREFIX
    } = require("../lib/state");

    function LangGraphEndNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            try {
                if (!msg.state || !Array.isArray(msg.state.messages)) {
                    // Sin expediente: flujo que no usa el grafo. No hay nada
                    // que consolidar, así que se reenvía el mensaje tal cual.
                    node.status({ fill: "grey", shape: "dot", text: "pass-through" });
                    send(msg);
                    if (done) { done(); }
                    return;
                }

                const state = msg.state;
                const respuesta = lastAssistant(state);

                if (!respuesta) {
                    // Hay expediente pero nadie respondió todavía. Puede ser
                    // un flujo de prompt chaining donde la respuesta ya viaja
                    // en msg.payload. Reenviamos sin tocar nada para no
                    // borrar ese contenido.
                    node.status({ fill: "grey", shape: "dot", text: "sin respuesta" });
                    send(msg);
                    if (done) { done(); }
                    return;
                }

                // Publicamos el texto de la última respuesta del asistente.
                msg.payload = messageText(respuesta);

                // Solo marcamos COMPLETED si nadie había decidido ya un final
                // (por ejemplo MAX_ITERATIONS desde el router).
                if (!isTerminal(state)) {
                    state.status = "COMPLETED";
                }
                state.next_node = null;

                // Si el inicio tenía la memoria activada, guardamos el
                // historial para la próxima corrida. La clave viaja en el
                // estado, así el fin no necesita saber si la memoria estaba
                // activada ni cuál era la clave.
                let guardado = false;
                if (
                    typeof state.conversation_id === "string" &&
                    state.conversation_id &&
                    Array.isArray(state.messages)
                ) {
                    try {
                        const claveGuardado =
                            typeof state.conversation_store_key === "string" &&
                            state.conversation_store_key
                                ? state.conversation_store_key
                                : CONVERSATION_PREFIX + state.conversation_id;
                        node.context().flow.set(claveGuardado, {
                            version: state.version,
                            conversation_id: state.conversation_id,
                            messages: sanitizeForResume(state.messages),
                            updated_at: new Date().toISOString()
                        });
                        guardado = true;
                    } catch (err) {
                        // Que no se pueda guardar no debe romper la respuesta
                        // que el usuario ya tiene en la mano.
                        node.warn(
                            "langgraph-end: no se pudo guardar la conversación: " +
                            err.message
                        );
                    }
                }

                node.status({
                    fill: "green",
                    shape: "dot",
                    text: guardado ? "completed + memoria" : "completed"
                });
                send(msg);
                if (done) { done(); }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                if (done) { done(err); } else { node.error(err, msg); }
            }
        });
    }

    RED.nodes.registerType("langgraph-end", LangGraphEndNode);
};
