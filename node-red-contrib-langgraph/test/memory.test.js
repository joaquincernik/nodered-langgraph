/**
 * Pruebas unitarias de la memoria entre corridas.
 *
 * No necesitan Node-RED encendido: simulan el contexto de una pestaña.
 * Se ejecutan desde la carpeta del paquete:
 *
 *   node test/memory.test.js
 *   # o dentro del contenedor:
 *   docker exec -w /data/node_modules/node-red-contrib-langgraph \
 *     nodered_pfs2026 node test/memory.test.js
 */
const assert = require("assert");
const path = require("path");

const RUTA = path.resolve(__dirname, "..");
const {
    createState,
    sanitizeForResume,
    CONVERSATION_PREFIX
} = require(path.join(RUTA, "lib/state.js"));

const avisos = { warn: [], log: [], error: [] };

function contextoNuevo() {
    const datos = new Map();
    return {
        flow: {
            get: function (k) { return datos.get(k); },
            set: function (k, v) { datos.set(k, v); },
            keys: function () { return Array.from(datos.keys()); }
        },
        global: {},
        datos: datos
    };
}

function cargar(tipo, contexto) {
    const ruta = path.join(RUTA, "nodes", tipo + ".js");
    delete require.cache[require.resolve(ruta)];
    let Ctor = null;
    const RED = {
        nodes: {
            createNode: function (nodo, config) {
                config = config || {};
                nodo.id = config.id;
                nodo.type = config.type;
                nodo.z = config.z;
                nodo.credentials = Object.assign({}, config.credentials);
                nodo.status = function () {};
                nodo.log = function (m) { avisos.log.push(String(m)); };
                nodo.warn = function (m) { avisos.warn.push(String(m)); };
                nodo.error = function (m) { avisos.error.push(String(m)); };
                nodo.on = function (evento, fn) {
                    if (evento === "input") { nodo._input = fn; }
                };
                nodo.context = function () { return contexto; };
            },
            registerType: function (tipo, ctor) { if (tipo) { Ctor = ctor; } },
            eachNode: function () {}
        }
    };
    require(ruta)(RED);
    return Ctor;
}

function crear(Ctor, config) {
    return new Ctor(Object.assign({ id: "n1", z: "tab1" }, config));
}

function ejecutar(nodo, msg) {
    return new Promise(function (resolve, reject) {
        nodo._input(msg, function (m) { nodo._enviado = m; }, function (err) {
            if (err) { reject(err); } else { resolve(msg); }
        });
    });
}

function ai(texto, llamadas) {
    return {
        type: "ai",
        data: {
            content: texto,
            additional_kwargs: {},
            tool_calls: llamadas || []
        }
    };
}

async function pruebasSanitizar() {
    const conPedidoVacio = [
        createState({ text: "hola" }).messages[0],
        ai("", [{ name: "clima" }])
    ];
    const limpio = sanitizeForResume(conPedidoVacio);
    assert.strictEqual(limpio.length, 1, "un pedido vacío se descarta");
    assert.strictEqual(limpio[0].type, "human");

    const conTexto = [
        createState({ text: "hola" }).messages[0],
        ai("pensando", [{ name: "clima" }])
    ];
    const limpio2 = sanitizeForResume(conTexto);
    assert.strictEqual(limpio2.length, 2, "el texto se conserva");
    assert.strictEqual(limpio2[1].data.content, "pensando");
    assert.strictEqual(limpio2[1].data.tool_calls, undefined, "se quita el pedido");
    assert.strictEqual(conTexto[1].data.tool_calls.length, 1, "el original no se toca");

    const conRespuesta = [
        createState({ text: "hola" }).messages[0],
        ai("", [{ name: "clima" }]),
        { type: "tool", data: { content: "soleado", tool_call_id: "x" } }
    ];
    const limpio3 = sanitizeForResume(conRespuesta);
    assert.strictEqual(limpio3.length, 3, "un pedido respondido no se toca");
    assert.strictEqual(limpio3[1].data.tool_calls.length, 1);
    console.log("ok  sanitizar: descarta pedidos colgados y conserva los respondidos");
}

async function pruebasInicioFin() {
    // Memoria apagada: no toca el contexto.
    let ctx = contextoNuevo();
    let Ctor = cargar("langgraph-start", ctx);
    let nodo = crear(Ctor, { maxIterations: 5, memory: false, conversationKey: "" });
    let msg = { payload: "hola" };
    await ejecutar(nodo, msg);
    assert.strictEqual(msg.state.messages.length, 1);
    assert.strictEqual(msg.state.conversation_id, undefined);
    assert.strictEqual(ctx.datos.size, 0);
    console.log("ok  inicio: memoria apagada no guarda ni carga");

    // Memoria encendida: primera corrida.
    let ctx2 = contextoNuevo();
    Ctor = cargar("langgraph-start", ctx2);
    nodo = crear(Ctor, { id: "inicio1", memory: true, conversationKey: "demo" });
    msg = { payload: "hola" };
    await ejecutar(nodo, msg);
    assert.strictEqual(msg.state.conversation_id, "demo");
    assert.strictEqual(msg.state.conversation_store_key, CONVERSATION_PREFIX + "demo");
    assert.strictEqual(msg.state.messages.length, 1);
    const primerRun = msg.state.run_id;

    // Fin: guarda la respuesta.
    const CtorFin = cargar("langgraph-end", ctx2);
    const fin = crear(CtorFin, { id: "fin1" });
    msg.state.messages.push(ai("respuesta uno"));
    await ejecutar(fin, msg);
    const guardado = ctx2.flow.get(CONVERSATION_PREFIX + "demo");
    assert.ok(guardado && Array.isArray(guardado.messages));
    assert.strictEqual(guardado.messages.length, 2);
    assert.strictEqual(guardado.messages[1].data.content, "respuesta uno");
    assert.strictEqual(msg.payload, "respuesta uno");
    console.log("ok  fin: guarda el historial cuando hay conversation_id");

    // Segunda corrida: carga lo anterior y agrega el mensaje nuevo.
    msg = { payload: "¿y en Córdoba?" };
    await ejecutar(nodo, msg);
    assert.strictEqual(msg.state.messages.length, 3);
    assert.strictEqual(msg.state.messages[0].data.content, "hola");
    assert.strictEqual(msg.state.messages[1].data.content, "respuesta uno");
    assert.strictEqual(msg.state.messages[2].data.content, "¿y en Córdoba?");
    assert.notStrictEqual(msg.state.run_id, primerRun, "run_id nuevo");
    assert.strictEqual(msg.state.iterations, 0, "contador reiniciado");
    assert.strictEqual(msg.state.status, "RUNNING");
    console.log("ok  inicio: recupera el historial y agrega el mensaje nuevo");

    // Clave por mensaje: gana sobre la configurada.
    ctx = contextoNuevo();
    Ctor = cargar("langgraph-start", ctx);
    nodo = crear(Ctor, { id: "inicio2", memory: true, conversationKey: "demo" });
    msg = { payload: "hola", conversationId: "usuario-7" };
    await ejecutar(nodo, msg);
    assert.strictEqual(msg.state.conversation_id, "usuario-7");
    console.log("ok  inicio: msg.conversationId tiene prioridad");

    // Reinicio: borra lo viejo y arranca de cero.
    ctx = contextoNuevo();
    ctx.flow.set(CONVERSATION_PREFIX + "demo", {
        messages: [createState({ text: "viejo" }).messages[0], ai("vieja respuesta")]
    });
    Ctor = cargar("langgraph-start", ctx);
    nodo = crear(Ctor, { id: "inicio3", memory: true, conversationKey: "demo" });
    msg = { payload: "nuevo", resetConversation: true };
    await ejecutar(nodo, msg);
    assert.strictEqual(msg.state.messages.length, 1);
    assert.strictEqual(msg.state.messages[0].data.content, "nuevo");
    assert.strictEqual(ctx.flow.get(CONVERSATION_PREFIX + "demo"), null);
    console.log("ok  inicio: resetConversation borra la memoria anterior");

    // Fin sin conversation_id: no guarda.
    ctx = contextoNuevo();
    const CtorFin2 = cargar("langgraph-end", ctx);
    const fin2 = crear(CtorFin2, { id: "fin2" });
    const state = createState({ text: "hola" });
    state.messages.push(ai("respuesta"));
    await ejecutar(fin2, { state: state });
    assert.strictEqual(ctx.datos.size, 0);
    console.log("ok  fin: sin conversation_id no guarda nada");

    // Pedido de herramienta colgado: se limpia al guardar.
    ctx = contextoNuevo();
    const CtorFin3 = cargar("langgraph-end", ctx);
    const fin3 = crear(CtorFin3, { id: "fin3" });
    const state3 = createState({ text: "clima" });
    state3.conversation_id = "colgado";
    state3.conversation_store_key = CONVERSATION_PREFIX + "colgado";
    state3.messages.push(ai("", [{ name: "clima", args: { input: "Rosario" } }]));
    await ejecutar(fin3, { state: state3 });
    const guardado3 = ctx.flow.get(CONVERSATION_PREFIX + "colgado");
    assert.strictEqual(guardado3.messages.length, 1, "se descarta el pedido vacío");
    assert.strictEqual(guardado3.messages[0].type, "human");
    console.log("ok  fin: limpia pedidos de herramienta sin responder");
}

(async function () {
    await pruebasSanitizar();
    await pruebasInicioFin();
    console.log("\nTODAS LAS PRUEBAS DE MEMORIA PASARON");
})().catch(function (err) {
    console.error("\nFALLÓ:", err);
    process.exit(1);
});
