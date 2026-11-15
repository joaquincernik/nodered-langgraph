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
 * Las reglas para leer el expediente viven en lib/state.js, compartidas con
 * los demás nodos.
 */
module.exports = function (RED) {
    const { lastAssistant, messageText, isTerminal } = require("../lib/state");

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

                node.status({ fill: "green", shape: "dot", text: "completed" });
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
