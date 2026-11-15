/**
 * langgraph-start — Nodo de entrada del grafo.
 * Inicializa msg.state con el contrato del proyecto:
 * { version, run_id, messages, next_node, status, iterations, max_iterations }
 * El primer mensaje se guarda en el formato estándar de LangChain para que los
 * nodos siguientes puedan reconstruirlo.
 *
 * Si la memoria está activada, busca el historial guardado en el contexto de
 * la pestaña y lo pone delante del mensaje nuevo. Así el usuario puede seguir
 * la conversación sin repetir lo anterior.
 *
 * La creación del expediente vive en lib/state.js: los tres nodos usan la
 * misma receta, así no se desincronizan cuando el contrato cambie.
 */
module.exports = function (RED) {
    const {
        createState,
        sanitizeForResume,
        CONVERSATION_PREFIX
    } = require("../lib/state");

    function LangGraphStartNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // maxIterations desde la UI (por defecto 5, mínimo 1)
        const parsed = parseInt(config.maxIterations, 10);
        node.maxIterations = Number.isInteger(parsed) && parsed > 0 ? parsed : 5;

        // ¿Continuamos la conversación anterior? Apagado por defecto: cada
        // corrida empieza limpia, como hasta ahora.
        node.memory = config.memory === true || config.memory === "true";
        // Clave para separar conversaciones. Si está vacía usamos el id del
        // nodo; así dos start distintos no se pisan.
        node.conversationKey = (config.conversationKey || "").trim();

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
                const state = createState({
                    text: text,
                    maxIterations: node.maxIterations
                });
                msg.state = state;

                if (node.memory) {
                    // Clave: msg.conversationId (útil para varios usuarios) >
                    // la configurada en el nodo > el id de este nodo.
                    const claveMensaje =
                        typeof msg.conversationId === "string"
                            ? msg.conversationId.trim()
                            : "";
                    const clave = claveMensaje || node.conversationKey || node.id;
                    const claveGuardado = CONVERSATION_PREFIX + clave;

                    const reiniciar =
                        msg.resetConversation === true ||
                        msg.resetConversation === "true";

                    state.conversation_id = clave;
                    state.conversation_store_key = claveGuardado;

                    if (reiniciar) {
                        // Borramos lo viejo: si esta corrida no llega al final,
                        // la próxima tampoco debe encontrar la conversación
                        // anterior.
                        node.context().flow.set(claveGuardado, null);
                        node.status({ fill: "blue", shape: "dot", text: "memoria reiniciada" });
                    } else {
                        const guardado = node.context().flow.get(claveGuardado);
                        if (
                            guardado &&
                            Array.isArray(guardado.messages) &&
                            guardado.messages.length > 0
                        ) {
                            // El historial guardado va primero y el mensaje
                            // nuevo del usuario se agrega al final.
                            const previos = sanitizeForResume(guardado.messages);
                            state.messages = previos.concat(state.messages);
                            node.status({
                                fill: "green",
                                shape: "dot",
                                text: "continuando (" + previos.length + " mensajes)"
                            });
                        } else {
                            node.status({ fill: "green", shape: "dot", text: "nueva conversación" });
                        }
                    }
                } else {
                    node.status({ fill: "green", shape: "dot", text: "initialized" });
                }

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
