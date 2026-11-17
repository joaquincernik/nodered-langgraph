/**
 * Cliente WebSocket mínimo, sin dependencias.
 *
 * Node-RED publica los mensajes de los nodos debug por WebSocket en /comms.
 * Para leerlos desde una prueba necesitábamos un cliente, pero el paquete no
 * tiene `ws` y no queremos agregar una dependencia sólo para probar.
 *
 * Este archivo implementa lo justo: handshake, lectura de tramas de texto y
 * respuesta a los ping. No hace falta nada más para escuchar debug.
 */
const net = require("net");
const crypto = require("crypto");
const { EventEmitter } = require("events");

class MiniWebSocket extends EventEmitter {
    constructor(url) {
        super();
        this.url = new URL(url);
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.abierto = false;
        this.cerrado = false;
    }

    conectar() {
        return new Promise((resolve, reject) => {
            const puerto = Number(this.url.port) || 80;
            const host = this.url.hostname;
            const ruta = this.url.pathname || "/comms";

            const socket = net.connect(puerto, host);
            this.socket = socket;

            const clave = crypto.randomBytes(16).toString("base64");
            let respuesta = Buffer.alloc(0);

            const alConectar = () => {
                socket.write(
                    "GET " + ruta + " HTTP/1.1\r\n" +
                    "Host: " + host + ":" + puerto + "\r\n" +
                    "Upgrade: websocket\r\n" +
                    "Connection: Upgrade\r\n" +
                    "Sec-WebSocket-Key: " + clave + "\r\n" +
                    "Sec-WebSocket-Version: 13\r\n" +
                    "\r\n"
                );
            };

            const alRecibir = (trozo) => {
                if (this.abierto) {
                    this.buffer = Buffer.concat([this.buffer, trozo]);
                    this.leerTramas();
                    return;
                }

                respuesta = Buffer.concat([respuesta, trozo]);
                const fin = respuesta.indexOf("\r\n\r\n");
                if (fin === -1) { return; }

                const cabecera = respuesta.slice(0, fin).toString("latin1");
                const resto = respuesta.slice(fin + 4);

                if (!/^HTTP\/1\.1 101/i.test(cabecera)) {
                    reject(new Error("El servidor no aceptó WebSocket:\n" + cabecera));
                    socket.destroy();
                    return;
                }

                this.abierto = true;
                socket.removeListener("data", alRecibir);
                socket.on("data", (t) => {
                    this.buffer = Buffer.concat([this.buffer, t]);
                    this.leerTramas();
                });

                if (resto.length > 0) {
                    this.buffer = Buffer.concat([this.buffer, resto]);
                    this.leerTramas();
                }

                resolve();
            };

            socket.once("connect", alConectar);
            socket.on("data", alRecibir);
            socket.on("error", (err) => reject(err));
            socket.on("close", () => {
                this.cerrado = true;
                this.emit("close");
            });
        });
    }

    enviar(texto) {
        if (!this.abierto) { throw new Error("WebSocket todavía no está conectado"); }
        this.escribirTrama(0x1, Buffer.from(texto, "utf8"));
    }

    cerrar() {
        if (this.socket && this.abierto) {
            this.escribirTrama(0x8, Buffer.alloc(0));
        }
        if (this.socket) { this.socket.end(); }
    }

    escribirTrama(opcode, carga) {
        const mascara = crypto.randomBytes(4);
        let cabecera;

        if (carga.length < 126) {
            cabecera = Buffer.alloc(2);
            cabecera[1] = 0x80 | carga.length;
        } else if (carga.length < 65536) {
            cabecera = Buffer.alloc(4);
            cabecera[1] = 0x80 | 126;
            cabecera.writeUInt16BE(carga.length, 2);
        } else {
            cabecera = Buffer.alloc(10);
            cabecera[1] = 0x80 | 127;
            cabecera.writeUInt32BE(0, 2);
            cabecera.writeUInt32BE(carga.length, 6);
        }

        cabecera[0] = 0x80 | opcode;

        const enmascarada = Buffer.alloc(carga.length);
        for (let i = 0; i < carga.length; i++) {
            enmascarada[i] = carga[i] ^ mascara[i % 4];
        }

        this.socket.write(Buffer.concat([cabecera, mascara, enmascarada]));
    }

    leerTramas() {
        while (this.buffer.length >= 2) {
            const primero = this.buffer[0];
            const segundo = this.buffer[1];
            const opcode = primero & 0x0f;
            const enmascarada = (segundo & 0x80) !== 0;
            let largo = segundo & 0x7f;
            let desplazamiento = 2;

            if (largo === 126) {
                if (this.buffer.length < 4) { return; }
                largo = this.buffer.readUInt16BE(2);
                desplazamiento = 4;
            } else if (largo === 127) {
                if (this.buffer.length < 10) { return; }
                const alto = this.buffer.readUInt32BE(2);
                const bajo = this.buffer.readUInt32BE(6);
                largo = alto * 4294967296 + bajo;
                desplazamiento = 10;
            }

            let mascara = null;
            if (enmascarada) {
                if (this.buffer.length < desplazamiento + 4) { return; }
                mascara = this.buffer.slice(desplazamiento, desplazamiento + 4);
                desplazamiento += 4;
            }

            if (this.buffer.length < desplazamiento + largo) { return; }

            const carga = this.buffer.slice(desplazamiento, desplazamiento + largo);
            this.buffer = this.buffer.slice(desplazamiento + largo);

            let datos = carga;
            if (enmascarada) {
                datos = Buffer.alloc(carga.length);
                for (let i = 0; i < carga.length; i++) {
                    datos[i] = carga[i] ^ mascara[i % 4];
                }
            }

            this.procesarTrama(opcode, datos);
        }
    }

    procesarTrama(opcode, datos) {
        if (opcode === 0x1) {
            this.emit("message", datos.toString("utf8"));
        } else if (opcode === 0x8) {
            this.emit("close");
            if (this.socket) { this.socket.end(); }
        } else if (opcode === 0x9) {
            this.escribirTrama(0xa, datos);
        }
        // Los demás (continuación, binario, pong) no se usan acá.
    }
}

module.exports = { MiniWebSocket };
