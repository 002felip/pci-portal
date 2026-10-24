#!/bin/bash
# Roda toda a bateria do COO Dashboard com o dublê do mssql (nunca toca no banco).
#   bash tests/regressao.sh      (ou: npm test)
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP" || exit 2
source tests/env-exemplo.sh
status=0

echo "##### Segredos"
bash tests/verifica-segredos.sh || status=1

echo; echo "##### Modo standalone (server.js)"
PORT=3990 node -r ./tests/preload.js server.js > /tmp/coo-dashboard-teste.log 2>&1 &
PID=$!
for i in $(seq 1 30); do curl -s localhost:3990/api/ping > /dev/null && break; sleep 0.2; done
BASE=http://localhost:3990 node tests/teste-api.js || status=1
kill $PID 2>/dev/null; wait $PID 2>/dev/null

echo; echo "##### Modo Portal (portal.js)"
node -r ./tests/preload.js tests/teste-portal.js || status=1

echo
if [ $status -eq 0 ]; then echo "REGRESSÃO: OK"; else echo "REGRESSÃO: FALHOU (log do servidor em /tmp/coo-dashboard-teste.log)"; fi
exit $status
