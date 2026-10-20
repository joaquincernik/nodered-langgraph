/**
 * langgraph-start — Nodo de entrada del grafo.
 * Inicializa msg.state con el contrato definido en el README:
 * { state: { messages, next_node, status, iterations, max_iterations } }
 * El primer mensaje se serializa con el formato estándar de LangChain
 * (via HumanMessage.toDict()) para poder ser restaurado con
 * mapStoredMessagesToChatMessage en los nodos downstream.
 */
module.exports = function (RED) {
    const { HumanMessage } = require("@langchain/core/messages");

    function LangGraphStartNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // maxIterations desde la UI (por defecto 5, mínimo 1)
        const parsed = parseInt(config.maxIterations, 10);
        node.maxIterations = Number.isInteger(parsed) && parsed > 0 ? parsed : 5;

        node.on("input", function (msg, send, done) {
            // send() retrocompatible con Node-RED < 1.0
            send = send || function () { node.send.apply(node, arguments); };

            try {
                const input =
                    msg.payload !== undefined && msg.payload !== null && msg.payload !== ""
                        ? msg.payload
                        : " ";
                // Si msg.payload es objeto/number, lo stringifyamos para el contenido del mensaje
                const text =
                    typeof input === "object" ? JSON.stringify(input) : String(input);

                const userMessage = new HumanMessage(text);

                // Estado inicial limpio (se sobreescribe si ya existia, para arrancar el grafo)
                msg.state = {
                    // toDict() -> { type: "human", data: { content, ... } }
                    messages: [userMessage.toDict()],
                    next_node: "llm",
                    status: "RUNNING",
                    iterations: 0,
                    max_iterations: node.maxIterations
                };

                node.status({ fill: "green", shape: "dot", text: "initialized" });
                send(msg);
                if (done) { done(); }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                if (done) { done(err); } else { node.error(err, msg); }
            }
        });
    }

    RED.nodes.registerType("langgraph-start", LangGraphStartNode);
};
