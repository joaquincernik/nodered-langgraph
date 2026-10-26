# AGENTS.md

## Qué es este repo

Entorno Node-RED (v4.1.7, Docker) para desarrollar un paquete de nodos contrib inspirado en LangGraph (START, LLM, END, ...). El paquete se desarrolla en `./node-red-contrib-langgraph/` y se monta en vivo dentro de Node-RED. No hay build, lint, test ni CI en este repo.

## Comandos

```bash
docker compose up -d                       # levanta Node-RED en http://localhost:1880
docker compose down                        # para
docker compose logs -f nodered_soa2026     # logs (service: nodered_soa2026, container: nodered_pfs2026)
```

## Ciclo de desarrollo de nodos

El `docker-compose.yml` monta la carpeta del paquete directamente en el userDir del contenedor:

```yaml
- ./node-red-contrib-langgraph:/data/node_modules/node-red-contrib-langgraph
```

Por eso no hace falta `npm pack` para desarrollar. Node-RED **no recarga el código en caliente**: cada cambio en un `.js` requiere reiniciar.

```bash
# 1. Instalar dependencias del paquete (solo la primera vez o si cambia package.json)
docker exec -w /data/node_modules/node-red-contrib-langgraph nodered_pfs2026 npm ci

# 2. Reiniciar para que Node-RED cargue el código nuevo
docker compose restart

# 3. Verificar: sin errores de registro y con los nodos en la API
docker logs nodered_pfs2026 2>&1 | grep -iE "error|failed|langgraph"
curl -s http://localhost:1880/nodes | grep -o 'langgraph-[a-z]*' | sort -u
```

El `-w /data/node_modules/node-red-contrib-langgraph` es obligatorio: sin él npm instala en otra ruta y Node-RED no encuentra las dependencias.

### Empaquetado para publicar (Clase 5)

```bash
cd node-red-contrib-langgraph
npm pack
```

El `.tgz` resultante se instala en una instancia limpia con `npm install <archivo>.tgz`, con `cwd` en el userDir (`/data` dentro del contenedor).

## Estructura

- `docker-compose.yml` — servicio único; corre como `root` **a propósito** para poder instalar paquetes npm adentro.
- `node-red-data/` — userDir de Node-RED, montado como `/data`. Es el estado real de la instancia:
  - `package.json` + `package-lock.json` — dependencias del userDir. Se mantienen **sin dependencias**: el paquete de LangGraph se monta aparte y los nodos core ya vienen en la imagen. Se commitean.
  - `flows.json` — definiciones de flujos; **lo reescribe el editor**, no editar a mano con el contenedor corriendo.
  - `settings.js` — configuración de Node-RED (cargada al iniciar).
  - `flows_cred.json` — credenciales cifradas; **no se commitea**.
- `node-red-contrib-langgraph/` — paquete de nodos en desarrollo (paquete npm estándar de Node-RED).

## userDir limpio

`node-red-data/` debe arrancar limpio: `settings.js`, `package.json` sin dependencias, `flows.json` generado por el editor y nada más.

**No copiar ni duplicar un `node-red-data/` de otro proyecto.** Arrastra flows, nodos de configuración global (MySQL, MongoDB, dashboard, Telegram, MQTT...) y dependencias que Node-RED después exige al arrancar. Aunque esos nodos no se vean en el canvas (no viven en una pestaña), si su tipo no está registrado Node-RED muestra "Flows stopped due to missing node types" y **no inicia ningún flow**.

Si aparece ese mensaje: revisar `flows.json` y `package.json` antes de instalar nada. La solución preferida es quitar los nodos huérfanos; instalar el paquete solo si realmente se van a usar.

## Gotchas

- **Permisos root**: el contenedor escribe como root, así que archivos como `flows.json` quedan root-owned y git/edits fallan con "permission denied". Fix: `sudo chown -R $(id -u):$(id -g) node-red-data`.
- **Credenciales**: `flows_cred.json` está **gitignoreado**. No commitear credenciales reales. La API key del LLM se toma de la credencial del nodo o de `GROQ_API_KEY` / `OPENAI_API_KEY` en `.env` (también gitignoreado).
- **Node version skew**: el host corre Node 22, el contenedor Node 20. El host sirve para editar y para regenerar el lockfile (`npm install --package-lock-only`); las dependencias del paquete se instalan **siempre** dentro del contenedor.
- **Estructura mínima de un nodo contrib**: `package.json` con `"node-red": { "nodes": { "<tipo>": "<archivo.js>" } }`, y por cada tipo un par `<archivo>.js` (runtime) + `<archivo>.html` (editor). Sin el `.html` el nodo no aparece en la paleta.
