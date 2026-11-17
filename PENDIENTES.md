# Estado y pendientes antes de publicar

Este archivo resume el estado del paquete y lo que falta para publicarlo.

## Resumen

El paquete está armado, documentado y probado en una instalación limpia.
Lo que queda es opcional o propio del momento de publicar en npm.

## Ya está

- Los 5 nodos: `langgraph-start`, `langgraph-llm`, `langgraph-router`,
  `langgraph-tool` y `langgraph-end`.
- Herramientas nativas y respaldo para proveedores que no las soportan.
- Demo del clima con Open-Meteo, sin clave.
- Memoria entre corridas, opcional por nodo de inicio.
- Las pestañas 1 a 6 del entorno de desarrollo.
- Las pruebas automáticas en `test/`.
- README del repositorio y `PENDIENTES.md`.

## Paquete listo

Todo esto está dentro de `node-red-contrib-langgraph/`:

- [x] **README propio del paquete**, con instalación, nodos, ejemplo y memoria.
- [x] **LICENSE** con licencia MIT.
- [x] **`examples/demo.json`** con el agente y la herramienta del clima.
- [x] **Metadatos**: autor, repositorio, `engines`, versión `0.1.0`.
- [x] **`files`** para publicar solo lo necesario. La imagen interna ya no entra.
- [x] **Nombre libre en npm**: `node-red-contrib-langgraph` no existe todavía.
- [x] **Dependencias compatibles con Node 20**. `@langchain/openai` quedó fijado
      en `1.5.8` porque las versiones nuevas piden Node 22 y la imagen de
      Node-RED 4.1.7 usa Node 20.

## Pruebas automáticas

Están en `node-red-contrib-langgraph/test/` y se ejecutan desde la carpeta del
paquete:

```bash
cd node-red-contrib-langgraph

npm test                 # memoria, sin Node-RED encendido
npm run test:demo        # demo del agente contra localhost:1880
npm run test:regression  # pestañas 1 a 4
npm run test:clean-install
```

- [x] **`memory.test.js`**: memoria, reinicio y limpieza de mensajes.
- [x] **`check-demo.js`**: consulta, herramienta del clima y seguimiento.
- [x] **`regression-tabs.js`**: las pestañas 1 a 4 siguen respondiendo.
- [x] **`instalacion-limpia.sh`**: empaqueta, instala en un Node-RED nuevo,
      importa el ejemplo y prueba la demo.

Las cuatro pruebas pasaron el 17/11/2026 contra las pestañas actuales y contra
un Node-RED 4.1.7 limpio en el puerto 1881. El detalle y las opciones están en
`node-red-contrib-langgraph/test/README.md`.

## Prueba de instalación limpia

Todo el procedimiento está automatizado:

```bash
cd node-red-contrib-langgraph
bash test/instalacion-limpia.sh
```

El script arma el `.tgz`, levanta un Node-RED aparte en el puerto 1881, instala
el paquete, revisa que aparezcan los 5 nodos, importa `examples/demo.json` y
corre la demo si encuentra una API key. Al terminar borra el contenedor y el
`.tgz`, salvo que se use `KEEP=1`.

Resultado de la última corrida:

- [x] `npm pack` genera un paquete de 15 archivos, sin credenciales.
- [x] Se instala con `npm install` en otra instancia.
- [x] Aparecen los 5 nodos.
- [x] El ejemplo se importa y el agente responde.
- [x] La memoria funciona: consulta, seguimiento y respuesta de otra ciudad.
- [x] Sin errores en los logs (solo el aviso normal de credenciales vacías).

## Pendiente por decidir

- [ ] **Publicar en npm.** Por ahora no: el usuario todavía no tiene cuenta.
      Cuando la tenga, alcanza con `npm login` y `npm publish`.
- [ ] **Persistencia de la memoria.** Hoy vive en RAM y se pierde al reiniciar
      Node-RED. Se puede dejar así (está documentado) o agregar
      `contextStorage` con `localfilesystem` en `settings.js`.
- [ ] **Guion de demo para la clase.** El ejemplo funciona; el paso a paso y la
      explicación completa están en el markdown que vive fuera del repositorio.

## Cuando haya cuenta en npm

```bash
cd node-red-contrib-langgraph
npm pack --dry-run      # revisar qué se sube
npm publish
npm view node-red-contrib-langgraph version
```

Después de publicar, crear el tag de la versión en git.

## Recordatorios

- No commitear `.env`, `flows_cred.json` ni claves reales.
- Node-RED no recarga nodos en caliente: reiniciar tras cambiar un `.js`.
- El `docker-compose.yml` usa `--no-network-family-autoselection` porque esta
  red no tiene IPv6. Es un ajuste del entorno, no del paquete.
