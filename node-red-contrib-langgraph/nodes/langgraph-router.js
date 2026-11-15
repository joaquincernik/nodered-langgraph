/**
 * langgraph-router — El nodo que decide por dónde sigue el grafo.
 *
 * Lee el expediente (msg.state) y mira dos cosas:
 *   - cuántas vueltas se dieron y cuál era el límite (para no girar para siempre),
 *   - a dónde pidió ir el nodo anterior (state.next_node).
 *
 * Tiene tres salidas fijas, siempre en este orden:
 *   0 -> end   (terminar)
 *   1 -> llm   (volver a pensar)
 *   2 -> tool  (ejecutar una herramienta, cuando exista)
 *
 * El orden importa: si se cambia, hay que actualizar la ayuda y las demos.
 */
module.exports = function (RED) {
    const { assertState, isTerminal } = require("../lib/state");

    const PUERTO_END = 0;
    const PUERTO_LLM = 1;
    const PUERTO_TOOL = 2;

    function LangGraphRouterNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            try {
                const state = assertState(msg, "langgraph-router");

                const vueltas = Number(state.iterations) || 0;
                const limite = Number(state.max_iterations) || 0;

                // 1. El guardia va primero. Aunque el modelo quiera seguir,
                //    si ya se gastaron las vueltas permitidas, se corta acá.
                //    Así el bucle no puede colgar Node-RED.
                if (limite > 0 && vueltas >= limite) {
                    state.status = "MAX_ITERATIONS";
                    state.next_node = null;
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "límite " + vueltas + "/" + limite
                    });
                    node.warn(
                        "langgraph-router: se alcanzó el límite de " +
                        limite +
                        " vueltas. El mensaje sale por 'end'."
                    );
                    send([msg, null, null]);
                    if (done) { done(); }
                    return;
                }

                // 2. Si otro nodo ya decidió un final, no lo damos más vueltas.
                if (isTerminal(state)) {
                    node.status({ fill: "green", shape: "dot", text: "→ end (final)" });
                    send([msg, null, null]);
                    if (done) { done(); }
                    return;
                }

                // 3. A dónde pidió ir el nodo anterior.
                const destino =
                    typeof state.next_node === "string"
                        ? state.next_node.trim().toLowerCase()
                        : "";

                if (destino === "llm") {
                    node.status({ fill: "yellow", shape: "dot", text: "→ llm" });
                    send([null, msg, null]);
                } else if (destino === "tool") {
                    node.status({ fill: "blue", shape: "dot", text: "→ tool" });
                    send([null, null, msg]);
                } else if (destino === "end" || destino === "") {
                    // Sin destino también se termina: es el final seguro.
                    node.status({ fill: "green", shape: "dot", text: "→ end" });
                    send([msg, null, null]);
                } else {
                    // Destino desconocido: nunca dejamos el mensaje sin salida.
                    // Lo mandamos a end y dejamos el aviso para poder corregir
                    // la configuración.
                    state.next_node = "end";
                    node.status({ fill: "grey", shape: "dot", text: "destino desconocido" });
                    node.warn(
                        "langgraph-router: destino desconocido '" +
                        destino +
                        "'. El mensaje sale por 'end'."
                    );
                    send([msg, null, null]);
                }

                if (done) { done(); }
            } catch (err) {
                node.status({ fill: "red", shape: "ring", text: "error" });
                if (done) { done(err); } else { node.error(err, msg); }
            }
        });
    }

    RED.nodes.registerType("langgraph-router", LangGraphRouterNode);
};
