/**
 * lib/state.js — Las piezas comunes del "expediente" que viaja entre nodos.
 *
 * ¿Por qué existe este archivo?
 * Todos los nodos del grafo necesitan hacer las mismas tres cosas:
 *   1. revisar que el expediente (msg.state) exista y tenga la lista de mensajes,
 *   2. agregarle un mensaje nuevo,
 *   3. buscar la última respuesta del asistente.
 *
 * Si cada nodo lo escribe a su manera, tarde o temprano uno se olvida de algo
 * y los nodos dejan de entenderse entre sí. Acá vive una sola versión de esas
 * reglas, así el próximo nodo (por ejemplo el router) sale más corto y hace
 * exactamente lo mismo que los anteriores.
 */
const crypto = require("crypto");
const { HumanMessage } = require("@langchain/core/messages");

// Versión del formato del expediente. Hoy es 1.
// Sirve para el día que el formato cambie: un nodo podrá reconocer un estado
// viejo y adaptarlo en vez de fallar sin explicación.
const STATE_VERSION = 1;

// Estados que significan "el grafo ya terminó". Si el expediente está en uno
// de estos, ningún nodo debería volver a ponerlo en marcha ni pisarlo con
// COMPLETED.
const TERMINAL_STATUSES = ["COMPLETED", "MAX_ITERATIONS", "ERROR", "INTERRUPTED"];

/**
 * Revisa que el mensaje traiga un expediente válido y lo devuelve.
 * Si no lo trae, lanza un error con una pista concreta: el nombre del nodo
 * que se queja y qué hay que conectar antes.
 *
 * `pista` es opcional: una frase extra para casos particulares.
 */
function assertState(msg, nodeName, pista) {
    if (!msg || !msg.state || !Array.isArray(msg.state.messages)) {
        const base =
            nodeName +
            ": el mensaje no trae msg.state.messages. " +
            "Conectá un nodo langgraph-start antes de este.";
        throw new Error(pista ? base + " " + pista : base);
    }
    return msg.state;
}

/**
 * Arma el expediente inicial de una corrida nueva.
 *
 * `text` es lo que escribió el usuario (ya convertido a texto por quien llama)
 * y `maxIterations` es el tope de vueltas que permitió configurar.
 *
 * Incluye dos datos que todavía no se usan pero evitan un dolor de cabeza
 * futuro:
 *   - version: para poder migrar expedientes viejos sin romper nada.
 *   - run_id:  un identificador único de esta corrida, útil para separar una
 *              ejecución de otra en los registros y, más adelante, en los
 *              puntos de guardado.
 */
function createState(options) {
    const opciones = options || {};
    const texto = typeof opciones.text === "string" ? opciones.text : String(opciones.text || "");
    const maxIterations =
        Number.isInteger(opciones.maxIterations) && opciones.maxIterations > 0
            ? opciones.maxIterations
            : 5;

    const primerMensaje = new HumanMessage(texto || " ");

    return {
        version: STATE_VERSION,
        run_id: crypto.randomUUID(),
        // toDict() deja el mensaje en el formato que LangChain sabe
        // reconstruir después (mapStoredMessagesToChatMessages).
        messages: [primerMensaje.toDict()],
        next_node: "llm",
        status: "RUNNING",
        iterations: 0,
        max_iterations: maxIterations
    };
}

/**
 * Agrega un mensaje al expediente. Acepta tanto un mensaje de LangChain
 * (con toDict) como un objeto ya serializado. Devuelve lo que quedó
 * guardado, por si el nodo necesita mirarlo.
 */
function appendMessage(state, message) {
    if (!state || !Array.isArray(state.messages)) {
        throw new Error("appendMessage: hace falta un estado con la lista de mensajes.");
    }
    const guardado =
        message && typeof message.toDict === "function" ? message.toDict() : message;
    state.messages.push(guardado);
    return guardado;
}

/**
 * Devuelve el último mensaje del asistente, o null si no hay ninguno.
 * Se recorre de atrás hacia adelante porque lo último que pasó es lo que
 * más nos importa.
 */
function lastAssistant(state) {
    if (!state || !Array.isArray(state.messages)) {
        return null;
    }
    for (let i = state.messages.length - 1; i >= 0; i--) {
        const mensaje = state.messages[i];
        const tipo = mensaje && (mensaje.type || mensaje.role);
        if (tipo === "ai" || tipo === "assistant") {
            return mensaje;
        }
    }
    return null;
}

/**
 * Saca el texto de un mensaje, sin importar si viene como texto simple o
 * como lista de partes (algunos modelos responden así). Si no hay nada,
 * devuelve una cadena vacía.
 */
function messageText(message) {
    if (!message) {
        return "";
    }
    const contenido = message.data ? message.data.content : message.content;
    if (contenido === undefined || contenido === null) {
        return "";
    }
    if (typeof contenido === "string") {
        return contenido;
    }
    if (Array.isArray(contenido)) {
        return contenido
            .map(function (parte) {
                if (typeof parte === "string") {
                    return parte;
                }
                if (parte && typeof parte.text === "string") {
                    return parte.text;
                }
                return "";
            })
            .filter(function (texto) {
                return texto !== "";
            })
            .join("");
    }
    return String(contenido);
}

/**
 * ¿El grafo ya terminó? Se usa antes de cambiar el estado, para no pisar un
 * final que otro nodo ya había decidido (por ejemplo, el límite de vueltas
 * que marcará el router).
 */
function isTerminal(state) {
    return !!(
        state &&
        typeof state.status === "string" &&
        TERMINAL_STATUSES.indexOf(state.status) !== -1
    );
}

module.exports = {
    STATE_VERSION: STATE_VERSION,
    TERMINAL_STATUSES: TERMINAL_STATUSES,
    assertState: assertState,
    createState: createState,
    appendMessage: appendMessage,
    lastAssistant: lastAssistant,
    messageText: messageText,
    isTerminal: isTerminal
};
