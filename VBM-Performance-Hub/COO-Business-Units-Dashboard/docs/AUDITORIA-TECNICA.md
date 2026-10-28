# Auditoria técnica — COO Business Units Dashboard

Data: 28/10/2026 · Versão auditada: `main` @ `68467c5` · Método: leitura integral do código + execução local com banco simulado (dublê do `mssql`) + `npm audit`.

Convenção de status: **confirmado** (visto no código ou reproduzido), **provável** (evidência forte, falta dado real), **precisa de validação** (depende de banco/ambiente/política que não pude acessar).

---

## 1. Resumo executivo

A aplicação está em bom estado nos pontos clássicos: **toda SQL é parametrizada** (sem SQL Injection encontrado), **todas as saídas HTML passam por `esc()`** (sem XSS encontrado), credenciais vêm de variáveis de ambiente/`valueFrom` e as rotas internas da pasta estão bloqueadas.

Os riscos relevantes estão em outro lugar:

1. **Integridade dos dados (DB-01, ALTA, precisa de validação):** as duas queries ligam tabelas por `CONCAT(ID_SITE, ID_OPERACAO, ID_KPI)`. Combinações diferentes geram a mesma chave (ex.: site 1/op 1/KPI 15 e site 11/op 1/KPI 5 → `'1115'`), o que pode trazer valores, nomes ou unidades de outro site/KPI e somar duplicado. O mesmo padrão impede uso de índice (PERF-01).
2. **Autorização sem granularidade (SEC-01):** qualquer usuário da `IBP.USERS` com matrícula vê todos os sites e os dados financeiros (EBITDA, COGS, CAPEX), e pode baixar o dataset inteiro por `/api/chart-data` (SEC-02).
3. **Falha do banco se amplifica (SEC-03):** em erro 5xx, a página repete a chamada no mesmo endpoint e depois a envia à API **do Kaizen** (`/api/...`).
4. **Layout e regras de negócio no código (HC-02/HC-05):** lista de gráficos por BU, painel, polaridade, país e hierarquia BU→mina estão em JavaScript. É a causa raiz dos ajustes recorrentes de "nome/ordem/unidade não reflete a query".
5. **Ambiente:** o COO aponta para PRD por padrão (HC-01) e usa a mesma credencial SQL do Portal/Kaizen, que o próprio `app.yaml` registra como já exposta em texto puro (SEC-06).

Nenhum achado CRÍTICO confirmado. Correções imediatas recomendadas: SEC-03, SEC-02, DB-01 (validar), SEC-06 (validar rotação), PERF-02.

### 1.1 Correções aplicadas (28/10/2026) — sem mudar o funcionamento

| Gap | O que mudou | Arquivo |
|---|---|---|
| SEC-03 | API só nos caminhos do COO (sai `'/api/'` do Kaizen); próximo caminho só em 404/erro de rede; 5xx/403/429 não se repetem | `index.html` (`API_BASES`, `apiGet`) |
| PERF-07 | Timeout de 75 s nas chamadas da página (acima dos 60 s do banco) | `index.html` (`apiGet`) |
| SEC-02 | `/chart-data`, `/atualizacoes`, `/sites` só com `COO_DIAGNOSTICO=1` | `coo-api.js` |
| PERF-06 | Banco fora após uma leitura: serve o último resultado (até 2 h, `COO_DESATUALIZADO_MAX_S`) com selo "banco indisponível: últimos dados lidos"; tenta o banco de novo em até 1 min | `coo-api.js`, `index.html` |
| PERF-03 | Linhas indexadas por site/ano/mês uma vez por leitura | `coo-api.js` (`linhasDe`) |
| DB-03 | Aviso no log quando a mesma série do mesmo KPI vem repetida no mês (soma silenciosa) | `coo-api.js` |
| DB-01 | Separador `'|'` nas chaves `CONCAT` das junções (linhas ativas) — sem colisão; tratamento de `NULL` idêntico ao original | `database/*.sql` |
| SEC-08 | Limite de 240 pedidos/min por usuário na API (429) | `coo-api.js` |
| HC-07 | `COO_CACHE_TTL_S`, `COO_FRESCO_S`, `COO_DESATUALIZADO_MAX_S` (padrões iguais aos anteriores) | `coo-api.js` |
| ARQ-06 | Log de cada leitura do banco: rota, linhas, duração, se foi refresh | `coo-api.js` |
| SEC-05 | Health responde só `{status}` (Portal e standalone) | `portal.js`, `server.js` |
| HC-01 | Aviso no log quando o COO cai no padrão de produção por falta de variável | `portal.js` |
| SEC-04 | Identidade simulada só com `NODE_ENV=development` e fora do Databricks | `server.js` |
| UX-01 | Opção escolhida nos seletores (All-in, CAPEX, Cu/Au) fica no endereço (`sel=`) | `index.html` |
| ARQ-02 | Links antigos das minas da VNL abrem "VNL Mines"; removida a visão individual sem uso (`MINA_VNL`); comentário desatualizado do `server.js` | `index.html`, `server.js` |
| ARQ-05 | 12 testes automatizados (`npm test` na pasta do COO) | `tests/coo-api.test.js`, `package.json` |

**Não aplicadas (dependem de outra área ou mudam o que o usuário vê):** SEC-01 (política de acesso), SEC-06 (rotação da credencial — DBA), DB-01 completo/PERF-01/PERF-04/PERF-05/DB-02/DB-04 (SQL do time de dados: junção coluna a coluna muda o resultado quando há `NULL`; zeros viram "sem dado"), HC-02/HC-03/HC-04/HC-05/HC-06 (colunas novas no cadastro), PERF-02 (verificação de versão no banco — precisa de medição), SEC-07/DEP-01/DEP-02 (afetam o Portal inteiro), DEP-03/DEP-04 (baixo ganho; arquivo/binário novo), ARQ-01/ARQ-03 (refatoração ampla), UX-02 (decisão de layout), PERF-08 (o diagnóstico do console segue em uso para conferir cadastro).

**Validação desta rodada:** `npm test` 12/12; smoke do Portal (acesso, bloqueio de arquivos, troca do `ID_DASH`, cache, health); varredura das 13 unidades com e sem Plan; VNL Mines em 1920/1440/390 px; refresh com filtros; banco fora com e sem leitura anterior — tudo com banco simulado.

## 2. Escopo analisado

| Item | Arquivos |
|---|---|
| Aplicação COO | `VBM-Performance-Hub/COO-Business-Units-Dashboard/` — `index.html`, `coo-api.js`, `portal.js`, `server.js`, `package.json`, `database/001_coo_dashboard.sql`, `database/002_coo_dashboard_atualizacao.sql` |
| Compartilhados usados pelo COO (só leitura) | `server.js` (Portal), `portal-acesso.js`, `VBM-Performance-Hub/portal.js`, `app.yaml`, `package.json`/`node_modules` da raiz |
| Fora do escopo (citados só quando afetam o COO) | VBM-Kaizen-App-*, VBM-Performance-Studio, Stable & Capable, Cockpit, Vdt |

## 3. Limitações da análise

- **Sem acesso ao Azure SQL**: planos de execução, volume real, índices, colisões de `CONCAT` e duplicidades não foram medidos. Itens de banco ficam como *provável/precisa de validação*, com a consulta de validação.
- **Repositório raso** (`git rev-parse --is-shallow-repository` = true, histórico desde 27/10/2026): não foi possível verificar se a senha registrada como exposta ainda está no histórico completo.
- **Sem acesso ao Databricks**: configuração real do app, secrets, réplicas e proxy não verificados.
- A autenticação Entra ID é feita pelo proxy do Databricks Apps (header `X-Forwarded-Email`); não há validação de token OAuth no código — não há o que auditar de issuer/audience/assinatura dentro da aplicação.
- Microsoft Graph não é usado pelo COO.

## 4. Mapa técnico da aplicação

**Tecnologia:** Node.js 22 · Express 5.3.0 · mssql 11.0.2 (tedious 18.6.2) · compression 1.8.2 · helmet 8.3.0 (Portal) · front-end em HTML/CSS/JS puro, gráficos SVG próprios, fonte Poppins (Google Fonts).

**Pontos de entrada**
| Modo | Arquivo | Uso |
|---|---|---|
| Dentro do Portal (produção) | `server.js` (raiz) → `VBM-Performance-Hub/portal.js` → `COO/portal.js` | Databricks App único do Portal |
| Standalone | `COO/server.js` | desenvolvimento / app próprio |

**Fluxo principal**
1. Navegador → proxy Databricks Apps (Entra ID) injeta `X-Forwarded-Email`.
2. `server.js` raiz: `helmet` + `compression` → `portal.use('/VBM-Performance-Hub', exigir)` (`portal-acesso.js`: e-mail em `IBP.USERS` com `CD_MATRICULA`; cache 10 min autorizado / 1 min negado).
3. `COO/portal.js`: `GET <BASE>/api/health`, `<BASE>/api/*` (router de `coo-api.js`), bloqueio de tudo que não seja `index.html`/`assets/`.
4. `index.html`: `GET /api/me` (rota do Kaizen, nome/cargo) → `filtros?fresco=1` → `indicadores?site&ano&mes` (+ filhos IR / minas VNL) → `atualizacao?...` (aviso de ciclo).
5. `coo-api.js`: executa as duas queries de `database/` (troca `DASH.ID_DASH = 15` → `@idDash`, conferida na carga), guarda o resultado em memória (5 min; refresh relê se > 15 s) e agrega por site/mês no servidor.

**Rotas do COO** (`coo-api.js` + `portal.js`)
| Rota | Banco | Usada pela página |
|---|---|---|
| `GET /api/health` | `SELECT 1` | não (diagnóstico) |
| `GET /api/ping` | não | não (diagnóstico) |
| `GET /api/chart-data` | query principal (dataset inteiro) | **não** |
| `GET /api/atualizacoes` | query de atualização (dataset inteiro) | **não** |
| `GET /api/sites` | `IBP.SITES` × `IBP.DASHBOARD` | **não** |
| `GET /api/filtros` | chart-data + sites (cache) | sim |
| `GET /api/indicadores?site&ano&mes` | chart-data (cache) | sim |
| `GET /api/atualizacao?site&ano&mes` | atualizacoes (cache) | sim |

**Variáveis de ambiente lidas pelo COO:** `PERFORMANCEHUB_SQL_SERVER`, `PERFORMANCEHUB_AZURE_SQL_DATABASE`/`PERFORMANCEHUB_SQL_DATABASE`, `PERFORMANCEHUB_SQL_USER`/`AZURE_SQL_USER`, `PERFORMANCEHUB_SQL_PASSWORD`/`AZURE_SQL_PASSWORD`, `PERFORMANCEHUB_SQL_PORT`/`AZURE_SQL_PORT`, `COO_ID_DASH`; standalone: `AZURE_SQL_*`, `COO_ACESSO_LOCAL_EMAIL`, `DATABRICKS_APP_PORT`/`PORT`. Portal: `PORTAL_USERS_EMAIL_COLUMN`, `PORTAL_LOGOUT_URL`, `PORTAL_CONTATO`.

**Banco:** Azure SQL `BDIBPBMSA_PRD` (servidor PRD), pool próprio do COO (`max 3`, `connectionTimeout 30 s`, `requestTimeout 60 s`, `encrypt: true`). Tabelas: `IBP.PEDRAVISAOCONSOLIDADA`, `IBP.PEDRAVISAOTRIMESTRE`, `IBP.PEDRAVISAOANO`, `IBP.DASHBOARD`, `IBP.CONTROLE_PROCESSOS`, `IBP.LOG_PEDRAVISAOCONSOLIDADA`, `IBP.SITES`, `IBP.USERS`.

**Jobs/webhooks/agendamentos:** nenhum no COO. Integrações externas: Google Fonts (navegador), rota `/api/me` do Kaizen.

**Código só alcançável por URL:** visões individuais das minas da VNL (`MINA_VNL`, `index.html:893,913`) — o menu agora usa "VNL Mines", mas `?site=Eastern%20Deeps` ainda abre a visão antiga.

## 5. Principais riscos encontrados

| # | Gap | Severidade | Status |
|---|---|---|---|
| 1 | DB-01 Junção por `CONCAT` pode misturar sites/KPIs | ALTA | precisa de validação |
| 2 | SEC-01 Sem autorização por dashboard/site para dados financeiros | MÉDIA (ALTA se a política exigir restrição) | precisa de validação |
| 3 | SEC-03 Fallback de API envia chamadas ao Kaizen e repete query em falha | MÉDIA | confirmado |
| 4 | SEC-06 Credencial SQL compartilhada, registrada como exposta | MÉDIA | precisa de validação |
| 5 | PERF-01 Junções não-sargáveis nas duas queries | MÉDIA | provável |
| 6 | SEC-02 Rotas brutas entregam o dataset completo sem uso | MÉDIA | confirmado |
| 7 | HC-02/HC-05 Layout, país e regras no JavaScript | MÉDIA | confirmado |
| 8 | HC-01 Padrão aponta para PRD sem variável | MÉDIA | confirmado |

## 6. Matriz consolidada de gaps

Legenda: Sev = severidade · Prob = probabilidade · Pri = prioridade (P1 imediata … P4) · Esf = esforço · Risco = risco da alteração.

| ID | Categoria / Sub | Título | Evidência (arquivo:linha) | Cenário de falha/exploração | Impacto técnico | Impacto negócio | Sev | Prob | Pri | Solução recomendada | Alternativa menor impacto | Esf | Risco | Dependências | Validação | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DB-01 | Banco / integridade | Junção por `CONCAT` ambígua | `001_coo_dashboard.sql:59,171,250`; `002_coo_dashboard_atualizacao.sql:50,53` | Linha de (site 11, op 1, KPI 5) casa com cadastro de (site 1, op 1, KPI 15) | Valor/nome/unidade de outro KPI; soma duplicada em `agregarIndicadores` (`coo-api.js:130-132`) | Número errado no gráfico executivo | ALTA | Média | P1 | Junção coluna a coluna (`PVC.ID_SITE = DASH.ID_SITE AND PVC.ID_OPERACAO = DASH.ID_OPERACAO AND PVC.ID_KPI = DASH.ID_KPI`) | Separador no CONCAT (`CONCAT_WS('-', …)`) | Baixo | Médio (resultado muda se havia colisão) | Time de dados | Query de colisão (§10) antes/depois; comparar contagem e somas | precisa de validação |
| SEC-01 | Segurança / autorização | Sem escopo por dashboard/site | `portal-acesso.js:100-133`; `server.js:77` (raiz); `coo-api.js:270-298` | Qualquer usuário com matrícula vê EBITDA/COGS de todas as BUs | Autorização só por "existe no cadastro" | Exposição de financeiro a público maior que o pretendido | MÉDIA | Alta | P2 | Tabela de permissão (usuário/grupo × ID_DASH × site) validada no back-end em `/indicadores`/`/atualizacao` | Restringir o ID_DASH 15 a um grupo Entra/lista | Médio | Médio | Definição da política | Usuário fora do grupo recebe 403 em `/api/*` e página | precisa de validação |
| SEC-02 | Segurança / exposição de dados | Rotas brutas sem uso | `coo-api.js:253-255` (`/chart-data`, `/atualizacoes`, `/sites`); página só usa `filtros`/`indicadores`/`atualizacao` (`index.html:1609,1825,1857`) | Usuário autenticado baixa o dataset completo repetidas vezes | Payload grande, CPU de `JSON.stringify` | Facilita extração em massa | MÉDIA | Média | P1 | Remover as rotas brutas ou liberá-las só com `COO_DIAGNOSTICO=1` | Manter, com limite de taxa | Baixo | Baixo | — | `GET /api/chart-data` → 404 | confirmado |
| SEC-03 | Segurança / API | Fallback para API de outra aplicação + retry em 5xx | `index.html:1464-1480` (`API_BASES` inclui `'/api/'`; `.catch(tentar)` em qualquer erro) | Banco fora → mesma query pedida 2× e `GET /api/filtros` vai ao Kaizen | Amplifica carga no banco em falha; acoplamento indevido | Indisponibilidade mais longa; chamadas cruzadas | MÉDIA | Alta | P1 | Avançar de base só em erro de rede/404; remover `'/api/'` | Remover só `'/api/'` | Baixo | Baixo | — | Banco simulado fora: 1 chamada por recurso, nenhuma a `/api/filtros` | confirmado |
| SEC-04 | Segurança / autenticação | Identidade simulada no standalone | `COO/server.js:113-117` | Standalone publicado fora do Databricks com `COO_ACESSO_LOCAL_EMAIL` definido → todos entram como esse e-mail; sem o proxy, `X-Forwarded-Email` é forjável | Bypass de autenticação | Acesso indevido (só no modo standalone) | MÉDIA | Baixa | P3 | Exigir `NODE_ENV=development` e `listen('127.0.0.1')` para simular | Log de aviso já existe; documentar | Baixo | Baixo | — | Com `NODE_ENV=production` a simulação é ignorada | confirmado (condicional) |
| SEC-05 | Segurança / divulgação | Health expõe servidor e banco | `COO/server.js:99-110` (fora do controle de acesso); `COO/portal.js:85-93` | Anônimo (standalone) descobre host/base | Reconhecimento | Baixo | BAIXA | Média | P3 | Responder só `{status}` | — | Baixo | Baixo | — | Resposta sem `server`/`database` | confirmado |
| SEC-06 | Segurança / segredos | Credencial SQL compartilhada e registrada como exposta | `app.yaml` (bloco "ROLLBACK DE EMERGÊNCIA"); `COO/portal.js:36-37` usa `AZURE_SQL_USER/PASSWORD` do Portal | Se a senha antiga não foi rotacionada, quem tem o histórico acessa o PRD | Comprometimento do banco | Alto se não rotacionada | MÉDIA | Desconhecida | P1 | Confirmar rotação; login próprio do COO, só leitura nas 8 tabelas | Confirmar rotação | Médio | Médio | DBA, Databricks secrets | Login antigo falha; COO conecta com o novo | precisa de validação |
| SEC-07 | Segurança / defesa em profundidade | Sem CSP | `server.js:46` (raiz, `contentSecurityPolicy: false`) | XSS futuro sem barreira | — | — | BAIXA | Baixa | P4 | CSP com hash dos scripts inline + `fonts.googleapis.com` | Só `object-src 'none'; base-uri 'self'; frame-ancestors` | Médio | Médio (afeta todo o Portal) | Outras apps | Página funciona com CSP; sem violações no console | confirmado |
| SEC-08 | Segurança / API | Sem limite de taxa | `coo-api.js` (nenhum limitador) | Abuso por usuário autenticado | CPU/memória | Baixo | BAIXA | Baixa | P4 | Limite por e-mail nas rotas do COO | — | Baixo | Baixo | — | 429 acima do limite | confirmado |
| PERF-01 | Performance / banco | Junções não-sargáveis | mesmas linhas de DB-01; `CROSS APPLY (SELECT DISTINCT DT_REF …)` em `001_coo_dashboard.sql:182-184,261-263` | Varredura completa a cada leitura | Duração da query; pool de 3 conexões | Carga lenta | MÉDIA | Provável | P2 | Mesma correção de DB-01; materializar a lista de meses numa variável de tabela | — | Baixo | Médio | DB-01 | Tempo/IO (`SET STATISTICS TIME, IO ON`) antes/depois | provável |
| PERF-02 | Performance / cache | Refresh relê o banco a cada 15 s | `coo-api.js:39-41,220-231`; `index.html:1609,1855-1857` | Muitos usuários abrindo a página → até 1 leitura completa por query a cada 15 s | Carga contínua no PRD | — | MÉDIA | Média | P2 | Verificação barata de versão (ex.: `MAX(DT_ATUALIZACAO)` do log) antes de reler | Subir `FRESCO_MS` para 60 s (configurável) | Médio | Baixo | — | Contagem de leituras/h; duração da query | confirmado (efeito real depende do volume) |
| PERF-03 | Performance / back-end | Varredura do dataset por requisição | `coo-api.js:109-135,74-82` | Cada `indicadores`/`atualizacao` percorre todas as linhas | CPU O(N) por chamada | — | BAIXA | Alta | P3 | Indexar por `site\|ano\|mes` uma vez por carga do cache | — | Baixo | Baixo | — | Tempo de resposta p95 | confirmado |
| PERF-04 | Performance / volume | Trimestre e ano repetidos por mês | `001_coo_dashboard.sql:182-195,261-269` | Linha de trimestre ×3 meses e de ano ×12 no resultado | Mais linhas transferidas e em memória | — | BAIXA | Alta | P3 | Avaliar com o time de dados trazer trimestre/ano uma vez e cruzar no servidor | — | Médio | Médio | Time de dados | `@@ROWCOUNT` e bytes da resposta | confirmado |
| PERF-05 | Performance / banco | `FORMAT()` em todas as linhas | `001_coo_dashboard.sql:42-46` | — | `FORMAT` é CLR e lento | — | BAIXA | Média | P4 | `LEFT(DATENAME(MONTH, DT_REF), 3)` (atenção ao idioma da sessão) | — | Baixo | Baixo | Time de dados | Tempo da query | provável |
| PERF-06 | Estabilidade / cache | Sem dado anterior em falha | `coo-api.js:220-231` | Cache expira e o banco cai → página vazia, embora houvesse dado de 5 min atrás | Indisponibilidade percebida | Dashboard fora em instabilidade | MÉDIA | Média | P2 | Servir o último resultado (marcado como desatualizado) quando a releitura falhar | — | Baixo | Baixo | — | Banco simulado fora após carga: página mostra dados + aviso | confirmado |
| PERF-07 | UX / rede | `fetch` sem timeout | `index.html:1469-1478` | Banco lento → "carregando" por até 60 s, sem ação | — | Percepção de travamento | BAIXA | Média | P3 | `AbortController` (ex.: 45 s) + botão "tentar de novo" | — | Baixo | Baixo | SEC-03 | Simular atraso de 70 s | confirmado |
| PERF-08 | Performance / front | Diagnóstico `console.table` em toda carga | `index.html` (`preencher`, bloco "Diagnóstico no console") | — | CPU mínima; ruído no console | — | INFORMATIVA | — | P4 | Ativar só com `?diag=1` | — | Baixo | Baixo | — | — | confirmado |
| DB-02 | Banco / regra de negócio | Ausência de valor vira 0 | `001_coo_dashboard.sql:52,68,164` | Mês sem Actual aparece como 0 e delta −100% | — | Leitura errada do desempenho | MÉDIA | Média | P2 | Manter `NULL` (página já mostra "sem dado") | Só para meses fechados | Baixo | Médio (muda o que o usuário vê) | Decisão de negócio | Mês sem Actual mostra "—" | confirmado (impacto depende da regra) |
| DB-03 | Banco / integridade | Cadastro duplicado soma valores | `coo-api.js:130-132` soma; nenhuma restrição vista | Duas linhas de `IBP.DASHBOARD` (ID_DASH 15) para o mesmo KPI → valor dobrado | Valor errado silencioso | Número errado | MÉDIA | Baixa | P2 | Índice único em `IBP.DASHBOARD (ID_DASH, ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI)` + aviso no log | Só o aviso no log | Baixo | Baixo | DBA | Query de duplicidade (§10) | precisa de validação |
| DB-04 | Banco / parametrização | Datas e processo fixos | `001_coo_dashboard.sql:7-9` (`'2025-01-01'`, `ID_PROCESSO = 2`); idem atualização | Anos anteriores nunca aparecem; mudança de processo exige editar SQL | — | — | BAIXA | Baixa | P3 | `@DT_INI` como parâmetro (ex.: 2 anos para trás) | Documentar | Baixo | Baixo | — | Filtro de ano | confirmado |
| DB-05 | Banco / performance | Busca de usuário não-sargável | `portal-acesso.js:113` (`LTRIM(RTRIM(col)) = @email`) | — | Varredura de `IBP.USERS` a cada validação sem cache | — | BAIXA | Baixa | P4 | Normalizar a coluna na carga e comparar direto | — | Baixo | Baixo | Portal | Plano de execução | provável |
| DEP-01 | Dependências | Vulnerabilidades transitivas | `npm audit --omit=dev`: 2 high (`@azure/identity`, `@azure/msal-node`), 2 moderate (`exceljs`, `uuid`) | O fluxo vulnerável do MSAL (authorization code) não é usado pelo COO (login SQL) | Baixa explorabilidade no COO | — | BAIXA | Baixa | P3 | Atualizar via `mssql`/`tedious` ou `overrides`, com teste | — | Baixo | Médio (afeta todo o Portal) | Kaizen | `npm audit` limpo + teste de conexão | confirmado |
| DEP-02 | Supply chain | `node_modules` versionado (14.602 arquivos) | `git ls-files node_modules` | Pacote alterado no repositório passa despercebido na revisão | — | — | BAIXA | Baixa | P4 | Instalar no deploy (`npm ci`) com lockfile | — | Médio | Médio | Processo de deploy | Deploy sem `node_modules` no git | confirmado |
| DEP-03 | Dependências | COO standalone sem lockfile | `COO/package.json` (faixas `^`) | Instalação standalone não reprodutível | — | — | BAIXA | Baixa | P4 | Gerar `package-lock.json` | — | Baixo | Baixo | — | `npm ci` | confirmado |
| DEP-04 | Dependências / UX | Fonte externa no carregamento | `index.html:7-9` | Rede corporativa bloqueia Google → fonte de fallback; CSS bloqueia a renderização | Atraso no primeiro desenho | — | BAIXA | Média | P4 | Servir Poppins de `assets/` (woff2) | — | Baixo | Baixo | — | LCP antes/depois | confirmado |
| HC-01 | Hardcoded / ambiente | Padrão é o banco de produção | `COO/portal.js:21-22,33-35` | DEV/HML sem variável lê/estressa o PRD | — | Teste em produção sem querer | MÉDIA | Média | P2 | Exigir as variáveis fora de produção (falhar ao subir) | Log em destaque quando cair no padrão | Baixo | Baixo | — | Subir sem variáveis em DEV → erro claro | confirmado |
| HC-02 | Hardcoded / regra de negócio | Layout por BU no código | `index.html:860-915` (`MODELOS`, `COBRE`, `FINANCEIRO`, `ALL_IN`, `CAPEX_MINA`, `NOTA_INTERM`) | Mudança de cadastro no banco não reflete; ligação por nome/ID_ORDEM falha | Heurística frágil (ARQ-04) | Retrabalho a cada ajuste | MÉDIA | Alta | P3 | Colunas em `IBP.DASHBOARD`: painel, grupo de seletor, polaridade, nota | Manter `MODELOS` só como reserva | Alto | Médio | Time de dados | Mudança no banco aparece sem deploy | confirmado |
| HC-03 | Hardcoded / dado mestre | Nomes de sites sem cadastro | `coo-api.js:137-139` (36, 37, 42) | Site novo sem nome some do menu | — | — | BAIXA | Média | P3 | Preencher `IBP.SITES.NM_SITE` | Manter como reserva | Baixo | Baixo | Dono do cadastro | Menu com nome do banco | confirmado |
| HC-04 | Hardcoded / dado mestre | Nomes curtos no SQL | `coo-api.js:168-186` | Renomear exige deploy | — | — | BAIXA | Baixa | P4 | Coluna `NM_SITE_CURTO` em `IBP.SITES` | — | Baixo | Baixo | Dono do cadastro | — | confirmado |
| HC-05 | Hardcoded / dado mestre | País e hierarquia por nome | `index.html:1516-1523` (`SITES_IR`, `IR_IDS_FILHOS=[16,26]`, `SITES_BRASIL`, `ORDEM_PAISES`), `MINAS_DA_BU`, `MINAS_EM_COLUNAS` | Site novo cai em "Canada"; mina nova não se agrupa | — | Menu errado | MÉDIA | Média | P3 | Usar `IBP.SITES.NM_PAIS` (já usado pelo Stable & Capable) e uma coluna de BU-mãe | — | Médio | Médio | Cadastro | Site novo aparece no país certo sem deploy | confirmado |
| HC-06 | Hardcoded / regra | Polaridade no código | `index.html` (`'down'` em COGS, CAPEX, All-in, C1, etc.) | KPI novo de custo aparece verde ao subir | — | Leitura invertida | BAIXA | Média | P3 | Coluna de polaridade em `IBP.DASHBOARD` | — | Baixo | Baixo | HC-02 | — | confirmado |
| HC-07 | Constantes | Tempos e limites espalhados | `coo-api.js:38-41`; `COO/portal.js:56-58`; `index.html` `MAX_W/MAX_H` | — | — | — | INFORMATIVA | — | P4 | Centralizar e permitir `COO_CACHE_TTL_S`, `COO_FRESCO_S` | — | Baixo | Baixo | — | — | confirmado |
| ARQ-01 | Manutenção | Página monolítica | `index.html` (1.957 linhas: CSS + Setup Dashboards + app) | Revisão e testes difíceis | — | — | BAIXA | — | P4 | Separar em `assets/coo.css` e `assets/coo.js` (já liberados pelo `PUBLICO`) | — | Médio | Baixo | — | Mesmas telas antes/depois | confirmado |
| ARQ-02 | Manutenção / código morto | Restos de versões anteriores | `MINA_VNL` (`index.html:893,913`) só por URL; `MODELOS.internationalrefineries` (`:915`); comentário "dados de exemplo" (`COO/server.js:41`) | — | Confusão | — | BAIXA | — | P4 | Remover o que não tem uso; redirecionar URL antiga das minas para "VNL Mines" | — | Baixo | Baixo | — | — | confirmado |
| ARQ-03 | Manutenção / duplicação | Três rotinas de preenchimento quase iguais | `index.html` `preencher`, `preencherFilhos`, `preencherColunas`; pool duplicado em `portal.js` e `server.js` | Correção feita num lugar e esquecida no outro | — | — | BAIXA | — | P4 | Função única de "linhas → card" | — | Médio | Médio | — | Testes ARQ-05 | confirmado |
| ARQ-04 | Arquitetura | Ligação PDF × query por heurística | `index.html` `escolher` + preenchimento por `ID_ORDEM` | Nome alterado no banco cai em card errado ou "No data" | — | Retrabalho recorrente | MÉDIA | Alta | P3 | HC-02 (layout no banco) | Diagnóstico no console (já existe) | Alto | Médio | HC-02 | — | confirmado |
| ARQ-05 | Qualidade / testes | Sem testes automatizados no repositório | nenhum `*.test.js` do COO | Regressão só detectada em produção | — | — | MÉDIA | Alta | P2 | `node --test` para `coo-api.js` + smoke do Playwright | — | Médio | Baixo | — | CI verde | confirmado |
| ARQ-06 | Observabilidade | Sem duração/linhas por query no Portal | `COO/portal.js:76-80` (o `server.js` standalone mede, o Portal não) | Lentidão sem evidência | — | — | BAIXA | — | P3 | Logar `ms` e linhas por consulta, com rota | — | Baixo | Baixo | — | Log mostra duração | confirmado |
| UX-01 | UX | Seleção dos seletores não fica no endereço | `index.html` `salvarUrl` (só site/ano/mês/plan/delta) | Refresh volta o All-in/CAPEX/Cu-Au para a 1ª opção | — | — | BAIXA | — | P4 | Incluir `state.sel` no endereço | — | Baixo | Baixo | — | — | confirmado |
| UX-02 | UX | Tela cheia em 1280×720 com gráfico de 90 px | `index.html` `ajustarAltura` (mín. 90) | — | — | Leitura difícil | BAIXA | Baixa | P4 | Rolagem abaixo de ~760 px de altura | — | Baixo | Baixo | — | Captura 1280×720 | confirmado |

## 7. Vulnerabilidades de segurança

- **Reais (exploráveis no cenário atual):** SEC-03 (amplificação/chamada cruzada em falha), SEC-02 (extração em massa por usuário autenticado).
- **Condicionais:** SEC-04 (só standalone fora do Databricks), SEC-06 (depende da rotação), SEC-01 (depende da política).
- **Má prática / defesa em profundidade:** SEC-05, SEC-07, SEC-08.
- **Verificado sem achado:** SQL Injection (todas as entradas via `request.input`; `site/ano/mes` validados por `inteiro()`); XSS (todos os sinks `innerHTML` usam `esc()`; atributos sempre com aspas duplas); Path Traversal (bloqueio de `..`, `%2e`, `%5c` em `portal.js:102`); erros sem stack trace na resposta; sem `eval`/`Function`; sem upload; sem CORS habilitado; tokens não ficam no navegador (sessão é do proxy); `localStorage` só guarda tema/idioma/formato.
- **Referências:** OWASP A01 (SEC-01/02), A05 (SEC-05/07, HC-01), A07 (SEC-04), A02/A07 (SEC-06), ASVS V4 (controle de acesso), CWE-200 (SEC-02/05), CWE-284 (SEC-01), CWE-798/CWE-522 (SEC-06).

## 8. Gargalos de performance

PERF-01 a PERF-07. Como medir:

| Gap | Métrica | Como medir |
|---|---|---|
| PERF-01/04/05 | duração, leituras lógicas, linhas | `SET STATISTICS TIME, IO ON;` + plano real (SSMS) antes/depois; `@@ROWCOUNT` |
| PERF-02 | leituras do banco por hora | log de cada leitura com rota e duração (ARQ-06); comparar antes/depois |
| PERF-03 | p95 de `/indicadores` | `curl -w '%{time_total}'` 50× com cache quente |
| PERF-06 | tempo fora do ar percebido | derrubar o banco simulado após a carga e medir quanto tempo a página fica sem dados |
| PERF-07 | tempo até feedback | atrasar a API 70 s e medir até o aviso de erro |
| DEP-04 | LCP / FCP | Lighthouse ou Performance do DevTools, com e sem a fonte local |

**Front-end (sem gargalo relevante):** página única de ~130 KB, com compressão; 4 chamadas na carga (`me`, `filtros`, `indicadores`, `atualizacao`), com `indicadores` dependendo de `filtros` por necessidade; gráficos redesenhados por `ResizeObserver` com chave de cache (`drawChart`); sem listas grandes.

## 9. Valores hardcoded e não dinâmicos

| Valor | Onde | Classificação | Precisa ser dinâmico? |
|---|---|---|---|
| Servidor/base PRD | `COO/portal.js:21-22` | 3 · Configuração por ambiente | Sim (HC-01) |
| `ID_DASH 15` | `coo-api.js:42` + SQL | 2 · Constante legítima (já parametrizável por `COO_ID_DASH`) | Não |
| `'2025-01-01'`, `ID_PROCESSO = 2` | SQL `:7-9` | 4 · Regra de negócio | Sim, parâmetro (DB-04) |
| Lista de gráficos por BU, painel, aliases, decimais padrão | `index.html:860-915` | 4/5 · Regra / dado mestre | Sim (HC-02) |
| Polaridade (`'down'`) | `index.html` (`k(...)`) | 4 · Regra de negócio | Sim (HC-06) |
| País por nome, IR filhos `[16, 26]`, ordem de países | `index.html:1516-1523` | 5 · Dado mestre | Sim (HC-05) |
| Hierarquia BU → mina, "VNL Mines", "UG Mines/Open Pit" | `index.html` `MINAS_DA_BU`, `MINAS_EM_COLUNAS` | 5 · Dado mestre | Sim (HC-05) |
| Nomes 36/37/42 | `coo-api.js:139` | 5 · Dado mestre (reserva) | Cadastro em `IBP.SITES` (HC-03) |
| Nomes curtos de sites | `coo-api.js:168-186` | 5 · Dado mestre | Desejável (HC-04) |
| Nota de intermediários (Onça Puma/Ontario) | `index.html` `NOTA_INTERM` | 4 · Regra | Desejável (coluna no cadastro) |
| Cache 5 min / 15 s; pool 3; timeouts 30/60 s | `coo-api.js:38-41`, `portal.js:56-58` | 2/3 · Constante / ambiente | Opcional (HC-07) |
| Cores, tamanhos de gráfico, textos i18n | `index.html` (tokens em `:root`, dicionário) | 6 · Valor visual / 2 | Não — já centralizados |
| Nomes de tabelas `IBP.*` | SQL, `portal-acesso.js:20` | 2 · Constante legítima | Não |
| Bases da API | `index.html:1464` | 2 · Constante (corrigir lista, SEC-03) | Não |
| Segredos | — | 7 · Nenhum segredo literal no código do COO | — |

## 10. Problemas de banco de dados

DB-01 a DB-05 e PERF-01/04/05. Consultas de validação (somente leitura):

```sql
-- DB-01: chaves CONCAT que colidem no cadastro do dashboard
SELECT CONCAT(ID_SITE, ID_OPERACAO, ID_KPI) AS CHAVE, COUNT(DISTINCT CONCAT(ID_SITE,'-',ID_OPERACAO,'-',ID_KPI)) AS COMBINACOES
FROM IBP.DASHBOARD WHERE ID_DASH = 15
GROUP BY CONCAT(ID_SITE, ID_OPERACAO, ID_KPI) HAVING COUNT(DISTINCT CONCAT(ID_SITE,'-',ID_OPERACAO,'-',ID_KPI)) > 1;

-- DB-01: linhas de dados que casam com cadastro de OUTRA combinação
SELECT TOP (50) PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI, DASH.ID_SITE AS DASH_SITE, DASH.ID_OPERACAO AS DASH_OP, DASH.ID_KPI AS DASH_KPI
FROM IBP.PEDRAVISAOCONSOLIDADA PVC
JOIN IBP.DASHBOARD DASH ON PVC.ID_SISTEMA = DASH.ID_SISTEMA
 AND CONCAT(PVC.ID_SITE, PVC.ID_OPERACAO, PVC.ID_KPI) = CONCAT(DASH.ID_SITE, DASH.ID_OPERACAO, DASH.ID_KPI)
WHERE DASH.ID_DASH = 15 AND (PVC.ID_SITE <> DASH.ID_SITE OR PVC.ID_OPERACAO <> DASH.ID_OPERACAO OR PVC.ID_KPI <> DASH.ID_KPI);

-- DB-03: cadastro duplicado
SELECT ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, COUNT(*) AS QTD
FROM IBP.DASHBOARD WHERE ID_DASH = 15
GROUP BY ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI HAVING COUNT(*) > 1;
```

Índices: **não recomendo índice sem evidência.** Antes, com a junção corrigida (DB-01), verificar no plano real das três partes da query: varreduras em `PEDRAVISAO*` por `DT_REF`, cardinalidade de `IBP.DASHBOARD` por `ID_DASH`, frequência de escrita das tabelas de carga (índices pesam na carga). Candidatos a avaliar: `PEDRAVISAOCONSOLIDADA (ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI, DT_REF)` e `LOG_PEDRAVISAOCONSOLIDADA (ID_SISTEMA, ID_SITE, ID_OPERACAO, ID_KPI) INCLUDE (DT_ATUALIZACAO)`.

Permissões (precisa de validação): o login do COO só precisa de `SELECT` nas 8 tabelas listadas no §4. Confirmar que não tem `db_owner`/escrita (SEC-06).

## 11. Dependências e configurações

DEP-01 a DEP-04, HC-01, SEC-06. Configuração do COO é toda por variável de ambiente; credenciais via `valueFrom` no `app.yaml` (correto). Diferença entre ambientes: não existe DEV/HML para o COO — o padrão é PRD (HC-01). O `app.yaml` é do Portal inteiro; o COO não tem variável própria obrigatória.

## 12. Problemas de arquitetura e manutenção

ARQ-01 a ARQ-06, ARQ-04 sendo o principal (origem dos ajustes recorrentes). Pontos positivos a preservar: módulo `coo-api.js` independente do ponto de entrada (`runQuery` injetado), SQL do time de dados lida sem reescrita com troca conferida na carga, erro genérico na resposta e detalhe só no log, deduplicação de consultas simultâneas.

## 13. Problemas de UX, responsividade e performance percebida

Verificado anteriormente (280 a 2560 px, toque, tema escuro): sem rolagem lateral, alvos de 44 px em toque, estados de carregando/vazio/erro presentes, filtros preservados no endereço. Gaps: PERF-07 (sem timeout/“tentar de novo”), UX-01, UX-02, DEP-04. Acessibilidade: seletores com `aria-pressed`, gráficos com `role="img"` e `aria-label` descritivo, foco visível; o aviso de ciclo depende de `hover` para o detalhe, mas é focável e tem `aria-label`.

## 14. Plano de correção por ondas

**Onda 1 — imediata** (P1): SEC-03 → SEC-02 → SEC-06 (validar rotação) → DB-01 (rodar as consultas; se houver colisão, corrigir junção com o time de dados).
- Dependências: DB-01 precisa do time de dados; SEC-06 do DBA.
- Risco: baixo nos itens de código; DB-01 muda números se houver colisão (comunicar).
- Aceite: nenhuma chamada a `/api/` do Kaizen em falha; rotas brutas 404; consultas de colisão vazias; login antigo inválido.
- Rollback: `git revert` do commit; SQL anterior preservado no histórico.

**Onda 2 — estabilidade e performance** (P2): PERF-06 → PERF-02 → PERF-01/DB-02/DB-03 → HC-01 → ARQ-05.
- Aceite: página continua com dados (com aviso) se o banco cair; leituras por hora dentro do esperado; tempo da query medido e registrado; DEV sem variáveis falha ao subir.
- Testes: banco simulado fora; carga com N usuários; `STATISTICS IO/TIME`.

**Onda 3 — parametrização e governança** (P3): HC-02/HC-05/HC-06 (layout, país, polaridade no cadastro) → HC-03/HC-04 → DB-04 → SEC-01 (após definir a política) → SEC-04/SEC-05 → PERF-03/PERF-07 → ARQ-06 → DEP-01.
- Depende de colunas novas em `IBP.DASHBOARD`/`IBP.SITES`; manter `MODELOS` como reserva durante a transição.

**Onda 4 — manutenibilidade** (P4): ARQ-01/02/03, SEC-07, SEC-08, DEP-02/03/04, UX-01/02, PERF-08, HC-07.

## 15. Quick wins

| Gap | Mudança | Esforço |
|---|---|---|
| SEC-03 | Remover `'/api/'` de `API_BASES` e só trocar de base em erro de rede/404 | 10 min |
| SEC-02 | Rotas brutas atrás de `COO_DIAGNOSTICO=1` | 10 min |
| SEC-05 | Health sem `server`/`database` | 5 min |
| PERF-06 | Servir o último resultado quando a releitura falhar | 20 min |
| ARQ-06 | Logar duração e linhas por consulta no `portal.js` | 10 min |
| PERF-08 | Diagnóstico do console só com `?diag=1` | 5 min |
| ARQ-02 | Comentário desatualizado do `server.js`; redirecionar URL antiga das minas da VNL | 10 min |

## 16. Correções que exigem maior cuidado

- **DB-01/PERF-01/PERF-04/DB-02** — SQL do time de dados: alterar só com o dono da query e comparação de resultados antes/depois.
- **HC-02/HC-05/HC-06/ARQ-04** — exige colunas novas no cadastro e transição com reserva.
- **SEC-01** — exige decisão de política de acesso.
- **SEC-06** — rotação coordenada com Kaizen/Portal (mesma credencial).
- **SEC-07/DEP-01/DEP-02** — afetam o Portal inteiro, não só o COO.

## 17. Testes e critérios de aceite

| Teste | Como | Aceite |
|---|---|---|
| Autenticação | requisição sem `X-Forwarded-Email` para página e `/api/*` | redireciona / 403 |
| Autorização | e-mail fora da `IBP.USERS`; e (após SEC-01) fora do grupo | 403 |
| Acesso direto | `GET /coo-api.js`, `/database/*.sql`, `/../portal.js`, `%2e%2e` | 404 |
| Manipulação de parâmetros | `site=abc`, `ano=1999`, `mes=13`, arrays (`site=1&site=2`) | 400 |
| Falha de banco | dublê lançando erro após carga | página mantém dados (PERF-06); 1 chamada por recurso (SEC-03) |
| Timeout | API atrasada 70 s | aviso e "tentar de novo" (PERF-07) |
| Concorrência | 20 pedidos simultâneos de `indicadores` com cache frio | 1 execução da query (dedupe) |
| Regressão visual | Playwright 390/1440/1920, claro/escuro, Plan on/off, todas as unidades | sem erro no console, sem rolagem lateral |
| Queries | consultas do §10 + `STATISTICS IO/TIME` | sem colisão; tempo registrado |
| Logs | revisar saída | sem senha, sem dado de cadastro além do e-mail |

Harness usado nesta auditoria (dublê do `mssql` + Playwright) pode virar `tests/` do COO (ARQ-05).

## 18. Riscos de regressão

- SEC-03: em modo standalone a página é servida em `/` e a API em `/api` — a base relativa `'api/'` cobre esse caso; validar standalone após a mudança.
- PERF-06: dado antigo servido sem aviso seria pior que erro → o aviso "desatualizado" é obrigatório.
- DB-01: mudança de números se havia colisão — comunicar antes.
- HC-02: transição de layout para o banco pode esconder cards se o cadastro estiver incompleto → manter reserva e o diagnóstico do console.

## 19. Recomendações de monitoramento

- Log estruturado por consulta: rota, duração, linhas, origem (cache/banco/fresco), sem parâmetros sensíveis (ARQ-06).
- Alertas: duração da query principal acima de X s; taxa de 5xx em `/api/*` do COO; falhas do `portal-acesso` (`PA-*`).
- Painel simples a partir dos logs do Databricks App: leituras do banco por hora (PERF-02), p95 de `/indicadores`.
- Revisão mensal de `npm audit` e do cadastro (consultas do §10).

## 20. Conclusão e próximos passos

A base é segura nos vetores clássicos; o que pede ação é **integridade do dado (DB-01)**, **comportamento em falha (SEC-03/PERF-06)**, **minimização de exposição (SEC-02/SEC-01)** e **tirar do código o que é cadastro (HC-02/HC-05)**.

Próximos passos sugeridos:
1. Aprovar a Onda 1 de código (SEC-03, SEC-02, SEC-05) — alterações pequenas, isoladas, com teste e rollback por commit.
2. Rodar as consultas do §10 no PRD e decidir DB-01/DB-03 com o time de dados.
3. Confirmar rotação da credencial (SEC-06) e a política de acesso ao financeiro (SEC-01).
4. Planejar com o time de dados as colunas de layout no cadastro (HC-02/HC-05/HC-06).
