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
    const { assertState, appendMessage } = require("../lib/state");

    // Cada proveedor tiene su propia variable de entorno "de toda la vida".
    // Las listamos para no depender de la magia interna de LangChain: así el
    // nodo sabe de dónde sacó la clave y puede contarlo en el log.
    const PROVIDER_ENV_VARS = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        groq: "GROQ_API_KEY",
        mistralai: "MISTRAL_API_KEY",
        mistral: "MISTRAL_API_KEY",
        cohere: "COHERE_API_KEY",
        google: "GOOGLE_API_KEY",
        google_genai: "GOOGLE_API_KEY",
        google_vertexai: "GOOGLE_API_KEY",
        azure_openai: "AZURE_OPENAI_API_KEY",
        fireworks: "FIREWORKS_API_KEY",
        together: "TOGETHER_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        xai: "XAI_API_KEY",
        perplexity: "PERPLEXITY_API_KEY"
    };

    // "groq:openai/gpt-oss-120b" -> "groq"; sin prefijo -> ""
    function providerOf(modelString) {
        const coincidencia = /^([a-z0-9_]+):/i.exec(modelString || "");
        return coincidencia ? coincidencia[1].toLowerCase() : "";
    }

    /**
     * Decide qué clave usar, en este orden:
     *   1. la que se cargó en el nodo (lo más explícito),
     *   2. LLM_API_KEY (una sola variable para cualquier proveedor),
     *   3. la variable propia del proveedor (GROQ_API_KEY, OPENAI_API_KEY, ...).
     *
     * Devuelve también el origen, para poder avisarlo en el log sin mostrar
     * nunca la clave. Si no encuentra nada, devuelve vacío y LangChain hará
     * su propio intento (útil para servidores locales que no piden clave).
     */
    function resolveApiKey(modelString, credentialKey) {
        if (credentialKey) {
            return { key: credentialKey, source: "credencial del nodo" };
        }
        if (process.env.LLM_API_KEY) {
            return { key: process.env.LLM_API_KEY, source: "LLM_API_KEY" };
        }
        const provider = providerOf(modelString);
        if (!provider) {
            return { key: "", source: "sin clave (el modelo no indica proveedor)" };
        }
        const varName =
            PROVIDER_ENV_VARS[provider] || provider.toUpperCase() + "_API_KEY";
        if (process.env[varName]) {
            return { key: process.env[varName], source: varName };
        }
        return { key: "", source: "sin clave (se probará " + varName + ")" };
    }

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
        // A dónde va el mensaje después de esta respuesta. El router lo lee
        // para decidir por qué salida mandarlo. Vacío equivale a "end".
        node.nextNode = (config.nextNode || "").trim() || "end";

        // De dónde sale la clave: credencial del nodo > LLM_API_KEY > variable
        // propia del proveedor. Lo dejamos anotado en el log (sin mostrar la
        // clave) para que un error 401 no sea un misterio.
        const clave = resolveApiKey(
            node.modelString,
            node.credentials && node.credentials.apiKey
        );
        node.apiKey = clave.key;
        node.apiKeySource = clave.source;
        node.log(
            "modelo " +
            (node.modelString || "(sin configurar)") +
            " | auth: " +
            node.apiKeySource
        );

        // initChatModel es async: se resuelve en el primer input y se cachea
        // (una instancia por nodo, patron LangChain). Si falla, se limpia el
        // cache para reintentar en el siguiente mensaje.
        node._modelPromise = null;
        node._getModel = function () {
            if (!node._modelPromise) {
                const params = {
                    temperature: node.temperature
                };
                
                // Si no encontramos clave, no pasamos el campo: así LangChain
                // puede intentar su propio camino (o el servidor local no
                // necesita ninguna).
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

            // En modo grafo necesitamos el expediente. Si no está, el helper
            // nos da un error que dice exactamente qué conectar.
            let state = null;
            if (!chained) {
                try {
                    state = assertState(
                        msg,
                        "langgraph-llm",
                        "Si querés usar prompt chaining, definí msg.userPrompt."
                    );
                } catch (err) {
                    node.status({ fill: "red", shape: "ring", text: "no state" });
                    if (done) { done(err); } else { node.error(err, msg); }
                    return;
                }
            }

            node.status({ fill: "yellow", shape: "ring", text: "invoking" });

            // Chaining: cada llamada es independiente (sin historial).
            // Grafo: restaura el historial serializado -> BaseMessage de LangChain.
            let messages = chained
                ? [new HumanMessage(chainedPrompt)]
                : mapStoredMessagesToChatMessages(state.messages);

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
                        // Modo grafo: response es un AIMessage; lo guardamos en
                        // el historial con el mismo formato que usa start.
                        appendMessage(state, response);
                        state.iterations = (state.iterations || 0) + 1;

                        // Destino para el router. Manda lo que venga en el
                        // mensaje (útil para decidir sobre la marcha); si no,
                        // lo configurado en el nodo; si tampoco hay, se
                        // termina. Así el grafo nunca queda sin salida.
                        const pedido =
                            typeof msg.nextNode === "string"
                                ? msg.nextNode.trim()
                                : "";
                        state.next_node = pedido || node.nextNode || "end";

                        node.status({
                            fill: "green",
                            shape: "dot",
                            text: "iter " + state.iterations + " → " + state.next_node
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
