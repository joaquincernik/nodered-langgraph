# Pruebas

Esta carpeta guarda las pruebas que antes vivían en `/tmp` y se perdían.
No se publican en npm: el `package.json` sólo empaqueta `lib`, `nodes` y
`examples`.

Son cuatro pruebas y cada una cubre una cosa distinta:

| Prueba | Necesita Node-RED | Necesita API key | Qué comprueba |
|--------|-------------------|------------------|----------------|
| `memory.test.js` | No | No | La memoria entre corridas y la limpieza de mensajes. |
| `check-demo.js` | Sí | Sí | La demo del agente: consulta, herramienta y seguimiento. |
| `regression-tabs.js` | Sí | Sí | Que las pestañas 1 a 4 sigan respondiendo. |
| `instalacion-limpia.sh` | No (levanta uno) | Opcional | Que el `.tgz` se instale y funcione en un Node-RED nuevo. |

## 1. Memoria, sin Node-RED

Simula el contexto de una pestaña y prueba los nodos de inicio y fin.

```bash
cd node-red-contrib-langgraph
node test/memory.test.js
```

Dentro del contenedor de desarrollo:

```bash
docker exec -w /data/node_modules/node-red-contrib-langgraph \
  nodered_pfs2026 node test/memory.test.js
```

Qué revisa:

- Con la memoria apagada no se guarda nada.
- La primera corrida crea la conversación.
- El nodo de fin guarda el historial.
- La segunda corrida recupera lo anterior y agrega el mensaje nuevo.
- `msg.conversationId` gana sobre la clave configurada.
- `msg.resetConversation = true` borra lo anterior.
- Un pedido de herramienta sin responder se descarta al guardar.

## 2. Demo del agente

Necesita Node-RED encendido, la pestaña **5-Agente con herramienta** con la
memoria activada y una API key cargada.

```bash
cd node-red-contrib-langgraph
node test/check-demo.js
```

Contra otra instancia:

```bash
NODERED_URL=http://localhost:1881 node test/check-demo.js
```

La prueba hace esto:

1. Borra la memoria de la conversación de prueba.
2. Dispara **Nueva conversación** y espera la primera respuesta.
3. Dispara **Consulta** y verifica que se haya usado la herramienta del clima.
4. Dispara **Seguimiento** y verifica que el historial creció y que hay
   respuesta nueva.

No usa WebSocket: dispara los inject por HTTP y lee el contexto de la pestaña.
Por eso sirve igual contra el Node-RED de desarrollo o contra uno limpio.

Variables:

| Variable | Por defecto | Para qué |
|----------|-------------|----------|
| `NODERED_URL` | `http://localhost:1880` | Dónde está Node-RED. |
| `TAB_LABEL` | `Agente` | Parte del nombre de la pestaña. |
| `TAB_ID` | vacío | Fija la pestaña por id. |
| `TIMEOUT_MS` | `180000` | Espera máxima por paso. |

## 3. Regresión de las pestañas 1 a 4

Dispara el inject de cada pestaña y espera el mensaje del nodo debug:

| Pestaña | Inject | Debug |
|---------|--------|-------|
| 1-Augmented LLM | Prompt | debug 1 |
| 2-Prompt chaining | Tema | Broma final |
| 3-Bucle con límite | Consulta | Resultado final |
| 4-Bucle con criterio | Consulta | Resultado final |

```bash
cd node-red-contrib-langgraph
node test/regression-tabs.js
```

Necesita una API key porque las cuatro pestañas llaman al modelo. También
consume cuota y puede tardar uno o dos minutos.

Para leer los debug se conecta al WebSocket `/comms` de Node-RED con un cliente
mínimo propio (`test/support/ws.js`). Así no hace falta agregar `ws` como
dependencia.

## 4. Instalación limpia

Arma el `.tgz`, levanta un Node-RED aparte en el puerto 1881, instala el
paquete, importa el ejemplo y prueba la demo si encuentra una API key.

```bash
cd node-red-contrib-langgraph
bash test/instalacion-limpia.sh
```

Opciones:

| Variable | Por defecto | Para qué |
|----------|-------------|----------|
| `PORT` | `1881` | Puerto del Node-RED de prueba. |
| `NAME` | `nodered_demo_limpio` | Nombre del contenedor. |
| `IMAGE` | `nodered/node-red:4.1.7` | Imagen a usar. |
| `KEEP=1` | apagado | Deja el contenedor y el `.tgz` para revisarlos. |
| `SIN_DEMO=1` | apagado | Verifica la instalación sin llamar al modelo. |

Si existe un `.env` en la raíz del repositorio, el script lo pasa al
contenedor. Si no hay API key, igual verifica que los 5 nodos se registren y
que el ejemplo se importe.

## Atajos

```bash
npm test                 # memoria
npm run test:demo        # demo del agente
npm run test:regression  # pestañas 1 a 4
npm run test:clean-install
```

## Si algo falla

- **No aparece la pestaña o el inject**: revisar que el ejemplo esté
  importado y que los nombres no hayan cambiado.
- **Se agota la espera**: mirar los logs con
  `docker logs --since 5m nodered_pfs2026`. Suele ser la API key, la cuota del
  proveedor o la herramienta del clima.
- **`Encrypted credentials not found`**: es normal en una instancia nueva.
  Se va al cargar la API key en el nodo LLM.
- **Cambiaste un `.js` y no toma efecto**: Node-RED no recarga en caliente.
  Reiniciar con `docker compose restart`.
