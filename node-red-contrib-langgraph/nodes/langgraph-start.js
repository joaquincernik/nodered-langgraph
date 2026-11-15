/**
 * langgraph-start — Nodo de entrada del grafo.
 * Inicializa msg.state con el contrato del proyecto:
 * { version, run_id, messages, next_node, status, iterations, max_iterations }
 * El primer mensaje se guarda en el formato estándar de LangChain para que los
 * nodos siguientes puedan reconstruirlo.
 *
 * La creación del expediente vive en lib/state.js: los tres nodos usan la
 * misma receta, así no se desincronizan cuando el contrato cambie.
 */
module.exports = function (RED) {
    const { createState } = require("../lib/state");

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
                // Si msg.payload es objeto/number, lo convertimos a texto para
                // que el mensaje del usuario sea legible por el modelo.
                const text =
                    typeof input === "object" ? JSON.stringify(input) : String(input);

                // Cada corrida arranca con un expediente nuevo: identificador
                // propio (run_id), contador en cero y estado RUNNING.
                msg.state = createState({
                    text: text,
                    maxIterations: node.maxIterations
                });

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
