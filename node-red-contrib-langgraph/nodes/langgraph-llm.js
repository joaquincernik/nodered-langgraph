/**
 * langgraph-llm — Ejecuta la llamada al modelo de chat usando LangChain.
 * Resuelve el modelo con initChatModel (formato "proveedor:modelo", ej.
 * "groq:openai/gpt-oss-120b", "openai:gpt-4o-mini"), restaurando los
 * mensajes serializados en msg.state con mapStoredMessagesToChatMessages y
 * añadiendo la respuesta del asistente al historial.
 */
module.exports = function (RED) {
    const { initChatModel } = require("langchain/chat_models/universal");
    const {
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

            if (!msg.state || !Array.isArray(msg.state.messages)) {
                const err = new Error(
                    "langgraph-llm: msg.state.messages no existe. Conecta un nodo langgraph-start antes."
                );
                node.status({ fill: "red", shape: "ring", text: "state missing" });
                if (done) { done(err); } else { node.error(err, msg); }
                return;
            }

            if (!node.modelString) {
                const err = new Error(
                    "langgraph-llm: El parámetro 'model' es obligatorio. Configura el proveedor y modelo (ej. 'groq:openai/gpt-oss-120b')."
                );
                node.status({ fill: "red", shape: "ring", text: "model unconfigured" });
                if (done) { done(err); } else { node.error(err, msg); }
                return;
            }

            node.status({ fill: "yellow", shape: "ring", text: "invoking" });

            // Restaura el historial serializado -> instancias BaseMessage de LangChain
            const messages = mapStoredMessagesToChatMessages(msg.state.messages);

            node._getModel()
                .then(function (model) {
                    return model.invoke(messages);
                })
                .then(function (response) {
                    // response es un AIMessage; lo serializamos y lo añadimos al estado
                    msg.state.messages.push(response.toDict());
                    msg.state.iterations = (msg.state.iterations || 0) + 1;
                    msg.state.next_node = "end";
                    node.status({
                        fill: "green",
                        shape: "dot",
                        text: "iter " + msg.state.iterations
                    });
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
