/**
 * langgraph-llm — Ejecuta la llamada al modelo de chat usando LangChain.
 * Resuelve el modelo con initChatModel (formato "proveedor:modelo", ej.
 * "groq:openai/gpt-oss-120b", "openai:gpt-4o-mini").
 *
 * Dos modos:
 * - Prompt chaining: si msg.userPrompt es un string no vacío, se usa como
 *   mensaje del usuario y la respuesta se escribe en msg.payload.
 *   msg.userPrompt no se modifica y msg.state se ignora.
 * - Grafo LangGraph: si no, restaura msg.state.messages con
 *   mapStoredMessagesToChatMessages y añade la respuesta al historial.
 */
module.exports = function (RED) {
    const { initChatModel } = require("langchain/chat_models/universal");
    const {
        HumanMessage,
        SystemMessage,
        mapStoredMessagesToChatMessages
    } = require("@langchain/core/messages");

    function LangGraphLLMNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.modelString = (config.model || "").trim();
        node.temperature = Number(config.temperature);
        if (Number.isNaN(node.temperature)) {
            node.temperature = 0.7;
        }
        // baseURL
        node.baseUrl = (config.baseUrl || "").trim();
        // system prompt configurado en el nodo (efimero: no se guarda en msg.state)
        node.systemPrompt = (config.systemPrompt || "").trim();

        // apiKey via credenciales del nodo o variable de entorno segun proveedor
        const envKey = process.env.LLM_API_KEY;
        node.apiKey =
            (node.credentials && node.credentials.apiKey) || envKey || "";

        // initChatModel es async: se resuelve en el primer input y se cachea
        // (una instancia por nodo, patron LangChain). Si falla, se limpia el
        // cache para reintentar en el siguiente mensaje.
        node._modelPromise = null;
        node._getModel = function () {
            if (!node._modelPromise) {
                const params = {
                    temperature: node.temperature
                };
                
                if (node.apiKey) {
                    params.apiKey = node.apiKey;
                }
                
                if (node.baseUrl) {
                    params.configuration = { baseURL: node.baseUrl };
                }
                node._modelPromise = initChatModel(node.modelString, params).catch(
                    function (err) {
                        node._modelPromise = null;
                        throw err;
                    }
                );
            }
            return node._modelPromise;
        };

        node.on("input", function (msg, send, done) {
            send = send || function () { node.send.apply(node, arguments); };

            if (!node.modelString) {
                const err = new Error(
                    "langgraph-llm: El parámetro 'model' es obligatorio. Configura el proveedor y modelo (ej. 'groq:openai/gpt-oss-120b')."
                );
                node.status({ fill: "red", shape: "ring", text: "model unconfigured" });
                if (done) { done(err); } else { node.error(err, msg); }
                return;
            }

            // Modo prompt chaining: msg.userPrompt -> respuesta en msg.payload
            const chainedPrompt =
                typeof msg.userPrompt === "string" ? msg.userPrompt.trim() : "";
            const chained = chainedPrompt.length > 0;
            const hasState = msg.state && Array.isArray(msg.state.messages);

            if (!chained && !hasState) {
                const err = new Error(
                    "langgraph-llm: el mensaje no trae msg.userPrompt ni msg.state.messages. " +
                    "Para prompt chaining definí msg.userPrompt; para el grafo LangGraph usá un nodo langgraph-start."
                );
                node.status({ fill: "red", shape: "ring", text: "no prompt" });
                if (done) { done(err); } else { node.error(err, msg); }
                return;
            }

            node.status({ fill: "yellow", shape: "ring", text: "invoking" });

            // Chaining: cada llamada es independiente (sin historial).
            // Grafo: restaura el historial serializado -> BaseMessage de LangChain.
            let messages = chained
                ? [new HumanMessage(chainedPrompt)]
                : mapStoredMessagesToChatMessages(msg.state.messages);

            // System prompt (efimero: solo para esta invocacion, no se persiste en el estado)
            // Precedencia: msg.systemPrompt > system ya presente en el estado > config del nodo
            const runtimePrompt =
                typeof msg.systemPrompt === "string" ? msg.systemPrompt.trim() : "";
            if (runtimePrompt) {
                messages = messages.filter(function (m) { return m.getType() !== "system"; });
                messages.unshift(new SystemMessage(runtimePrompt));
            } else if (
                node.systemPrompt &&
                !messages.some(function (m) { return m.getType() === "system"; })
            ) {
                messages.unshift(new SystemMessage(node.systemPrompt));
            }

            node._getModel()
                .then(function (model) {
                    return model.invoke(messages);
                })
                .then(function (response) {
                    if (chained) {
                        // Modo chaining: la respuesta va al payload y el userPrompt queda intacto
                        msg.payload = response.text;
                        node.status({ fill: "green", shape: "dot", text: "chained" });
                    } else {
                        // Modo grafo: response es un AIMessage; lo serializamos al estado
                        msg.state.messages.push(response.toDict());
                        msg.state.iterations = (msg.state.iterations || 0) + 1;
                        msg.state.next_node = "end";
                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: "iter " + msg.state.iterations
                        });
                    }
                    send(msg);
                    if (done) { done(); }
                })
                .catch(function (err) {
                    node.status({ fill: "red", shape: "ring", text: "error" });
                    if (done) { done(err); } else { node.error(err, msg); }
                });
        });
    }

    RED.nodes.registerType("langgraph-llm", LangGraphLLMNode, {
        credentials: {
            apiKey: { type: "password" }
        }
    });
};
