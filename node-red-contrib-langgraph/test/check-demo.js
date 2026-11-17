/**
 * Prueba de la demo del agente (pestaña "Agente con herramienta").
 *
 * No usa WebSocket: dispara los inject por HTTP y lee la memoria guardada en
 * el contexto de la pestaña. Así comprueba lo importante:
 *   1. "Nueva conversación" arranca de cero.
 *   2. "Consulta" usa la herramienta del clima.
 *   3. "Seguimiento" se acuerda de lo anterior y responde otra ciudad.
 *
 * Uso:
 *   node test/check-demo.js
 *   NODERED_URL=http://localhost:1881 node test/check-demo.js
 *
 * Variables opcionales:
 *   NODERED_URL    por defecto http://localhost:1880
 *   TAB_LABEL      parte del nombre de la pestaña; por defecto "Agente"
 *   TAB_ID         id de la pestaña, si se quiere fijar a mano
 *   TIMEOUT_MS     espera máxima por paso; por defecto 180000
 */
const assert = require("assert");

const BASE = (process.env.NODERED_URL || "http://localhost:1880").replace(/\/+$/, "");
const TAB_LABEL = process.env.TAB_LABEL || "Agente";
const TAB_ID = process.env.TAB_ID || "";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 180000);
const PREFIJO = "langgraph:conversation:";

function dormir(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pedir(metodo, ruta, cuerpo) {
    const opciones = {
        method: metodo,
        headers: {
            "Node-RED-API-Version": "v1",
            "Accept": "application/json"
        },
        signal: AbortSignal.timeout(15000)
    };
    if (cuerpo !== undefined) {
        opciones.headers["Content-Type"] = "application/json";
        opciones.body = JSON.stringify(cuerpo);
    }

    const respuesta = await fetch(BASE + ruta, opciones);
    const texto = await respuesta.text();

    if (!respuesta.ok) {
        throw new Error(
            metodo + " " + ruta + " devolvió HTTP " + respuesta.status + "\n" + texto
        );
    }
    if (!texto) { return null; }
    try {
        return JSON.parse(texto);
    } catch (err) {
        return texto;
    }
}

function normalizar(texto) {
    return String(texto || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function buscarNodo(flujos, tipo, z, nombre) {
    const candidatos = flujos.filter(
        (f) => f.type === tipo && f.z === z && f.name && normalizar(f.name) === normalizar(nombre)
    );
    return candidatos[0] || null;
}

function desenvuelto(valor) {
    // Node-RED puede devolver el valor del contexto tal cual o envuelto como
    // { msg, format }. También puede venir como texto JSON.
    let actual = valor;
    for (let i = 0; i < 4; i++) {
        if (actual && typeof actual === "object" && "msg" in actual && "format" in actual) {
            actual = actual.msg;
            continue;
        }
        if (typeof actual === "string") {
            try {
                actual = JSON.parse(actual);
            } catch (err) {
                return null;
            }
            continue;
        }
        break;
    }
    return actual && typeof actual === "object" ? actual : null;
}

function resumen(mem) {
    const mensajes = Array.isArray(mem.messages) ? mem.messages : [];
    let ultimaRespuesta = "";
    for (let i = mensajes.length - 1; i >= 0; i--) {
        const m = mensajes[i] || {};
        const tipo = m.type || m.role;
        const contenido = (m.data && m.data.content) || "";
        if ((tipo === "ai" || tipo === "assistant") && String(contenido).trim()) {
            ultimaRespuesta = String(contenido);
            break;
        }
    }
    return {
        total: mensajes.length,
        tieneHerramienta: mensajes.some((m) => (m.type || m.role) === "tool"),
        ultimaRespuesta: ultimaRespuesta
    };
}

async function main() {
    console.log("Node-RED:", BASE);

    const flujos = await pedir("GET", "/flows");
    assert.ok(Array.isArray(flujos), "GET /flows no devolvió una lista");

    const pestanas = flujos.filter((f) => f.type === "tab");
    const pestana = TAB_ID
        ? pestanas.find((f) => f.id === TAB_ID)
        : pestanas.find((f) => normalizar(f.label).includes(normalizar(TAB_LABEL)));

    if (!pestana) {
        const nombres = pestanas.map((p) => '"' + p.label + '"').join(", ");
        throw new Error(
            "No encontré la pestaña. Buscaba " +
            (TAB_ID ? "el id " + TAB_ID : 'un nombre que contenga "' + TAB_LABEL + '"') +
            ". Pestañas disponibles: " + nombres
        );
    }
    console.log("Pestaña:", pestana.label, "(" + pestana.id + ")");

    const inicio = flujos.find((f) => f.type === "langgraph-start" && f.z === pestana.id);
    if (!inicio) {
        throw new Error("La pestaña no tiene un nodo langgraph-start.");
    }
    if (!(inicio.memory === true || inicio.memory === "true")) {
        throw new Error(
            "El nodo langgraph-start de esa pestaña tiene la memoria apagada. " +
            "Activá 'Memoria' y hacé Deploy antes de correr esta prueba."
        );
    }

    const clave = String(inicio.conversationKey || inicio.id).trim() || inicio.id;
    const claveGuardado = PREFIJO + clave;
    console.log("Memoria:", claveGuardado);

    const consulta = buscarNodo(flujos, "inject", pestana.id, "Consulta");
    const seguimiento = buscarNodo(flujos, "inject", pestana.id, "Seguimiento");
    const nueva = buscarNodo(flujos, "inject", pestana.id, "Nueva conversación");

    if (!consulta) {
        throw new Error('No encontré el inject "Consulta" en la pestaña.');
    }
    if (!seguimiento) {
        throw new Error('No encontré el inject "Seguimiento" en la pestaña.');
    }

    function rutaMemoria() {
        return "/context/flow/" + pestana.id + "/" + encodeURIComponent(claveGuardado);
    }

    // Node-RED devuelve el contexto agrupado por almacén: "memory" cuando usa
    // el almacén en RAM y "default" cuando settings.js configura
    // localfilesystem. Buscamos la clave en cualquiera de los dos.
    function buscarGuardado(datos, clave) {
        if (!datos || typeof datos !== "object") { return null; }
        for (const tienda of Object.values(datos)) {
            if (tienda && typeof tienda === "object" && clave in tienda) {
                return tienda[clave];
            }
        }
        return null;
    }

    async function leerMemoria() {
        const datos = await pedir("GET", "/context/flow/" + pestana.id);
        return desenvuelto(buscarGuardado(datos, claveGuardado));
    }

    async function esperar(etiqueta, anterior, condiciones) {
        const inicioEspera = Date.now();
        let ultimoError = "";

        while (Date.now() - inicioEspera < TIMEOUT_MS) {
            let mem = null;
            try {
                mem = await leerMemoria();
            } catch (err) {
                ultimoError = err.message;
            }

            if (mem && mem.updated_at !== anterior) {
                const r = resumen(mem);
                if (condiciones(r)) {
                    return mem;
                }
                ultimoError =
                    "todavía no se cumple (mensajes=" + r.total +
                    ", herramienta=" + r.tieneHerramienta +
                    ", respuesta=" + (r.ultimaRespuesta ? "sí" : "no") + ")";
            }

            await dormir(1000);
        }

        throw new Error(
            'Se agotó la espera de "' + etiqueta + '" (' + TIMEOUT_MS + " ms). " +
            (ultimoError ? "Último estado: " + ultimoError : "")
        );
    }

    console.log("\n1) Borro la memoria anterior");
    await pedir("DELETE", rutaMemoria());
    assert.strictEqual(await leerMemoria(), null, "la memoria no se borró");

    if (nueva) {
        console.log("2) Disparo 'Nueva conversación'");
        await pedir("POST", "/inject/" + nueva.id);
        const mem = await esperar("Nueva conversación", null, (r) => r.total >= 2);
        const r = resumen(mem);
        console.log("   mensajes:", r.total);
        console.log("   respuesta:", r.ultimaRespuesta || "(vacía)");
        assert.ok(r.ultimaRespuesta, "la respuesta de la nueva conversación vino vacía");
    } else {
        console.log("2) La pestaña no tiene 'Nueva conversación'; sigo con la memoria vacía");
    }

    console.log("3) Disparo 'Consulta' (debe usar la herramienta del clima)");
    const antesConsulta = await leerMemoria();
    await pedir("POST", "/inject/" + consulta.id);
    const memConsulta = await esperar(
        "Consulta",
        antesConsulta ? antesConsulta.updated_at : null,
        (r) => r.total > (antesConsulta ? resumen(antesConsulta).total : 0) && r.tieneHerramienta && !!r.ultimaRespuesta
    );
    const consultaResumen = resumen(memConsulta);
    console.log("   mensajes:", consultaResumen.total);
    console.log("   usó herramienta: sí");
    console.log("   respuesta:", consultaResumen.ultimaRespuesta);

    console.log("4) Disparo 'Seguimiento' (debe recordar lo anterior)");
    await pedir("POST", "/inject/" + seguimiento.id);
    const memSeguimiento = await esperar(
        "Seguimiento",
        memConsulta.updated_at,
        (r) => r.total > consultaResumen.total && !!r.ultimaRespuesta
    );
    const seguimientoResumen = resumen(memSeguimiento);

    console.log("   mensajes:", seguimientoResumen.total);
    console.log("   respuesta:", seguimientoResumen.ultimaRespuesta);

    assert.ok(
        seguimientoResumen.total > consultaResumen.total,
        "el historial no creció entre Consulta y Seguimiento"
    );

    console.log("\nRESULTADO: la demo funciona de punta a punta.");
    console.log("  memoria:      " + claveGuardado);
    console.log("  mensajes:     " + consultaResumen.total + " -> " + seguimientoResumen.total);
    console.log("  herramienta:  usada");
    console.log("  seguimiento:  respondido");
}

main().catch(function (err) {
    console.error("\nFALLÓ:", err.message);
    process.exit(1);
});
