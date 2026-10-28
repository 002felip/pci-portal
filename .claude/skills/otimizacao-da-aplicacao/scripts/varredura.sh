#!/usr/bin/env bash
# Varredura inicial da auditoria (Otimização da Aplicação).
# Uso: scripts/varredura.sh <pasta-da-aplicacao>
# Mostra arquivo:linha e o TIPO do candidato — nunca o conteúdo da linha nos itens de segredo.
# Cada resultado é um CANDIDATO: confirme lendo o código antes de virar gap.
set -u
ALVO="${1:-.}"
EXCL=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude=*.min.js --exclude=*.map --exclude=package-lock.json)
ARQS=(--include=*.js --include=*.ts --include=*.mjs --include=*.cjs --include=*.html --include=*.py --include=*.sql --include=*.json --include=*.yaml --include=*.yml --include=*.env --include=*.ipynb --include=*.md)

secao() { printf '\n== %s ==\n' "$1"; }
# só arquivo:linha (sem o conteúdo)
local_() { grep -rInE "${EXCL[@]}" "${ARQS[@]}" "$1" "$ALVO" 2>/dev/null | cut -d: -f1,2 | awk -v t="$2" '{ print $0 "  [" t "]" }'; }
# arquivo:linha:trecho curto (itens sem risco de expor segredo)
trecho() { grep -rInE "${EXCL[@]}" "${ARQS[@]}" "$1" "$ALVO" 2>/dev/null | cut -c1-160; }

secao "Segredos (candidatos — valor omitido)"
local_ "(password|passwd|pwd|secret|client_secret|api[_-]?key|token)[\"' ]*[:=][\"' ]*[^\"' ,;)}{]{6,}" "atribuição literal de senha/segredo"
local_ "(Server|Data Source)=[^;]+;.*(Password|Pwd)=" "connection string com senha"
local_ "-----BEGIN [A-Z ]*PRIVATE KEY-----" "chave privada"
local_ "eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\." "JWT literal"
local_ "AccountKey=|SharedAccessSignature=|sig=[A-Za-z0-9%]{20,}" "chave/SAS do Azure Storage"
git -C "$ALVO" ls-files 2>/dev/null | grep -E '(^|/)\.env($|\.)' | awk '{ print $0 "  [.env versionado]" }'

secao "Sinks de HTML e execução dinâmica (conferir escape)"
trecho "\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write\(|eval\(|new Function\(|setTimeout\(\s*['\"]"

secao "SQL montada por texto (conferir se entra dado da requisição)"
trecho "(query|execute|request)\([^)]*\\\$\{|(SELECT|INSERT|UPDATE|DELETE)[^;]*['\"]\s*\+\s*[a-zA-Z_]"
trecho "CONCAT\([^)]*ID_[A-Z]+[^)]*\)\s*=\s*CONCAT"

secao "Funções em colunas de filtro/junção (não-sargável)"
trecho "WHERE[^;]*(LTRIM|RTRIM|UPPER|LOWER|YEAR|MONTH|CONVERT|CAST)\(|FORMAT\("

secao "Valores fixos de ambiente (URLs, servidores, bases, portas)"
trecho "https?://[a-zA-Z0-9.-]+\.(net|com|io|cloud|windows\.net|azuredatabricks\.net)[^\"' ]*|\.database\.windows\.net|_PRD['\"]|_DEV['\"]|:1433"

secao "Rotas do servidor (comparar com o que a interface chama)"
trecho "(app|router)\.(get|post|put|patch|delete|use)\(\s*['\"\`]"

secao "Chamadas da interface"
trecho "fetch\(|apiGet\(|axios\.|XMLHttpRequest"

secao "Timeouts, pools e caches"
trecho "requestTimeout|connectionTimeout|pool:\s*\{|TTL|setTimeout\([a-zA-Z_]+,\s*[0-9]{4,}"

secao "Dependências"
for f in $(find "$ALVO" -name package.json -not -path '*/node_modules/*' 2>/dev/null); do
  d=$(dirname "$f"); printf '%s  lockfile: %s\n' "$f" "$([ -f "$d/package-lock.json" ] && echo sim || echo NÃO)"
done
echo "Rode: npm audit --omit=dev (na pasta com lockfile) e confira se o caminho vulnerável é usado."
