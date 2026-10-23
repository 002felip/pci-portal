#!/bin/bash
# Evidência do critério "nenhuma credencial em texto puro no projeto".
# Varre os arquivos versionados (código, config, SQL, docs, notebooks) e
# falha se encontrar senha, SAS, connection string ou credencial em
# app.yaml fora de valueFrom. Não lê nem imprime valores de segredo:
# mostra só arquivo:linha e o tipo do achado.
#
#   bash tests/verifica-segredos.sh            # arquivos atuais
#   bash tests/verifica-segredos.sh --historico # também o histórico git
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP" || exit 2
achados=0
falha() { echo "  FALHA $1"; achados=$((achados + 1)); }

echo "=== 1. app.yaml: credenciais só por valueFrom ==="
for var in AZURE_SQL_USER AZURE_SQL_PASSWORD AZURE_STORAGE_SAS_TOKEN; do
  bloco=$(grep -A1 "name: '$var'" app.yaml)
  if echo "$bloco" | grep -q "valueFrom:"; then echo "  OK    $var -> valueFrom"
  else falha "$var não usa valueFrom"; fi
done

echo "=== 2. Padrões de credencial nos arquivos versionados ==="
# tests/env-exemplo.sh só tem valores fictícios do dublê de testes.
PADROES=(
  'sig=[A-Za-z0-9%/+]{20,}|SAS com assinatura'
  '(Password|Pwd|User ID|Uid)[[:space:]]*=[^;<"'"'"'$]{3,};|connection string'
  '(password|senha|secret|token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$<{]{4,}["'"'"']|atribuição literal de credencial'
  'AccountKey=|chave de storage'
)
arquivos=$(git ls-files -co --exclude-standard | grep -vE '^(node_modules/|tests/env-exemplo\.sh$|tests/verifica-segredos\.sh$|css/fontawesome-subset\.css$|assets/)')
for p in "${PADROES[@]}"; do
  re="${p%%|*}"; tipo="${p##*|}"
  # -o não é usado de propósito: nunca imprimir o valor encontrado.
  res=$(echo "$arquivos" | tr '\n' '\0' | xargs -0 grep -nIiE "$re" 2>/dev/null | cut -d: -f1,2)
  if [ -n "$res" ]; then while read -r l; do falha "$tipo em $l"; done <<< "$res"
  else echo "  OK    nenhum achado: $tipo"; fi
done

if [ "$1" = "--historico" ]; then
  echo "=== 3. Histórico git (credenciais já versionadas) ==="
  n=$(git log --all -p 2>/dev/null | grep -cE '^\+.*(sig=[A-Za-z0-9%/+]{20,}|name: .AZURE_SQL_PASSWORD.)' )
  echo "  INFO  $n linha(s) no histórico com SAS/senha versionados."
  echo "        Mitigação: ROTACIONAR (senha do login SQL e SAS). Reescrever"
  echo "        histórico não é feito por este script."
fi

echo
if [ "$achados" -eq 0 ]; then echo "RESULTADO: OK — nenhuma credencial em texto puro"; exit 0
else echo "RESULTADO: $achados achado(s)"; exit 1; fi
