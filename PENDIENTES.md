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

## Prueba de instalación limpia

Probada con `nodered/node-red:4.1.7` en el puerto 1881:

- [x] `npm pack` genera un paquete de 15 archivos, sin credenciales.
- [x] Se instala con `npm install` en otra instancia.
- [x] Aparecen los 5 nodos.
- [x] El ejemplo se importa y el agente responde.
- [x] La memoria funciona: consulta, seguimiento y respuesta de otra ciudad.
- [x] Sin errores en los logs (solo el aviso normal de credenciales vacías).

Para repetir la prueba:

```bash
cd node-red-contrib-langgraph
npm pack

docker run -d --name nodered_demo_limpio \
  -p 1881:1880 \
  --env-file ../.env \
  -e NODE_OPTIONS=--no-network-family-autoselection \
  nodered/node-red:4.1.7

docker cp node-red-contrib-langgraph-0.1.0.tgz nodered_demo_limpio:/tmp/
docker exec -w /data nodered_demo_limpio \
  npm install /tmp/node-red-contrib-langgraph-0.1.0.tgz
docker restart nodered_demo_limpio

curl -X POST http://localhost:1881/flows \
  -H "Content-Type: application/json" \
  -H "Node-RED-API-Version: v1" \
  --data-binary @examples/demo.json
```

Después, abrir `http://localhost:1881`, revisar que estén los 5 nodos y probar
los injects del ejemplo.

Al terminar:

```bash
docker rm -f nodered_demo_limpio
rm node-red-contrib-langgraph-0.1.0.tgz
```

## Pendiente por decidir

- [ ] **Pruebas en el repo.** Hoy los scripts de prueba viven en `/tmp` y se
      pierden. Si se quieren conservar, moverlos a `test/`.
- [ ] **Persistencia de la memoria.** Hoy vive en RAM y se pierde al reiniciar.
      Se puede dejar así (está documentado) o agregar `contextStorage`.
- [ ] **Guion de demo para la clase.** El ejemplo ya funciona; falta el paso a
      paso para presentarlo.
- [ ] **Publicar en npm.** Requiere `npm login` y después `npm publish` desde la
      carpeta del paquete.

## Al publicar

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
