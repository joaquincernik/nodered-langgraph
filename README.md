# Proyecto de contribucion para nodered

En este proyecto se plantea la contribucion al ecosistema nodered tomando como referencia el framework de desarrollo de agentes de IA como nodered

## Definicion de alcance

### Nodos esenciales

* `langgraph-start:` Recibe el input inicial y crea/inicializa el objeto msg.state con variables y un contador de iteraciones (para evitar bucles infinitos).

* `langgraph-llm:` Nodo ejecutor que llama a una API de LLM (ej. OpenAI / Ollama), procesa el prompt con el estado actual e inyecta la respuesta en msg.state.messages. También descubre las herramientas de su pestaña y lee los pedidos del modelo de forma nativa.

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

### Cómo el modelo pide una herramienta

El nodo `langgraph-llm` busca los nodos `langgraph-tool` de **su misma
pestaña** y le presenta al modelo el nombre y la descripción de cada uno. Si el
modelo decide usar una, el pedido queda anotado en el expediente:

```json
{
  "state": {
    "tool_request": { "name": "clima", "input": "Rosario, Argentina", "id": "call_..." },
    "next_node": "tool"
  }
}
```

- `name` coincide con el **nombre de la herramienta** configurado en el nodo.
- `input` es el dato que el modelo eligió mandar.
- `id` lo pone el proveedor (o el nodo, si el proveedor no lo manda) y sirve
  para emparejar la respuesta con el pedido.

El `langgraph-router` manda el mensaje por su salida `tool`, el nodo de
herramienta hace su trabajo y deja `next_node = "llm"` para que el modelo lea
el resultado y responda.

Reglas prácticas:

- **Una herramienta por vuelta.** Si el modelo pide varias, se ejecuta la
  primera y se avisa por el log. Así no quedan pedidos sin respuesta.
- **Solo la misma pestaña.** Si querés que el agente no vea una herramienta,
  movela a otra pestaña.
- **La descripción importa.** Es lo que lee el modelo para decidir cuándo
  usarla. Conviene escribir para qué sirve y qué dato espera.
- **Se puede apagar.** El campo *Herramientas* del nodo LLM permite
  desactivarlas para un proveedor que no las soporta o para aislar un problema.

### Si el proveedor no soporta herramientas

El nodo avisa por el log y reintenta una vez sin ellas. El grafo sigue
funcionando, solo que el modelo ya no puede pedir herramientas por su cuenta.

Para esos casos queda el **modo manual**: un nodo Function o un Change arma el
pedido sin `id`, y el modelo lo recibe como texto. Es la misma idea de antes,
sin depender del proveedor.

### El flujo herramienta

Se arma con nodos comunes. El nodo `langgraph-tool` tiene que estar en la misma
pestaña que el LLM; el flujo HTTP que ese nodo llama puede vivir en cualquier
pestaña. La demo del clima usa esta cadena:

```
http in (POST /tool/clima) → buscar ciudad → consultar clima → http response
```

No hace falta clave ni registro: usa **Open-Meteo**, un servicio gratuito.
El pedido se escribe como `Ciudad, País`. Si no se indica país, se intenta
Argentina y, si la ciudad no aparece ahí, se usa el resultado más relevante del
mundo (el país se muestra igual en la respuesta). Si el país se indicó y la
ciudad no está en él, el flujo avisa y sugiere dónde sí existe. Para los países
más comunes, el nombre se puede escribir en español o en inglés
(por ejemplo, `España` o `Spain`).

Puede devolver texto plano, `{ "output": "..." }` o cualquier JSON. Se prueba
solo, sin el agente:

```bash
curl -X POST http://localhost:1880/tool/clima \
  -H "Content-Type: application/json" \
  -d '{"name":"clima","input":"Rosario, Argentina"}'
```

Respuesta de ejemplo:

```json
{"output":"Clima en Rosario, Santa Fe (Argentina): Nublado, 23 °C (sensación 24 °C). Humedad 74 %, viento 13 km/h del sur. Hoy: máxima 29 °C, mínima 20 °C."}
```

La herramienta es reemplazable: mañana ese mismo flujo puede llamar a otra API,
a una base de datos o a cualquier cálculo, sin tocar el agente.

### Qué guarda el nodo

Hay dos casos, según cómo llegó el pedido:

- **Pedido del modelo (trae `id`):** se guarda un **mensaje de herramienta**
  (`ToolMessage`) con ese identificador. Es lo que el proveedor espera y lo que
  permite seguir la conversación sin errores.
- **Pedido manual (sin `id`):** se guarda un mensaje de usuario:

  ```
  [Resultado de la herramienta "clima"] Nublado, 23 °C
  ```

Si el flujo falla, la falla se guarda igual, con el mismo formato, y se le pide
al modelo que no insista con esa herramienta. El bucle sigue limitado por
`max_iterations`.

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