# AGENTS.md

## Qué es este repo

Entorno Node-RED (v4.1.7, Docker) para desarrollar un paquete de nodos contrib inspirado en LangGraph (START, LLM, END, ...). El paquete se desarrolla en `./node-red-contrib-langgraph/` y se instala en Node-RED en vivo. No hay build, lint, test ni CI en este repo.

## Comandos

```bash
docker compose up -d                       # levanta Node-RED en http://localhost:1880
docker compose down                        # para
docker compose logs -f nodered_soa2026     # logs (service: nodered_soa2026, container: nodered_pfs2026)
```

## Ciclo de desarrollo de nodos

Node-RED **no recarga el código de nodos en caliente**: cada cambio requiere reinstalar y reiniciar.

```bash
# 1. Empaquetar el paquete (en el host, desde el directorio del paquete)
npm pack

# 2. Mover el .tgz a node-red-data/ (ese directorio está montado como /data en el contenedor)
mv node-red-contrib-langgraph-*.tgz ../node-red-data/

# 3. Instalar DENTRO del contenedor, con cwd /data
docker exec -w /data nodered_pfs2026 npm install /data/node-red-contrib-langgraph-*.tgz

# 4. Reiniciar para que cargue los nodos nuevos
docker compose restart

# 5. Verificar: sin errores de registro en los logs, y el nodo aparece en la API
docker logs nodered_pfs2026 2>&1 | grep -iE "error|failed"
curl -s http://localhost:1880/nodes | grep -i langgraph
```

El `-w /data` es obligatorio: sin él npm instala en `/usr/src/node-red` (cwd del contenedor) y Node-RED no ve los nodos, porque solo carga desde `/data/node_modules`.

## Estructura

- `docker-compose.yml` — servicio único; corre como `root` **a propósito** para poder instalar paquetes npm adentro.
- `node-red-data/` — userDir de Node-RED, montado como `/data`. Es el estado real de la instancia:
  - `package.json` + `package-lock.json` — lista de nodos instalados; se commitean. Si instalás un nodo, commiteá ambos.
  - `flows.json` — definiciones de flujos; **lo reescribe el editor**, no editar a mano con el contenedor corriendo.
  - `settings.js` — configuración de Node-RED (cargada al iniciar).
- `node-red-contrib-langgraph/` — paquete de nodos en desarrollo (paquete npm estándar de Node-RED).

## Gotchas

- **Permisos root**: el contenedor escribe como root, así que archivos como `flows.json` quedan root-owned y git/edits fallan con "permission denied". Fix: `sudo chown -R $(id -u):$(id -g) node-red-data`.
- **Credenciales**: `node-red-data/flows_cred.json` está commiteado; no meter credenciales reales ahí (no hay `adminAuth` configurado: es un entorno local).
- **Node version skew**: el host corre Node 22, el contenedor Node 20. Usá el host solo para `npm pack`; la instalación siempre es dentro del contenedor.
- **Estructura mínima de un nodo contrib**: `package.json` con `"node-red": { "nodes": { "<tipo>": "<archivo.js>" } }`, y por cada tipo un par `<archivo>.js` (runtime) + `<archivo>.html` (editor). Sin el `.html` el nodo no aparece en la paleta.
