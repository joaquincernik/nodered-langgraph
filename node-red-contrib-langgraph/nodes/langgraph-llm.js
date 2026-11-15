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
    const crypto = require("crypto");
    const { initChatModel } = require("langchain/chat_models/universal");
    const {
        HumanMessage,
        SystemMessage,
        AIMessage,
        mapStoredMessagesToChatMessages
    } = require("@langchain/core/messages");
    const { assertState, appendMessage } = require("../lib/state");

    // Los nombres de herramienta viajan al proveedor como nombres de función.
    // Si tuvieran espacios o símbolos raros, el pedido se rechaza. Mejor
    // detectarlo acá y avisar que fallar en la llamada.
    const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

    /**
     * Saca el dato de entrada de lo que devolvió el modelo. La convención del
     * proyecto es un único campo "input", pero algunos modelos usan otro
     * nombre; en ese caso tomamos el primer texto que encontremos.
     */
    function toolInputFromArgs(args) {
        if (typeof args === "string") {
            return args;
        }
        if (!args || typeof args !== "object") {
            return "";
        }
        if (typeof args.input === "string") {
            return args.input;
        }
        if (args.input !== undefined && args.input !== null) {
            return String(args.input);
        }
        const valores = Object.values(args);
        for (let i = 0; i < valores.length; i++) {
            if (typeof valores[i] === "string") {
                return valores[i];
            }
        }
        return "";
    }

    /**
     * ¿El error tiene pinta de "este proveedor no sabe usar herramientas"?
     * Se usa para reintentar una vez sin ellas, en vez de romper el flujo.
     */
    function looksLikeToolUnsupported(err) {
        const texto = String(err && err.message ? err.message : err).toLowerCase();
        const mencionaHerramientas = /tool|function/.test(texto);
        const mencionaFaltaDeSoporte =
            /not support|unsupported|does not support|not allowed|not available|unknown parameter|invalid parameter/.test(texto);
        return mencionaHerramientas && mencionaFaltaDeSoporte;
    }

    /**
     * Copia el mensaje del modelo sin pedidos de herramienta. Se usa cuando
     * no vamos a ejecutarlas: guardar un pedido sin su respuesta haría que
     * el proveedor rechace la próxima llamada.
     */
    function sinHerramientas(response) {
        const kwargs = Object.assign({}, response.additional_kwargs || {});
        delete kwargs.tool_calls;
        return new AIMessage({
            content: response.content,
            additional_kwargs: kwargs,
            response_metadata: response.response_metadata || {},
            id: response.id,
            usage_metadata: response.usage_metadata
        });
    }

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
        // ¿Le presentamos al modelo las herramientas de esta pestaña?
        // Se puede apagar para proveedores que no las soportan o para
        // aislar un problema sin desarmar el flujo.
        node.useTools = config.useTools !== false && config.useTools !== "false";
        // Para no repetir el mismo aviso en cada vuelta.
        node._toolsLogged = false;
        node._herramientasInvalidas = {};

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

        /**
         * Busca las herramientas que viven en la misma pestaña que este nodo.
         * La regla es simple a propósito: si arrastraste la herramienta al
         * lado del agente, pertenece a ese agente. Nada de nombres de grupo
         * ni configuración extra.
         */
        node._discoverTools = function () {
            const encontradas = [];
            const vistos = {};
            if (typeof RED.nodes.eachNode !== "function") {
                return encontradas;
            }
            RED.nodes.eachNode(function (n) {
                if (!n || n.type !== "langgraph-tool" || n.z !== node.z) {
                    return;
                }
                const nombre = typeof n.toolName === "string" ? n.toolName.trim() : "";
                if (!nombre) {
                    return;
                }
                if (!TOOL_NAME_PATTERN.test(nombre)) {
                    if (!node._herramientasInvalidas[nombre]) {
                        node._herramientasInvalidas[nombre] = true;
                        node.warn(
                            "langgraph-llm: la herramienta '" + nombre +
                            "' tiene un nombre inválido (letras, números, guion o guion bajo). Se ignora."
                        );
                    }
                    return;
                }
                if (vistos[nombre]) {
                    return;
                }
                vistos[nombre] = true;
                encontradas.push({
                    name: nombre,
                    description: String(n.description || "").trim() || ("Herramienta " + nombre),
                    parameters: {
                        type: "object",
                        properties: {
                            input: {
                                type: "string",
                                description: "Dato que necesita la herramienta"
                            }
                        },
                        required: ["input"]
                    }
                });
            });
            return encontradas;
        };

        /**
         * Convierte las herramientas al formato que entienden los proveedores
         * (el mismo que usa OpenAI para "function calling").
         */
        node._toolSchemas = function (tools) {
            return tools.map(function (t) {
                return {
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters
                    }
                };
            });
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

            // Herramientas nativas: solo en modo grafo y si están activadas.
            // Se buscan en cada llamada porque son parte del flujo desplegado.
            const herramientas =
                !chained && node.useTools ? node._discoverTools() : [];
            const esquemas = node._toolSchemas(herramientas);
            let herramientasActivas = esquemas.length > 0;

            if (herramientas.length && !node._toolsLogged) {
                node.log(
                    "herramientas disponibles en esta pestaña: " +
                    herramientas.map(function (t) { return t.name; }).join(", ")
                );
                node._toolsLogged = true;
            }

            node._getModel()
                .then(function (model) {
                    let ejecutor = model;
                    if (esquemas.length > 0) {
                        try {
                            ejecutor = model.bindTools(esquemas);
                        } catch (err) {
                            herramientasActivas = false;
                            node.warn(
                                "langgraph-llm: el proveedor no aceptó las herramientas (" +
                                err.message + "). Se sigue sin ellas."
                            );
                            ejecutor = model;
                        }
                    }
                    return ejecutor.invoke(messages).catch(function (err) {
                        // Algunos proveedores solo avisan al momento de llamar.
                        // Reintentamos una vez sin herramientas para no cortar
                        // el grafo por una limitación del proveedor.
                        if (herramientasActivas && looksLikeToolUnsupported(err)) {
                            herramientasActivas = false;
                            node.warn(
                                "langgraph-llm: el proveedor no soporta herramientas (" +
                                err.message + "). Se reintenta sin ellas."
                            );
                            return model.invoke(messages);
                        }
                        throw err;
                    });
                })
                .then(function (response) {
                    if (chained) {
                        // Modo chaining: la respuesta va al payload y el userPrompt queda intacto
                        msg.payload = response.text;
                        node.status({ fill: "green", shape: "dot", text: "chained" });
                    } else {
                        const llamadas =
                            herramientasActivas && Array.isArray(response.tool_calls)
                                ? response.tool_calls
                                : [];

                        if (llamadas.length > 0) {
                            const primera = llamadas[0];
                            const conocida = herramientas.some(function (t) {
                                return t.name === primera.name;
                            });

                            if (!conocida) {
                                // El modelo inventó una herramienta. No la
                                // ejecutamos y guardamos la respuesta limpia:
                                // un pedido sin respuesta rompería la próxima
                                // llamada al proveedor.
                                node.warn(
                                    "langgraph-llm: el modelo pidió la herramienta desconocida '" +
                                    primera.name + "'. Se ignora y se termina."
                                );
                                appendMessage(state, sinHerramientas(response));
                                state.iterations = (state.iterations || 0) + 1;
                                state.next_node = "end";
                                node.status({
                                    fill: "grey",
                                    shape: "dot",
                                    text: "herramienta desconocida"
                                });
                            } else {
                                // Si el proveedor no mandó identificador, le
                                // ponemos uno para poder emparejar el resultado.
                                if (!primera.id) {
                                    primera.id = "call_" + crypto.randomUUID();
                                }

                                let guardar = response;
                                if (llamadas.length > 1) {
                                    // Ejecutamos una sola. Guardamos solo esa
                                    // para que el proveedor no espere respuestas
                                    // que no vamos a dar.
                                    node.warn(
                                        "langgraph-llm: el modelo pidió " + llamadas.length +
                                        " herramientas; se ejecuta solo '" + primera.name + "'."
                                    );
                                    const kwargs = Object.assign({}, response.additional_kwargs || {});
                                    delete kwargs.tool_calls;
                                    guardar = new AIMessage({
                                        content: response.content,
                                        tool_calls: [primera],
                                        additional_kwargs: kwargs,
                                        response_metadata: response.response_metadata || {},
                                        id: response.id,
                                        usage_metadata: response.usage_metadata
                                    });
                                }

                                appendMessage(state, guardar);
                                state.iterations = (state.iterations || 0) + 1;
                                state.tool_request = {
                                    name: primera.name,
                                    input: toolInputFromArgs(primera.args),
                                    id: primera.id
                                };
                                state.next_node = "tool";
                                node.status({
                                    fill: "blue",
                                    shape: "dot",
                                    text: "iter " + state.iterations + " → tool (" + primera.name + ")"
                                });
                            }
                        } else {
                            // Sin pedido de herramienta: es una respuesta normal.
                            // Si el proveedor igual devolvió pedidos (por ejemplo,
                            // porque las herramientas estaban apagadas), los
                            // quitamos antes de guardar.
                            const teniaPedidos =
                                (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) ||
                                (response.additional_kwargs && response.additional_kwargs.tool_calls);
                            let guardar = response;
                            if (teniaPedidos) {
                                node.warn(
                                    "langgraph-llm: se ignoró un pedido de herramienta porque las herramientas no están activas."
                                );
                                guardar = sinHerramientas(response);
                            }

                            appendMessage(state, guardar);
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
