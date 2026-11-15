# Pendientes antes de publicar

Este archivo es una guía de trabajo para el equipo. Resume qué ya está hecho y
qué falta para dejar el paquete listo para instalar y publicar.

## Estado actual

Ya funciona y está probado:

- Los 5 nodos: `langgraph-start`, `langgraph-llm`, `langgraph-router`,
  `langgraph-tool` y `langgraph-end`.
- El contrato de `msg.state` y el bucle del grafo con límite de vueltas.
- Herramientas nativas (el modelo pide la herramienta y el nodo guarda la
  respuesta como `ToolMessage`), con respaldo para proveedores que no las
  soportan.
- La demo del clima con Open-Meteo, sin clave.
- Memoria entre corridas, opcional por nodo de inicio.
- Las pestañas 1 a 6 del entorno de desarrollo.
- Pruebas unitarias de memoria, prueba punta a punta y regresión de las
  pestañas 1 a 4.

## Pendiente inmediato

- [ ] Commitear la fase de memoria y el ajuste de red del contenedor.
      Archivos: `README.md`, `docker-compose.yml`, `lib/state.js`, los cuatro
      archivos de inicio/fin y `flows.json`.

## Faltantes del paquete

Todo esto va dentro de `node-red-contrib-langgraph/`:

- [ ] **README propio del paquete.** npm muestra el README que está dentro de la
      carpeta del paquete, no el de la raíz. Debe explicar instalación, nodos y
      un ejemplo mínimo.
- [ ] **LICENSE.** `package.json` declara MIT; falta el archivo de licencia.
- [ ] **`examples/demo.json`.** Exportar el flujo de ejemplo (pestañas 5 y 6:
      agente + clima + memoria) en un archivo importable.
- [ ] **Metadatos en `package.json`.** Autor, repositorio, `engines` y versión
      `0.1.0` (hoy dice `0.0.1`).
- [ ] **Definir qué se publica.** Usar `files` o `.npmignore` para no subir
      pruebas, imágenes internas ni archivos de desarrollo.
- [ ] **Revisar el nombre en npm.** Confirmar que
      `node-red-contrib-langgraph` esté libre antes de publicar.

## Prueba de instalación limpia

Es el control más importante. Hoy el paquete funciona porque la carpeta está
montada dentro de Node-RED; hay que comprobar que también funciona instalado.

- [ ] Generar el paquete:

      ```bash
      cd node-red-contrib-langgraph
      npm pack
      ```

- [ ] Levantar un Node-RED limpio en otro puerto, por ejemplo:

      ```bash
      docker run -d --name nodered-limpio \
        -p 1881:1880 nodered/node-red:4.1.7
      ```

- [ ] Instalar el `.tgz` en ese Node-RED limpio, con el directorio de trabajo
      en `/data`.
- [ ] Verificar que los 5 nodos aparezcan en la paleta y en `/nodes`.
- [ ] Importar `examples/demo.json` y probar el agente con el clima.
- [ ] Revisar los logs: sin errores de registro ni nodos faltantes.

## Detalles a decidir

- [ ] **Credenciales en el demo.** El flujo exportado no debe llevar claves,
      tokens ni ids de esta instancia.
- [ ] **Pruebas.** Hoy viven en `/tmp` y se pierden. Decidir si se mueven a
      `test/` dentro del repo.
- [ ] **Memoria.** Hoy vive en RAM y se pierde al reiniciar Node-RED. Decidir si
      se queda así (está documentado) o si se agrega `contextStorage`.
- [ ] **Ajuste de red.** El `docker-compose.yml` usa
      `--no-network-family-autoselection` porque esta red no tiene IPv6. Es un
      ajuste del entorno, no del paquete; revisar si se mantiene o se documenta
      aparte.

## Criterio para decir "listo"

- [ ] El paquete se instala desde el `.tgz` en un Node-RED limpio.
- [ ] Los 5 nodos aparecen y el demo funciona.
- [ ] El README del paquete permite instalarlo y probarlo sin ayuda.
- [ ] No se publican credenciales ni archivos internos.
- [ ] La regresión de las pestañas 1 a 6 sigue pasando.

## Recordatorios

- No commitear `.env`, `flows_cred.json` ni claves reales.
- Node-RED no recarga nodos en caliente: después de cambiar un `.js` hay que
  reiniciar el contenedor.
- Antes de publicar, revisar `npm pack --dry-run` para ver exactamente qué
  archivos se van a subir.
