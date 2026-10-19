# Proyecto de contribucion para nodered

En este proyecto se plantea la contribucion al ecosistema nodered tomando como referencia el framework de desarrollo de agentes de IA como nodered

## Definicion de alcance

### Nodos esenciales

* `langgraph-start:` Recibe el input inicial y crea/inicializa el objeto msg.state con variables y un contador de iteraciones (para evitar bucles infinitos).

* `langgraph-llm:` Nodo ejecutor que llama a una API de LLM (ej. OpenAI / Ollama), procesa el prompt con el estado actual e inyecta la respuesta en msg.state.messages.

* `langgraph-router:` Nodo condicional con múltiples salidas (puertos). Analiza msg.state (por ejemplo, si el LLM solicitó una herramienta o finalizó) y redirige el flujo.

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
    "messages": [
      { "role": "user", "content": "Hola" },
      { "role": "assistant", "content": "..." }
    ],
    "next_node": "agent",
    "status": "RUNNING",
    "iterations": 1,
    "max_iterations": 5
  }
}
```