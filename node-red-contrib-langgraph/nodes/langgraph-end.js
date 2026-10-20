/**
 * langgraph-end — Consolidador de salida del grafo.
 * Marca el estado como COMPLETED y extrae el contenido del último mensaje
 * del asistente (AIMessage serializado) hacia msg.payload para su consumo
 * por el resto del flujo (debug, http response, etc).
 * msg.state completo se conserva siempre en el mensaje.
 */
module.exports = function (RED) {
    function LangGraphEndNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            try {
                if (!msg.state || !Array.isArray(msg.state.messages)) {
                    const err = new Error(
                        "langgraph-end: msg.state.messages no existe. Conecta un nodo langgraph-start antes."
                    );
                    node.status({ fill: "red", shape: "ring", text: "state missing" });
                    if (done) { done(err); } else { node.error(err, msg); }
                    return;
                }

                // Busca el último mensaje del asistente serializado.
                // Formato LangChain: { type: "ai", data: { content, ... } }
                const messages = msg.state.messages;
                let lastAssistant = null;
                for (let i = messages.length - 1; i >= 0; i--) {
                    const m = messages[i];
                    const type = m && (m.type || m.role);
                    if (type === "ai" || type === "assistant") {
                        lastAssistant = m;
                        break;
                    }
                }

                const content = lastAssistant
                    ? (lastAssistant.data ? lastAssistant.data.content : lastAssistant.content)
                    : "";

                msg.payload = content;
                msg.state.status = "COMPLETED";
                msg.state.next_node = null;

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
