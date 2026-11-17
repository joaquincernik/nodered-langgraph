#!/usr/bin/env bash
#
# Prueba de instalación limpia del paquete.
#
# Arma el .tgz, levanta un Node-RED nuevo en otro puerto, instala el paquete
# como lo haría otra persona, importa el ejemplo y, si hay API key, prueba la
# demo de punta a punta.
#
# Uso:
#   bash test/instalacion-limpia.sh
#   PORT=1882 bash test/instalacion-limpia.sh
#
# Variables opcionales:
#   PORT        puerto del Node-RED de prueba (1881)
#   NAME        nombre del contenedor (nodered_demo_limpio)
#   IMAGE       imagen de Node-RED (nodered/node-red:4.1.7)
#   KEEP=1      no borrar el contenedor ni el .tgz al terminar
#   SIN_DEMO=1  no ejecutar la prueba funcional de la demo
#
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAQUETE="$(cd "$AQUI/.." && pwd)"
REPO="$(cd "$PAQUETE/.." && pwd)"

PORT="${PORT:-1881}"
NAME="${NAME:-nodered_demo_limpio}"
IMAGE="${IMAGE:-nodered/node-red:4.1.7}"
BASE="http://localhost:${PORT}"

TGZ=""
LIMPIAR=1

limpiar() {
    local codigo=$?
    if [ "${KEEP:-0}" = "1" ]; then
        echo ""
        echo "KEEP=1: dejo el contenedor '$NAME' y el paquete '$TGZ'."
        echo "Cuando termines:"
        echo "  docker rm -f $NAME"
        [ -n "$TGZ" ] && echo "  rm $PAQUETE/$(basename "$TGZ")"
        return $codigo
    fi
    if [ "$LIMPIAR" = "1" ]; then
        docker rm -f "$NAME" >/dev/null 2>&1 || true
        [ -n "$TGZ" ] && rm -f "$TGZ"
        echo ""
        echo "Contenedor y .tgz de prueba eliminados."
    fi
    return $codigo
}
trap limpiar EXIT

esperar_nodered() {
    local limite="${1:-90}"
    local i
    for i in $(seq 1 "$limite"); do
        if curl -s -o /dev/null "$BASE/nodes"; then
            echo "Node-RED listo tras ${i}s."
            return 0
        fi
        sleep 1
    done
    echo "Node-RED no respondió en ${limite}s." >&2
    return 1
}

echo "== 1. Empaquetar =="
cd "$PAQUETE"
TGZ="$PAQUETE/$(npm pack 2>/dev/null | tail -1)"
if [ ! -f "$TGZ" ]; then
    echo "No se generó el .tgz." >&2
    exit 1
fi
ls -lh "$TGZ"

echo ""
echo "== 2. Levantar un Node-RED limpio en el puerto $PORT =="
docker rm -f "$NAME" >/dev/null 2>&1 || true

ENV_ARGS=()
if [ -f "$REPO/.env" ]; then
    ENV_ARGS=(--env-file "$REPO/.env")
    echo "Usando variables de $REPO/.env"
fi

docker run -d --name "$NAME" \
    -p "${PORT}:1880" \
    "${ENV_ARGS[@]}" \
    -e NODE_OPTIONS=--no-network-family-autoselection \
    "$IMAGE" >/dev/null

esperar_nodered 90

echo ""
echo "== 3. Instalar el paquete =="
docker cp "$TGZ" "$NAME:/tmp/$(basename "$TGZ")" >/dev/null
docker exec -w /data "$NAME" npm install "/tmp/$(basename "$TGZ")" 2>&1 | tail -8

echo ""
echo "== 4. Reiniciar y revisar los nodos =="
docker restart "$NAME" >/dev/null
esperar_nodered 90

NODOS="$(curl -s "$BASE/nodes" | grep -o 'langgraph-[a-z]*' | sort -u | tr '\n' ' ')"
echo "Nodos registrados: $NODOS"
CANTIDAD="$(echo "$NODOS" | wc -w | tr -d ' ')"
if [ "$CANTIDAD" != "5" ]; then
    echo "Se esperaban 5 nodos y aparecieron $CANTIDAD." >&2
    exit 1
fi

echo ""
echo "== 5. Importar el ejemplo =="
curl -s -o /dev/null -w "Importación HTTP %{http_code}\n" \
    -X POST "$BASE/flows" \
    -H "Content-Type: application/json" \
    -H "Node-RED-API-Version: v1" \
    --data-binary "@$PAQUETE/examples/demo.json"
sleep 3

curl -s -H "Node-RED-API-Version: v1" "$BASE/flows" | python3 -c "
import json, sys
flows = json.load(sys.stdin)
pestanas = [f.get('label') for f in flows if f.get('type') == 'tab']
print('Pestañas importadas:', ', '.join(pestanas) or '(ninguna)')
"
if ! curl -s -H "Node-RED-API-Version: v1" "$BASE/flows" | grep -q 'Agente con herramienta'; then
    echo "No se importó la pestaña del agente." >&2
    exit 1
fi

echo ""
echo "== 6. Prueba funcional =="
HAY_CLAVE=0
if [ -n "${GROQ_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ]; then
    HAY_CLAVE=1
fi
if [ -f "$REPO/.env" ] && grep -qE '^(GROQ|OPENAI)_API_KEY=.+' "$REPO/.env"; then
    HAY_CLAVE=1
fi

if [ "${SIN_DEMO:-0}" = "1" ]; then
    echo "SIN_DEMO=1: se omite la prueba funcional."
elif [ "$HAY_CLAVE" = "0" ]; then
    echo "No encontré API key (GROQ_API_KEY u OPENAI_API_KEY)."
    echo "La instalación quedó verificada, pero la demo no se probó."
else
    if command -v node >/dev/null 2>&1; then
        NODERED_URL="$BASE" node "$AQUI/check-demo.js"
    else
        echo "No hay node en el host para ejecutar check-demo.js."
        echo "Abrí $BASE y probá los inject a mano."
    fi
fi

echo ""
echo "Instancia de prueba: $BASE"
echo "Revisar errores:"
echo "  docker logs --since 5m $NAME 2>&1 | grep -iE '\\[error\\]|failed' || echo 'sin errores'"
