# Proyecto de contribucion para nodered

En este proyecto se plantea la contribucion al ecosistema nodered tomando como referencia el framework de desarrollo de agentes de IA como nodered

## Definicion de alcance

### Nodos esenciales

* `langgraph-start:` Recibe el input inicial y crea/inicializa el objeto msg.state con variables y un contador de iteraciones (para evitar bucles infinitos).

* `langgraph-llm:` Nodo ejecutor que llama a una API de LLM (ej. OpenAI / Ollama), procesa el prompt con el estado actual e inyecta la respuesta en msg.state.messages.

* `langgraph-router:` Nodo condicional con múltiples salidas (puertos). Analiza msg.state (por ejemplo, si el LLM solicitó una herramienta o finalizó) y redirige el flujo.

* `langgraph-tool:` Puente hacia una herramienta. Una herramienta es un flujo normal de Node-RED expuesto por HTTP: este nodo le pasa el pedido y guarda la respuesta en el expediente.

* `langgraph-end:` Consolida el resultado final del estado y emite la respuesta formateada hacia fuera del grafo.

### Flujo de Ejemplo (Demo)
Un flujo importable en Node-RED que muestre un agente contestando preguntas con un bucle de reintento/corrección.

### Documentación Básica
README.md con instalación, arquitectura de msg.state y captura del flujo.

 ### Fuera del alcance
* Persistencia en bases de datos externas (PostgreSQL / Redis para checkpointing).

* Modificaciones visuales avanzadas al canvas de Node-RED (usaremos los nodos e interfaces estándar).

* Soporte nativo para decenas de proveedores de IA simultáneos (nos enfocaremos en OpenAI o un endpoint compatible como Ollama/Groq).

### Plan de Trabajo: 5 Clases (1.5 h cada una)

| Clase | Tema Principal | Entregable de la Clase |
|-------|----------------|------------------------|
| Clase 1 | Arquitectura y Setup | • Explicar conceptos clave de LangGraph (Estado, Nodos, Aristas, Router).<br>• Definir el contrato de datos `msg.state`.<br>• Clonar repo y verificar entorno Docker/npm local.<br>• Definición formal de `msg.state`.<br>• Estrategia de ramas Git y asignación de tareas. |
| Clase 2 | Desarrollo de Nodos Base | • Crear la estructura de `langgraph-start` y `langgraph-end`.<br>• Configurar el nodo global de credenciales/API Key si aplica.<br>• Nodos Start y End funcionales en el canvas. |
| Clase 3 | Lógica Core: LLM y Enrutador | • Desarrollar `langgraph-llm` (llamada a la API de IA).<br>• Desarrollar `langgraph-router` (múltiples salidas de puerto según condiciones).<br>• LLM procesa mensajes.<br>• Router bifurca el camino según el estado. |
| Clase 4 | Bucle de Ciclo, Control de Recursión e Integración | • Conectar el bucle completo: Start → LLM → Router → (Herramienta/Nodo Node-RED) → LLM → End.<br>• Probar el contador de iteraciones límite (máx. 5 ciclos).<br>• Grafo completo ejecutando ciclos sin colgar Node-RED. |
| Clase 5 | Polishing, Documentación y Demo | • Empaquetar y probar la instalación limpia vía `npm pack` / `npm link`.<br>• Redactar el README.md y exportar el flujo de ejemplo (`examples/demo.json`).<br>• Paquete listo para publicar en npm.<br>• Demostración del equipo. |

### definicion del msg.state
```json
{
  "state": {
    "version": 1,
    "run_id": "0f7c2a1e-...",
    "messages": [
      { "type": "human", "data": { "content": "Hola" } },
      { "type": "ai", "data": { "content": "..." } }
    ],
    "next_node": "llm",
    "status": "RUNNING",
    "iterations": 1,
    "max_iterations": 5
  }
}
```

- `version`: versión del formato, para poder reconocer expedientes viejos si el contrato cambia.
- `run_id`: identificador único de cada corrida (útil para trazas y, más adelante, puntos de guardado).
- `status`: `RUNNING` mientras el grafo trabaja; al terminar puede quedar en `COMPLETED`, `MAX_ITERATIONS`, `ERROR` o `INTERRUPTED`.

## Herramientas = flujos de Node-RED

La idea central del proyecto es que **una herramienta no es código especial**:
es un flujo normal de Node-RED que recibe un dato, hace su trabajo y devuelve
una respuesta. El agente lo usa igual que LangGraph usa sus herramientas.

### El pedido

Antes de ir al nodo `langgraph-tool`, el expediente lleva anotado qué hace falta:

```json
{
  "state": {
    "tool_request": { "name": "clima", "input": "Rosario" },
    "next_node": "tool"
  }
}
```

`name` tiene que coincidir con el **nombre de la herramienta** configurado en el
nodo; `input` es el dato que necesita el flujo. El `langgraph-router` manda el
mensaje por su salida `tool` y, al terminar, el nodo deja `next_node = "llm"`
para que el modelo lea el resultado.

### El flujo herramienta

Se arma con nodos comunes, en la misma pestaña o en otra:

```
http in (POST /tool/clima)  →  function (hace el trabajo)  →  http response
```

Puede devolver texto plano, `{ "output": "..." }` o cualquier JSON. Se prueba
solo, sin el agente:

```bash
curl -X POST http://localhost:1880/tool/clima \
  -H "Content-Type: application/json" \
  -d '{"name":"clima","input":"Rosario"}'
```

### Qué guarda el nodo

La respuesta se agrega al historial como un mensaje de usuario:

```
[Resultado de la herramienta "clima"] Soleado, 24 °C
```

Se usa un mensaje de usuario a propósito: algunos proveedores solo aceptan
mensajes de herramienta cuando el modelo la pidió a su manera. Así el resultado
funciona con todos y el modelo lo entiende igual. Si el flujo falla, la falla se
guarda igual como mensaje y el modelo decide qué hacer; el bucle sigue limitado
por `max_iterations`.

## Puesta en marcha

Requisitos: Docker y Docker Compose.

```bash
cp .env.example .env          # completar GROQ_API_KEY
docker compose up -d          # Node-RED en http://localhost:1880
```

> Si cambiás una variable de `.env`, el contenedor tiene que **recrearse**:
> `docker compose up -d --force-recreate`. Un `docker compose restart` no vuelve
> a leer el archivo, y el contenedor sigue usando la variable anterior.

El flujo de ejemplo ya está desplegado en `node-red-data/flows.json`. Para probarlo, abrir el editor y hacer clic en el botón del nodo `inject`; la respuesta aparece en la pestaña **Debug**.

### Estructura del entorno

- `node-red-data/` es el **userDir** de la instancia (montado como `/data`): ahí viven los flows, las credenciales, `settings.js` y las dependencias. **No copiar esta carpeta desde otro proyecto**: arrastra nodos de configuración y dependencias ajenas que impiden que Node-RED arranque.
- `node-red-contrib-langgraph/` es el paquete de nodos, montado en `/data/node_modules/node-red-contrib-langgraph` para desarrollo.
- `node-red-data/package.json` se mantiene **sin dependencias**: los nodos del paquete se montan aparte y los nodos core ya vienen en la imagen.

### Ciclo de desarrollo

```bash
# Solo si cambian las dependencias del paquete
docker exec -w /data/node_modules/node-red-contrib-langgraph nodered_pfs2026 npm ci

# Node-RED no recarga nodos en caliente: reiniciar tras cambiar un .js
docker compose restart
```