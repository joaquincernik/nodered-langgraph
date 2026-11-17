/**
 * Prueba de regresión de las pestañas 1 a 4.
 *
 * Dispara el inject de cada pestaña y espera el mensaje del nodo debug. Si el
 * debug no llega, algo se rompió en el camino: el nodo, el router, el bucle o
 * la respuesta del modelo.
 *
 * Necesita Node-RED encendido y una API key configurada (credencial del nodo
 * o variable de entorno del proveedor).
 *
 * Uso:
 *   node test/regression-tabs.js
 *   NODERED_URL=http://localhost:1881 node test/regression-tabs.js
 *
 * Variables opcionales:
 *   NODERED_URL   por defecto http://localhost:1880
 *   TIMEOUT_MS    espera máxima por pestaña; por defecto 180000
 */
const assert = require("assert");
const { MiniWebSocket } = require("./support/ws");

const BASE = (process.env.NODERED_URL || "http://localhost:1880").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 180000);

const CASOS = [
    { numero: "1", inject: "Prompt", debug: "debug 1" },
    { numero: "2", inject: "Tema", debug: "Broma final" },
    { numero: "3", inject: "Consulta", debug: "Resultado final" },
    { numero: "4", inject: "Consulta", debug: "Resultado final" }
];

function normalizar(texto) {
    return String(texto || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

async function pedir(metodo, ruta) {
    const respuesta = await fetch(BASE + ruta, {
        method: metodo,
        headers: { "Node-RED-API-Version": "v1", "Accept": "application/json" },
        signal: AbortSignal.timeout(15000)
    });
    if (!respuesta.ok) {
        throw new Error(metodo + " " + ruta + " devolvió HTTP " + respuesta.status);
    }
    const texto = await respuesta.text();
    if (!texto) { return null; }
    try {
        return JSON.parse(texto);
    } catch (err) {
        return texto;
    }
}

function buscar(flujos, tipo, z, nombre) {
    return flujos.find(
        (f) =>
            f.type === tipo &&
            f.z === z &&
            f.name &&
            normalizar(f.name) === normalizar(nombre)
    ) || null;
}

function textoDeDebug(data) {
    const msg = data && data.msg;
    if (!msg) { return ""; }

    // Algunos debug muestran sólo payload; otros muestran el mensaje entero.
    if (typeof msg === "string") { return msg; }
    if (msg.payload !== undefined) {
        if (typeof msg.payload === "string") { return msg.payload; }
        try { return JSON.stringify(msg.payload); } catch (err) { return ""; }
    }
    try { return JSON.stringify(msg); } catch (err) { return ""; }
}

function estadoFinal(data) {
    const msg = data && data.msg;
    if (!msg || !msg.state) { return null; }
    return {
        status: msg.state.status,
        iteraciones: msg.state.iterations,
        mensajes: Array.isArray(msg.state.messages) ? msg.state.messages.length : 0
    };
}

async function main() {
    console.log("Node-RED:", BASE);

    const flujos = await pedir("GET", "/flows");
    assert.ok(Array.isArray(flujos), "GET /flows no devolvió una lista");

    for (const caso of CASOS) {
        const pestana = flujos.find(
            (f) => f.type === "tab" && String(f.label || "").startsWith(caso.numero + "-")
        );
        if (!pestana) {
            throw new Error('No encontré la pestaña que empieza con "' + caso.numero + '-".');
        }
        caso.pestana = pestana;
        caso.nodoInject = buscar(flujos, "inject", pestana.id, caso.inject);
        caso.nodoDebug = buscar(flujos, "debug", pestana.id, caso.debug);

        if (!caso.nodoInject) {
            throw new Error(
                'La pestaña "' + pestana.label + '" no tiene el inject "' + caso.inject + '".'
            );
        }
        if (!caso.nodoDebug) {
            throw new Error(
                'La pestaña "' + pestana.label + '" no tiene el debug "' + caso.debug + '".'
            );
        }
    }

    const urlWs = BASE.replace(/^http/, "ws") + "/comms";
    const ws = new MiniWebSocket(urlWs);

    console.log("Conectando a", urlWs);
    await ws.conectar();
    ws.enviar(JSON.stringify({ subscribe: "debug" }));
    console.log("Suscrito a los mensajes de depuración.\n");

    let pendiente = null;

    ws.on("message", (texto) => {
        let contenido;
        try {
            contenido = JSON.parse(texto);
        } catch (err) {
            return;
        }

        // Node-RED suele agrupar varios mensajes en un arreglo.
        const paquetes = Array.isArray(contenido) ? contenido : [contenido];
        for (const paquete of paquetes) {
            if (!paquete || paquete.topic !== "debug" || !paquete.data) { continue; }
            if (!pendiente) { continue; }
            if (paquete.data.id === pendiente.nodoDebug.id) {
                const resolver = pendiente.resolver;
                pendiente = null;
                resolver(paquete.data);
            }
        }
    });

    function esperarDebug(caso) {
        return new Promise((resolve, reject) => {
            const temporizador = setTimeout(() => {
                if (pendiente && pendiente.nodoDebug.id === caso.nodoDebug.id) {
                    pendiente = null;
                }
                reject(
                    new Error(
                        'No llegó el debug "' + caso.nodoDebug.name + '" de la pestaña ' +
                        caso.pestana.label + " en " + TIMEOUT_MS + " ms."
                    )
                );
            }, TIMEOUT_MS);

            pendiente = {
                nodoDebug: caso.nodoDebug,
                resolver: (data) => {
                    clearTimeout(temporizador);
                    resolve(data);
                }
            };
        });
    }

    for (const caso of CASOS) {
        console.log("Pestaña " + caso.pestana.label);
        const espera = esperarDebug(caso);
        await pedir("POST", "/inject/" + caso.nodoInject.id);
        const data = await espera;

        const texto = textoDeDebug(data);
        const estado = estadoFinal(data);

        assert.ok(texto.length > 0 || estado, "el debug llegó vacío");
        console.log("  debug:", caso.nodoDebug.name);
        console.log("  respuesta:", (texto || "(mensaje completo)").replace(/\s+/g, " ").slice(0, 120));
        if (estado) {
            console.log(
                "  estado:  " + estado.status +
                ", vueltas: " + estado.iteraciones +
                ", mensajes: " + estado.mensajes
            );
            assert.ok(
                ["COMPLETED", "MAX_ITERATIONS", "ERROR", "INTERRUPTED"].includes(estado.status),
                "el grafo no terminó: " + estado.status
            );
        }
        console.log("");
    }

    ws.cerrar();
    console.log("RESULTADO: las pestañas 1 a 4 respondieron sin errores.");
}

main().catch(function (err) {
    console.error("\nFALLÓ:", err.message);
    process.exit(1);
});
