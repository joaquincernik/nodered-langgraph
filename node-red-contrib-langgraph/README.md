# node-red-contrib-langgraph

Nodos para armar agentes de IA en Node-RED inspirados en LangGraph.

Con estos nodos se conecta un agente en el canvas, como si fuera un circuito:

```
inicio → modelo → router → herramienta → fin
```

El agente puede usar herramientas hechas como flujos normales de Node-RED,
recordar una conversación entre corridas y cortar el bucle cuando termina o
cuando se alcanza un límite.

## Requisitos

- Node-RED 3 o superior.
- Node.js 20 o superior.
- Una clave de API de un proveedor compatible:
  - Groq
  - OpenAI
  - Un endpoint tipo OpenAI, como Ollama o LM Studio

## Instalación

Desde el directorio de usuario de Node-RED (por ejemplo `/data`):

```bash
npm install node-red-contrib-langgraph
```

También se puede instalar desde el editor:
**Menú → Administrar paleta → Instalar**, buscando
`node-red-contrib-langgraph`.

Después de instalar, reiniciar Node-RED para que cargue los nodos.

## Nodos

| Nodo | Para qué sirve |
|------|----------------|
| `langgraph-start` | Recibe la pregunta inicial y arma el expediente de la conversación. |
| `langgraph-llm` | Habla con el modelo de IA, descubre las herramientas de su pestaña y guarda las respuestas. |
| `langgraph-router` | Decide el próximo paso: seguir, terminar o llamar a una herramienta. |
| `langgraph-tool` | Llama a una herramienta hecha como flujo de Node-RED y guarda el resultado. |
| `langgraph-end` | Cierra la conversación y entrega la respuesta final. |

## Ejemplo rápido

1. Importar `examples/demo.json` desde el editor:
   **Menú → Importar**.
2. Abrir la pestaña **5-Agente con herramienta**.
3. Configurar la API key en el nodo `llm`, o definir la variable de entorno
   del proveedor (`GROQ_API_KEY`, `OPENAI_API_KEY`, etc.).
4. Hacer **Deploy** y presionar el inject **Consulta**.
5. Probar **Seguimiento** para ver la memoria y **Nueva conversación** para
   empezar de cero.

> La primera vez puede aparecer el aviso `Encrypted credentials not found`.
> Es normal: Node-RED avisa que todavía no hay credenciales guardadas. Se va
> al cargar la API key en el nodo `llm` y hacer Deploy.

El ejemplo incluye el agente y la herramienta del clima. El clima usa
Open-Meteo, un servicio gratuito que no pide clave.

## Modelos

El campo **Modelo** se escribe como `proveedor:modelo`. Por ejemplo:

```
groq:openai/gpt-oss-120b
openai:gpt-4o-mini
```

Para Ollama o LM Studio, usar el proveedor `openai` y completar la
**Base URL** del nodo, por ejemplo:

```
http://localhost:11434/v1
```

La API key se busca en este orden:

1. La credencial del nodo.
2. La variable de entorno del proveedor (`GROQ_API_KEY`,
   `OPENAI_API_KEY`, etc.).

## Herramientas

Una herramienta es un flujo normal de Node-RED con una entrada HTTP que
devuelve texto o un objeto con la forma:

```json
{ "output": "resultado" }
```

Se agrega un nodo `langgraph-tool` en la misma pestaña que el LLM, se le pone
un nombre, una descripción y la URL del flujo. El modelo decide cuándo usarla.

La descripción es importante: es lo que lee el modelo para saber para qué sirve
la herramienta y qué dato espera.

## Memoria

El nodo `langgraph-start` puede recordar la conversación entre corridas:

- Se activa con el campo **Memoria**.
- Se puede poner una **Clave** para separar conversaciones.
- `msg.conversationId` tiene prioridad sobre la clave configurada.
- `msg.resetConversation = true` borra la conversación anterior.

La memoria vive en el contexto de la pestaña y **se pierde al reiniciar
Node-RED**. Para conservarla en disco hay que configurar `contextStorage` en
`settings.js`.

## Documentación completa

El repositorio incluye una guía más detallada con el contrato de `msg.state`,
el bucle del grafo y los pendientes de publicación:

https://github.com/joaquincernik/nodered-langgraph

## Licencia

MIT. Ver el archivo `LICENSE`.
