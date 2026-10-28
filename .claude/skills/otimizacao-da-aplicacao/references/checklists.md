# Checklists da auditoria

Marque cada item como achado (com ID), "verificado sem achado" ou "não se aplica". Referências: OWASP Top 10 (A01–A10), ASVS, CWE.

## A. Autenticação e sessão
- De onde vem a identidade? (Entra ID/OIDC no app, ou header de proxy — ex.: `X-Forwarded-Email` do Databricks Apps). Se for header: o app só é alcançável pelo proxy? Há modo local que simula o header? Está restrito a desenvolvimento explícito?
- Tokens no navegador (`localStorage`, URL)? Expiração, renovação, logout.
- Rotas sem autenticação (health, ping, estáticos) — o que expõem?

## B. Autorização
- Validação só no front-end? Toda rota de dados checa no back-end?
- Granularidade: por perfil, BU/site, operação, dashboard. Qualquer usuário autenticado vê tudo? Isso é a política ou falta de controle?
- IDOR: trocar `site`, `id` na URL traz dado de outro escopo?
- Rotas administrativas/diagnóstico abertas; privilégio do login do banco (só `SELECT` no necessário?).

## C. Entradas e saídas
- SQL montada por concatenação/template com dado da requisição (CWE-89). Nomes de coluna/tabela dinâmicos validados por regex?
- Sinks de HTML (`innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`) — todo dado externo passa por escape? Atributos com aspas consistentes?
- `eval`, `Function`, `setTimeout(string)`; path traversal (`..`, `%2e`, `%5c`); upload (tipo, tamanho, conteúdo); erro com stack/texto do banco na resposta.

## D. APIs e comunicação
- Rotas que a interface não usa (dataset inteiro, diagnóstico).
- Limite de taxa; CORS; métodos; dados sensíveis em query string.
- Timeouts no cliente e no servidor; retry: em quais erros? Retry em 5xx amplifica queda (retry storm).
- Fallback de URL para caminho de OUTRA aplicação (ex.: `/api/` na raiz pertencendo a outro app).
- Payload além do necessário; paginação/limites.

## E. Segredos e configuração
- Literais de senha/token/connection string em código, YAML, JSON, notebooks, comentários, testes, `.env` versionado.
- Histórico do git (atenção a clone raso — `git rev-parse --is-shallow-repository`).
- Credencial compartilhada entre aplicações; registro de exposição anterior e rotação.
- Padrão de ambiente apontando para produção quando falta variável.

## F. Banco de dados
- Junção por `CONCAT` de chaves sem separador (colisão `1|1|15` × `11|1|5` = `'1115'`) e não-sargável.
- Funções em coluna filtrada (`LTRIM(RTRIM(col)) = @x`, `YEAR(col) = …`), `FORMAT()` por linha, `SELECT *`.
- `CROSS APPLY`/subconsulta que multiplica linhas; volume transferido × usado.
- `NULL` convertido em 0 (vira "zero" na tela em vez de "sem dado") — regra de negócio a confirmar.
- Duplicidade no cadastro somada em silêncio; falta de restrição única.
- Datas/IDs de processo fixos na query.
- Índices: só com plano real, cardinalidade, frequência de uso e de escrita.

## G. Dependências e supply chain
- `npm audit --omit=dev` (ou equivalente) — o caminho vulnerável é exercido pela aplicação?
- Versões abertas (`^`), lockfile ausente, `node_modules` versionado, pacotes sem uso, CDN externo.

## Performance
- **Front:** tamanho do bundle/HTML, fontes externas bloqueando render, chamadas na carga (sequenciais × paralelas), repetição a cada interação, redesenho em resize, listas grandes sem paginação, animações, memória.
- **Back:** pool de conexões (tamanho × consultas pesadas em paralelo), cache (TTL, invalidação, refresh do usuário, dado anterior em falha), deduplicação de pedidos simultâneos, varredura do dataset por requisição, logs excessivos.
- **Rede:** compressão, `Cache-Control`, timeouts, retries, chamadas duplicadas.
- Para cada gap: métrica (tempo, linhas, leituras/h, p95, bytes, LCP/FCP) e como medir antes/depois.

## Hardcoded — classificação
1 inadequado · 2 constante legítima · 3 configuração por ambiente · 4 regra de negócio · 5 dado mestre · 6 valor visual · 7 segredo. Procurar: servidores/bases, IDs (dashboard, sites, grupos), listas de sites/países/BUs, nomes curtos, polaridade (custo × receita), notas de rodapé por BU, datas iniciais, TTLs/timeouts/limites, cores/tamanhos.

## Arquitetura e qualidade
- Arquivo monolítico; funções quase iguais (preenchimentos, pools duplicados); código só alcançável por URL antiga; comentários desatualizados.
- Heurísticas frágeis (casar layout por nome) — causa de retrabalho recorrente?
- Testes automatizados existem? Logs com duração/linhas por consulta? Erro detalhado só no log?

## UX
- Larguras 280–2560 px, toque (alvos de 44 px), tema claro/escuro, estados de carregando/vazio/erro/desatualizado, timeout com feedback, estado preservado no endereço (filtros e seletores), acessibilidade (aria, foco, contraste).
