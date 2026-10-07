#!/bin/bash
# Bateria de regressão trazida para o repositório em 20/09/2026 (era
# scratchpad de sessão). 9 suítes, cada uma com o dublê (fake-mssql-*.js
# — intercepta o módulo "mssql" antes do server.js carregar, nunca abre
# conexão de verdade) e a porta que ela espera.
#
# Requer Playwright + Chromium instalados (o mesmo runtime usado para
# desenvolver este projeto). Ajuste NAVEGADOR_CHROMIUM abaixo se o seu
# ambiente não tiver o Chromium em /opt/pw-browsers.
TESTS="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$TESTS/.." && pwd)"
source "$TESTS/env-exemplo.sh" >/dev/null 2>&1

subir() { # subir <porta> <preload>
  fuser -k -n tcp "$1" 2>/dev/null; sleep 0.5
  ( cd "$APP" && env PORT="$1" setsid node -r "$TESTS/$2" server.js \
      > "$TESTS/.reg-$1.log" 2>&1 < /dev/null & )
  sleep 7
}

rodar() { # rodar <porta> <preload> <suite...>
  local porta=$1 pre=$2; shift 2
  subir "$porta" "$pre"
  for s in "$@"; do
    echo "════ $s"
    ( cd "$TESTS" && timeout 300 node "$s" 2>&1 | tail -4 )
  done
  fuser -k -n tcp "$porta" 2>/dev/null
}

rodar 3994 preload.js        teste-ui-foto.js teste-ficha.js teste-icones.js
rodar 3995 preload.js        teste-fechar.js
rodar 3997 preload-sites.js  teste-site-aprovador.js teste-grupos-admin.js
rodar 3998 preload-captura.js varre-modais.js
rodar 3999 preload-muitos.js conf-masonry.js
rodar 4000 preload-gate.js   teste-gate-mdm.js
rodar 3996 preload-lixeira.js teste-lixeira-kaizen.js
