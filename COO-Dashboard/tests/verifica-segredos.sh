#!/bin/bash
# Evidência do critério "nenhuma credencial em texto puro" (mesmo script do
# VBM Kaizen, adaptado). Varre os arquivos da pasta e falha se encontrar senha,
# SAS, connection string ou credencial em app.yaml fora de valueFrom. Não
# imprime valores: mostra só arquivo:linha e o tipo do achado.
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP" || exit 2
achados=0
falha() { echo "  FALHA $1"; achados=$((achados + 1)); }

echo "=== 1. app.yaml: credenciais só por valueFrom ==="
for var in AZURE_SQL_USER AZURE_SQL_PASSWORD; do
  bloco=$(grep -A1 "name: '$var'" app.yaml)
  if echo "$bloco" | grep -q "valueFrom:"; then echo "  OK    $var -> valueFrom"
  else falha "$var não usa valueFrom"; fi
done

echo "=== 2. Padrões de credencial nos arquivos ==="
PADROES=(
  'sig=[A-Za-z0-9%/+]{20,}|SAS com assinatura'
  '(Password|Pwd|User ID|Uid)[[:space:]]*=[^;<"'"'"'$]{3,};|connection string'
  '(password|senha|secret|token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'$<{]{4,}["'"'"']|atribuição literal de credencial'
  'AccountKey=|chave de storage'
)
arquivos=$(find . -type f -not -path './node_modules/*' -not -name '.env' -not -path './tests/env-exemplo.sh' -not -path './tests/verifica-segredos.sh' | sort)
for p in "${PADROES[@]}"; do
  re="${p%%|*}"; tipo="${p##*|}"
  res=$(echo "$arquivos" | tr '\n' '\0' | xargs -0 grep -nIiE "$re" 2>/dev/null | cut -d: -f1,2)
  if [ -n "$res" ]; then while read -r l; do falha "$tipo em $l"; done <<< "$res"
  else echo "  OK    nenhum achado: $tipo"; fi
done

echo "=== 3. .env fora do controle de versão ==="
if grep -qx '.env' .gitignore; then echo "  OK    .env no .gitignore"; else falha ".env não está no .gitignore"; fi

echo
if [ "$achados" -eq 0 ]; then echo "RESULTADO: OK — nenhuma credencial em texto puro"; exit 0
else echo "RESULTADO: $achados achado(s)"; exit 1; fi
