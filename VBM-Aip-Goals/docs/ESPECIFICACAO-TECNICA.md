# Especificação Técnica — Aplicação AIP Goals v1

> Cópia em Markdown do documento "AIP Goals — Especificação funcional e levantamento de requisitos" (aba Especificação técnica v1), exportada em 17/11/2026. Ao mudar a especificação, atualize o documento e esta cópia no mesmo PR.

16 de nov de 2026 · Cristian

Versão 1 · Especificação funcional, técnica e catálogo de telas do MVP, com as fases 2 e 3 já desenhadas. O levantamento de requisitos que originou esta versão está em [LEVANTAMENTO-REQUISITOS.md](LEVANTAMENTO-REQUISITOS.md).

**Objetivo:** orientar diretamente o desenvolvimento da aplicação, sem cronograma, orçamento ou estimativas. Toda regra de permissão, estado e validação deve ser aplicada no servidor; a interface apenas antecipa o resultado.

## 1. Visão e escopo

O AIP Goals é a aplicação do portal-pci que leva cada meta de AIP das BUs de VBM (Brasil e Canadá) do desdobramento do COO até o Goal Card aprovado, versionado e rastreável. Ela substitui o PPT e o e-mail como fonte oficial.

**Objetivo:** governar a definição das metas com um fluxo único de preenchimento, aprovação e registro, para que cada BU tenha uma versão oficial de cada Goal Card e todo comentário e decisão fique no histórico.

| Fase | Escopo |
| --- | --- |
| MVP | Configuração do ciclo; preenchimento do Goal Card com pré-checagem; aprovação com revisão por seção; versões imutáveis e comparação; visão imprimível; Action Log, comentários e ações; notificações; Minhas pendências; painel do ciclo |
| Fase 2 (Q2–Q4) | Change Request de meta aprovada |
| Fase 3 (Q2–Q4) | Envio e validação de evidências |
| Backlog | Visão entre BUs, painel de calibração, digest diário, Teams, tradução assistida do conteúdo |

**Fora do escopo:** apuração do resultado, cálculo de bônus, integração com sistemas de RH e app nativo.

**Premissas:** BUs do ciclo ON, VNL, UK, JPN, OP, Salobo e Sossego (cadastro editável); interface em português e inglês; ferramentas homologadas pela TI; identidade `vbm-design`.

## 2. Perfis e acesso

| Perfil | Permissões | Recorte | Tela inicial |
| --- | --- | --- | --- |
| Contribuidores (grupo por BU) | Preencher, salvar e submeter Goal Card; recolher submissão; responder e comentar; concluir ações; (F2) abrir CR; (F3) enviar evidência. Qualquer membro do grupo da BU edita o card; o log registra quem alterou | Vê todas as BUs; edita só a(s) BU(s) do seu cadastro | T01 Minhas pendências |
| Aprovadores (grupo de aprovação P&CI/COO) | Nível único de aprovação: qualquer membro do grupo aprova, devolve ou nega; comenta; atribui ações; (F3) valida evidência | Todas as BUs | T02 Painel do ciclo |
| Consulta (grupo de leitura) | Só leitura: vê metas, Goal Cards, versões e Action Log; não edita, não comenta e não decide | Vê todas as BUs | T00 Início |
| Administrador do ciclo (P&CI) | Configurar ciclo, BUs, grupos (contribuidores, aprovadores e consulta), metas, pesos, prazos e textos padrão; reatribuir pendências; reabrir card Negado | Todas as BUs | T11 Configuração do ciclo |

| ID | Regra de acesso |
| --- | --- |
| AC-01 | Identidade pelo proxy (`X-Forwarded-Email`), vinculada a `IBP.USERS` (`CD_MATRICULA`). |
| AC-02 | O papel (contribuidor, aprovador, consulta ou administrador) é atribuído por grupo, por BU e por ciclo; a mesma pessoa pode ter papéis diferentes em BUs diferentes. Aprovadores e administrador não têm BU (valem para todas). |
| AC-03 | Usuário sem papel no ciclo ativo vê T12 "Sem acesso" e gera evento "Acesso negado" no log. |
| AC-04 | Escrita (editar, submeter, recolher, comentar ou concluir ação) em BU que não está no cadastro do usuário retorna 403 e gera evento no log. |
| AC-05 | Todos os usuários com papel no ciclo visualizam todos os dados de todas as BUs. A edição cabe só aos contribuidores da própria BU, conforme o cadastro no banco de dados (`AIP_PAPEL`); a decisão, só ao grupo de aprovação. O grupo de consulta nunca edita, comenta nem decide: a interface não mostra essas ações e a API responde 403. |
| AC-06 | Usuário inativo em `IBP.USERS` é tratado como sem acesso; suas pendências aparecem para o administrador reatribuir. |
| AC-07 | As telas de leitura (Início, Painel do ciclo, Metas da BU, Goal Card em leitura, Versões e Action Log) ficam abertas a todos os perfis, com todas as BUs. |

## 3. Regras de negócio

| ID | Condição | Resultado |
| --- | --- | --- |
| RN-01 | Administrador abre o ciclo | Metas da BU ficam em Rascunho; contribuidores são notificados |
| RN-02 | Meta criada | Título, peso e tipo vêm do desdobramento do COO; só o administrador edita |
| RN-03 | Contribuidor clica em Submeter com pré-checagem pendente | Submissão bloqueada; itens pendentes destacados (cliente e servidor) |
| RN-04 | Submissão aceita | Gera versão vN imutável; card vai a Em aprovação e entra na fila do grupo de aprovação, que é notificado |
| RN-05 | Aprovação em nível único | Não há aprovação intermediária na BU; a decisão do grupo de aprovação é final |
| RN-06 | Qualquer membro do grupo de aprovação decide | A decisão vale para o grupo; o card sai da fila dos demais; o log registra quem decidiu |
| RN-07 | Aprovação | vN vira a versão oficial; card travado para todos os perfis, salvo a reabertura da RN-17 |
| RN-08 | Devolução | Exige comentário com no mínimo 10 caracteres e ao menos uma seção marcada Ajustar |
| RN-09 | Negação | Exige justificativa com no mínimo 10 caracteres; estado final |
| RN-10 | Contribuidor resubmete um card Em revisão | Gera vN+1; card volta à fila do grupo de aprovação; aprovadores veem as diferenças entre vN e vN+1 |
| RN-11 | Contribuidor recolhe a submissão antes da decisão | Card volta a Rascunho; vN fica no histórico como Recolhida |
| RN-12 | Aprovador também é contribuidor da BU e editou ou submeteu a versão | Não pode decidir; a pendência fica com os demais membros do grupo de aprovação |
| RN-13 | Comentário publicado ou ação aberta | Estado do card não muda; ação aberta não bloqueia a aprovação, mas aparece em destaque para o aprovador |
| RN-15 | Administrador reabre um card Negado | Card volta a Rascunho com justificativa registrada |
| RN-16 | Soma dos pesos da BU sempre igual ao total do desdobramento | Regra sistêmica: o servidor recusa gravar metas e pesos (T11) com soma diferente do total e não abre o ciclo enquanto alguma BU não fechar o total; não existe estado com diferença a alertar |
| RN-17 | Card Aprovado precisa mudar | Dentro da janela inicial do ciclo (até o fim da etapa de calibração e aprovação, antes da publicação dos Goal Cards oficiais), o grupo de aprovação ou o administrador reabre o card com justificativa: volta a Rascunho e a resubmissão gera vN+1. Fora dessa janela, só via Change Request (fase 2), que gera vN+1 com motivo CR-xxx |
| RN-18 | Exclusão de BU, meta ou pessoa | Não existe; o registro é desativado e o histórico é preservado |
| RN-19 | Usuário do grupo de consulta tenta editar, comentar ou decidir | A ação não aparece na interface; a API responde 403 e o log registra a tentativa |

Limites (configuráveis no banco, nunca fixos no front-end): comentário de devolução ou negação com mínimo de 10 caracteres; anexo de até 25 MB por arquivo.

## 4. Estados e transições do Goal Card

| Estado (pt / en) | Significado | Editável por |
| --- | --- | --- |
| Rascunho / Draft | Em preenchimento; salvamento automático | Contribuidores da BU |
| Em aprovação / Pending approval | Submetido; aguarda a decisão do grupo de aprovação (nível único) | Ninguém |
| Em revisão / In Review | Devolvido aos contribuidores com seções marcadas Ajustar | Contribuidores da BU |
| Aprovado / Approved | Versão oficial; travado | Ninguém (reabertura na janela inicial do ciclo, RN-17; depois, só via CR) |
| Negado / Denied | Meta não será usada no ciclo; final | Ninguém (só reabertura pelo administrador) |

| De | Evento | Para | Quem |
| --- | --- | --- | --- |
| Rascunho | Submeter (pré-checagem verde) | Em aprovação | Contribuidor |
| Em aprovação | Aprovar | Aprovado | Membro do grupo de aprovação |
| Em aprovação | Devolver | Em revisão | Membro do grupo de aprovação |
| Em aprovação | Negar | Negado | Membro do grupo de aprovação |
| Em aprovação, sem decisão | Recolher | Rascunho | Contribuidor |
| Em revisão | Resubmeter | Em aprovação | Contribuidor |
| Negado | Reabrir com justificativa | Rascunho | Administrador |
| Aprovado, dentro da janela inicial do ciclo | Reabrir com justificativa (RN-17) | Rascunho | Grupo de aprovação ou administrador |
| Aprovado, fora da janela inicial | CR aprovado (fase 2) | Aprovado (nova versão oficial) | Grupo de aprovação |

Não mudam o estado: comentário, ação atribuída ou concluída e alteração dos membros dos grupos (a pendência só muda de dono).

**Revisão por seção:** no painel de decisão, cada uma das 7 seções recebe OK, Ajustar ou fica sem análise. Na devolução, os contribuidores abrem o card direto nas seções Ajustar. Na resubmissão, as seções alteradas aparecem destacadas para o aprovador.

## 5. Tipos de meta e campos do Goal Card

| Tipo | Como pontua | Régua | Pré-condição |
| --- | --- | --- | --- |
| Por fórmula | Resultado calculado (ex.: t produzidas, % de redução de custo) | Valores numéricos Mín / Meta / Exc na unidade da meta | Fórmula e unidade preenchidas |
| Por marcos | Quantidade de marcos concluídos (ex.: 6 / 8 / 10) | Inteiros ≤ nº de marcos cadastrados | Pelo menos 1 marco, com nome e data prevista no ano do ciclo |

Cada meta tem uma **polaridade** definida no desdobramento: "maior é melhor" exige Mín < Meta < Exc; "menor é melhor" exige Mín > Meta > Exc.

| # | Campo | Obrigatório | Regra |
| --- | --- | --- | --- |
| — | Goal Title | Sim | Vem do desdobramento; somente leitura para a BU |
| — | Peso (pts) | Sim | Vem do desdobramento; somente leitura para a BU |
| 1 | Objective / Goal | Sim | 20 a 1.000 caracteres |
| 2 | Calculation Formula | Sim | Fórmula (tipo fórmula) ou lista de marcos (tipo marcos) |
| 3 | Unit of Measurement | Sim | Lista padrão (%, t, US$, nº de marcos, dias) ou Outra com texto |
| 4 | Ruler | Sim | Três valores coerentes com o tipo e a polaridade |
| 5 | Area Responsible | Sim | Área e responsável (pessoa do diretório) |
| 6 | Evidence | Sim | Descrição da evidência que comprovará o resultado |
| 7 | Exceptions and Considerations | Sim | Texto padrão do ciclo, não editável pela BU, mais campo livre para exceções da BU |

**Pré-checagem:** painel lateral em tempo real com campos obrigatórios, régua coerente, unidade compatível com a régua, marcos dentro do ano do ciclo e evidência descrita. Submeter só fica ativo com tudo verde, e a mesma checagem roda no servidor.

## 6. Fluxos por perfil e navegação

### 6.1 Contribuidor (T01, T04)

| Passo | Comportamento |
| --- | --- |
| 1 | Abre a meta em Rascunho a partir de T01. |
| 2 | Preenche os campos com salvamento automático ("Salvo às 14:32"). Se a gravação falhar, o texto fica no navegador e aparece "Não salvo · tentar de novo". |
| 3 | Com a pré-checagem completa, submete e confirma no segundo clique. |
| 4 | Acompanha a situação na linha do tempo do card. |
| 5 | Se devolvido, recebe e-mail e aviso no app, abre o card nas seções marcadas Ajustar, responde os comentários e resubmete. |

### 6.2 Aprovador (T04)

| Passo | Comportamento |
| --- | --- |
| 1 | Recebe "Decisão pendente" por e-mail e no app; o link abre T04 em modo análise. |
| 2 | Marca cada seção como OK ou Ajustar; em resubmissões, vê as diferenças entre as versões. |
| 3 | Aprova, devolve ou nega, com confirmação no segundo clique e comentário quando exigido. |
| 4 | O app abre a próxima pendência da fila ("3 restantes"); com a fila vazia, volta a T01. |

### 6.3 Administrador (T11, T02)

| Passo | Comportamento |
| --- | --- |
| 1 | Configura ciclo, BUs, grupos (contribuidores, aprovadores e consulta), metas, pesos, prazos e textos padrão. |
| 2 | Abre o ciclo; os contribuidores são notificados. |
| 3 | Acompanha pelo T02 e reatribui pendências de quem está ausente ou inativo. |

### 6.4 Consulta (T00, T03, T05)

O grupo de consulta acompanha o ciclo sem agir: vê metas, Goal Cards (só leitura), versões e Action Log de todas as BUs, imprime a visão do Goal Card e exporta o log. Não recebe pendências nem notificações de decisão.

### 6.5 Navegação

| Situação | Comportamento |
| --- | --- |
| Menu no topo | Início (T00), Minhas pendências, Painel do ciclo, Metas da BU, Action Log, Ações, Change Requests (F2), Evidências (F3) e Configuração. Cada perfil vê apenas os itens que pode usar (consulta não vê Minhas pendências nem Configuração). |
| Filtros e seleção | Ficam na URL; o botão Voltar do navegador retorna à tela anterior com o mesmo filtro. |
| Saída de T04 com alteração não salva | O app pede confirmação antes de sair. |
| Link de e-mail | Abre a tela exata (card, seção ou ação); sem acesso, abre T12. |

## 7. Gestão do ciclo, Action Log e notificações

### 7.1 Configuração do ciclo (T11)

| Item | Regra |
| --- | --- |
| Ciclo | Ano, nome, janelas (proposta, calibração e, nas fases 2 e 3, CR e evidências) e textos padrão de exceções. A aprovação é em nível único, pelo grupo de aprovação. |
| Grupos | Contribuidores e consulta por BU; grupo de aprovação (P&CI/COO) único para todas as BUs. A pessoa entra no grupo pela matrícula. |
| BU | País e grupos vinculados. |
| Metas | Número, título, peso, tipo e polaridade, com a soma dos pesos por BU sempre visível; o servidor só grava quando a soma fecha o total (RN-16). |
| Novo ciclo | Pode ser criado clonando BUs, pessoas e metas do ciclo anterior. |
| Auditoria | Toda alteração de configuração gera evento no log com valor antes e depois. |

### 7.2 Versões

Cada submissão, resubmissão ou CR aprovado gera uma versão imutável com todos os campos, status, data, autor e motivo. Rascunho não gera versão. A versão oficial é a última aprovada, e quaisquer duas versões podem ser comparadas lado a lado em T06.

### 7.3 Action Log, comentários e ações

| Item | Regra |
| --- | --- |
| Timeline | Única e imutável, por card e por ciclo. |
| Tipos de evento | Submissão, Decisão, Comentário, Ação, Change Request, Evidência, Configuração e Acesso negado. |
| Conteúdo do evento | Quem, papel, quando, BU, meta, seção, detalhe e, nas edições, valor antes e depois. Nunca registra segredos. |
| Comentários | Ancorados a uma seção, com respostas encadeadas; não podem ser editados nem apagados depois de publicados. |
| Ações | Um comentário pode virar ação com responsável e prazo; status Aberta, Concluída (com comentário) ou Atrasada (automático). |
| Exportação | Excel, com os dados de todas as BUs (leitura aberta a todos os perfis, AC-05). |

### 7.4 Notificações

| Evento | Destinatário |
| --- | --- |
| Ciclo aberto | Contribuidores |
| Card submetido ou resubmetido | Grupo de aprovação |
| Aprovado, devolvido ou negado | Contribuidores da BU |
| Ação atribuída, ação vence em 2 dias, ação atrasada | Responsável |
| Novo comentário no card | Contribuidores da BU e grupo de aprovação |

Cada notificação chega por e-mail e no app. O e-mail vai no idioma do destinatário, com assunto `[AIP Goals] <evento>: <BU> · <meta>` e botão que abre a tela; não carrega conteúdo além do título da meta. O serviço de envio deve ser o mesmo do Kaizen (P-03). Se o e-mail falhar, o aviso no app garante a entrega.

## 8. Interface

| Requisito | Definição (padrão `vbm-design`) |
| --- | --- |
| Identidade visual | Blocos das skills copiados, não reescritos: `vbm-tokens.css` e `vbm-componentes.css` (vbm-design) e `setup-dashboards.css`/`.js` (barra e engrenagem). Toda cor sai de um token com par escuro (`:root`, bloco `prefers-color-scheme` e `:root[data-theme="dark"]`); nenhum hex solto na regra. Tokens próprios da aplicação (abertura, vidro, cores de situação do card) ficam no `aip.css`, sempre com o par escuro, e só quando a vbm-design não tem um equivalente. |
| Estrutura de tela | Barra `setup-dashboards` em vidro, no tom do fundo: logo Vale à esquerda, menu da aplicação centralizado e só com texto (inspirado no VBM Kaizen), engrenagem e usuário à direita; sai em tela cheia. Não há menu lateral. Abaixo: banner da tela (título, resumo e ações atualizar e tela cheia) → `.filters` → painel com os cartões → "Last updated …" → `.toast`. O Início (T00) é uma abertura em tela cheia sobre a foto dos três minerais. |
| Tema, idioma e formato | Só na engrenagem: grava `data-theme` no `<html>` e as chaves `vdt-theme`, `vdt-lang` e `vdt-num`; sem botão de tema nem chave nova. Textos fixos com `data-i18n` (pt-BR e en); números e datas por `VBMSetup.fmt` (Brasil 1.234,56 · Canadá 1,234.56). Conteúdo digitado no card (P-06) e nomes vindos do banco (BU, meta, pessoa) não são traduzidos. |
| Tipografia e ícones | Poppins local, com as faces embutidas (`VBM-Aip-Goals/assets/css/poppins.css`, cópia da do Performance Hub); nada de Google Fonts. Ícones em SVG próprio (sprite inline na página) ou pelo Font Awesome já servido pelo app, em subconjunto local; nunca por CDN. |
| Rede | Corporativa fechada: sem CDN, Google Fonts ou kit; fontes, ícones e scripts locais. |
| Filtros | Padrão COO: rótulo em itálico em cima; `.seg` com `aria-pressed` para poucas opções (Estado, Tipo, Período); `.switch` com `role="switch"` para liga/desliga (ex.: só atrasadas); `.unit` para País › BU e para Ciclo (mais recente primeiro). Estado na URL. |
| Status do Goal Card | Pílula com ícone + rótulo + cor do token de fluxo `--status-*` (mesmo do Kaizen): Rascunho `--status-draft` (cinza), Em aprovação `--status-pending` (âmbar), Em revisão `--status-review` (azul), Aprovado `--status-approved` (verde), Negado `--status-rejected` (vermelho). Nunca só por cor: nos gráficos compactos a situação vai também na legenda, no `title` e no `aria-label`. `--good` e `--bad` ficam para desempenho nos gráficos; ciclo e prazo usam o âmbar `--wait` (atrasada com `--late-bg`), nunca verde ou vermelho. |
| Gráficos | SVG próprio, sem biblioteca: anéis de progresso (T02, T03), barras de composição (T02), funil e tempo em aprovação em barras; sem pizza. Séries com `--serie-a` / `--serie-b` / `--serie-p`; situação com `--status-*`; deltas, se houver, com `--good` / `--bad` / `--flat`. `NULL` = "sem dado", nunca 0; `role="img"` + `aria-label` com o resumo; redesenho ao trocar filtro, idioma, formato, tema e tamanho; animação só de `transform` e `opacity`. |
| Avisos e salvamento | `.toast` com `role="status" aria-live="polite"` ("Salvo às 14:32"; erro com `.is-err`), em linguagem de negócio. Botão salvar com `.is-pendente` enquanto houver alteração não salva. |
| Perfis na interface | Cada grupo vê só o que pode fazer: ações que o perfil não tem não são desenhadas (não basta desabilitar). **Contribuidores:** Salvar, Submeter e Recolher no Goal Card. **Aprovadores:** painel de decisão com Aprovar (`.btn`), Devolver e Negar (`.btn-sec`), confirmação no segundo clique; os botões não usam `--good`/`--bad`, a cor de situação fica só na pílula. **Consulta:** pílula neutra "Somente leitura" (`--flat`, ícone de cadeado) no banner da tela e do Goal Card; sem campos editáveis, comentários nem decisão; menu sem Minhas pendências e Configuração. |
| Estados de tela | Toda tela trata carregando, vazio, erro, sem permissão e desatualizado ("Last updated …"). |
| Ações irreversíveis | Confirmação no segundo clique, em caixa `role="alertdialog"`, nunca `confirm()`. Mensagens de erro não mostram texto do banco. |
| Acessibilidade | Contraste AA (texto ≥ 4,5:1; texto grande e ícones ≥ 3:1); `--accent` só em texto ≥ 24 px, abaixo disso `--accent-strong`; foco visível com `--focus`; alvos ≥ 32 px (44 px no toque); `aria-label` e `title` em botões só com ícone; `aria-expanded` nos popovers, Esc fecha e devolve o foco. |
| Dispositivos | Notebook e desktop, de 1024 px a 4K; celular fora do escopo (D-07). Raiz fluida (`clamp`), menu em gaveta em janelas de até 1080 px, layout compacto com até 820 px de altura e cards por container query; conferido em 1024, 1180, 1280×590, 1280×800, 1366, 1440, 1920, 2560 e 3840 px e com zoom de 200%, nos dois temas, sem rolagem lateral. |
| Impressão (T05) | A4 e PDF com Poppins e cores VBM em valores fixos (sem `var()`); versão não oficial sai com marca d'água "Não aprovado". |

## 9. Arquitetura e dados

| Item | Definição (padrão `vbm-design`) |
| --- | --- |
| Localização | Pasta própria na raiz do repositório: `VBM-``Aip-Goals/`, servida em `/VBM-A``ip-``G``oals/`, com API em `/``VBM-A``ip-``G``oals/api` (fora do Performance Hub). Montagem no `server.js` da raiz, no mesmo modelo do VBM-Stable-and-Capable: controle de acesso (`portal-acesso.js`, `IBP.USERS`) → `require` do `portal.js` em `try/catch` → `express.static` da pasta, nessa ordem; card de entrada na página inicial do Portal. Da pasta, só `index.html` e `assets/` são públicos (pedir `portal.js` retorna 404). |
| Stack | Node com Express 5, no processo único do Portal. Um router, dois pontos de entrada: `VBM-Aip-Goals/portal.js` (no Portal) e `VBM-Aip-Goals/server.js` (standalone) injetam o mesmo `runQuery` no `aip-goals-api.js`. A pasta nasce do molde (`scripts/nova-app.sh`). |
| Identidade | Só pelo `X-Forwarded-Email` do proxy do Databricks Apps; simulação apenas com `NODE_ENV=development` fora do Databricks. Autorização sempre no servidor, deny by default. |
| Banco | Azure SQL `BDIBPBMSA_DEV` / `_PRD`, escolhida por `AIPGOALS_AZURE_SQL_DATABASE`; pool próprio (max 3, `connectionTimeout` 30 s, `requestTimeout` 60 s, `encrypt: true`). Scripts do time de dados em `database/00N_*.sql`, lidos sem reescrever. |
| Consultas | `runQuery(sql, { nome: [sql.Tipo, valor] })`, só com parâmetros; sem `SELECT *` e sem função na coluna filtrada; `NULL` não vira 0; parâmetro inválido retorna 400. |
| Arquivos (F2–F3) | Blob `ibpdatalake/vbmdatalake` via `azure-blob.js`, privado; upload com limite de tamanho, MIME validado e nome gerado; download só para usuários com papel no ciclo. |
| Variáveis | Prefixo `AIPGOALS_` no `app.yaml` da raiz, com o padrão descrito no cabeçalho do `portal.js`; segredos só via `valueFrom`. |
| Cache | Por chave, com deduplicação e `?fresco=1` para forçar; em falha, devolve o último resultado marcado `desatualizado` com "Last updated". Cliente com timeout de 75 s, sem retry em 5xx, 403 e 429. |
| Segurança | SQL parametrizada; `esc()` em todo dado antes de `innerHTML` ou SVG; validação no cliente e no servidor; `helmet`; `no-store` na API e no HTML; limite de pedidos por usuário; erro sem texto do banco; operações de decisão idempotentes; rotas de diagnóstico só com `AIPGOALS_DIAGNOSTICO=1`; health devolve só `{ status }`. |
| LGPD | Nome, e-mail e matrícula visíveis só para usuários com papel no ciclo |
| Governança | Branch → PR em `002felip/pci-portal` com evidência de testes e conferência visual → merge em `main`. `docs/projetos/aip-goals.md` atualizado no mesmo PR; `?v=AAAAMMDD` trocado nos scripts alterados; `scripts/conferir.py` sem candidato novo não justificado. |

**Modelo de dados (proposta para validação com o time de dados)**

| Tabela | Conteúdo |
| --- | --- |
| AIP_CICLO | Ano, nome, janelas, textos padrão, status |
| AIP_CICLO_BU | BU do ciclo, país, ativo |
| AIP_PAPEL | Matrícula, ciclo, BU (nula para aprovadores e administrador), papel (contribuidor, aprovador, consulta, administrador), ativo |
| AIP_META | Ciclo, BU, número, título, peso, tipo, polaridade, ativo |
| AIP_GOAL_CARD | Estado atual, versão oficial, rascunho corrente |
| AIP_GOAL_CARD_VERSAO | Snapshot imutável dos campos, vN, motivo, autor, data |
| AIP_MARCO | Versão, nome, data prevista |
| AIP_DECISAO | Versão, decisão, comentário, decidido por, data |
| AIP_REVISAO_SECAO | Decisão, seção, marcação (OK ou Ajustar) |
| AIP_COMENTARIO | Card, seção, texto, autor, data, resposta a |
| AIP_ACAO | Comentário de origem, responsável, prazo, status |
| AIP_EVENTO_LOG | Tipo, quem, papel, quando, BU, meta, seção, antes, depois |
| AIP_NOTIFICACAO | Destinatário, evento, canal, enviado em, lido em |
| AIP_CHANGE_REQUEST (F2) | Meta, seção, valor atual, proposto, justificativa, anexo, estado |
| AIP_EVIDENCIA (F3) | Meta ou marco, arquivo, status de validação, comentário |
| AIP_PARAMETRO | Limites configuráveis (caracteres mínimos, tamanho de anexo) |

## 10. Catálogo de telas

| ID | Tela | Perfis | Conteúdo e ações | Fase |
| --- | --- | --- | --- | --- |
| T00 | Início | Todos | Abertura do ciclo AIP: etapa atual e prazo, data dos Goal Cards oficiais, BUs do ciclo por país, jornada do ciclo e índice das telas do perfil | MVP |
| T01 | Minhas pendências | Contribuidores, aprovadores, admin | Fila pessoal: cards a preencher, decisões, comentários sem resposta e ações, com prazo e idade | MVP |
| T02 | Painel do ciclo | Todos | KPIs (submetidos, aprovados %, em aprovação, em revisão, negados); matriz BU × status; funil; tempo em aprovação; filtro País › BU | MVP |
| T03 | Metas da BU | Todos | Metas com peso, tipo, status e versão; soma de pesos | MVP |
| T04 | Goal Card | Todos | Edição com pré-checagem (contribuidores); análise com revisão por seção e painel de decisão (aprovadores); comentários por seção; linha do tempo do card; só leitura para consulta | MVP |
| T05 | Visão do Goal Card | Todos | Template VBM com versão, status e data; imprimir e PDF | MVP |
| T06 | Versões | Todos | Lista de versões e comparação entre duas | MVP |
| T07 | Action Log | Todos | Timeline com filtros BU, Meta, Seção, Tipo e Período; exportar Excel | MVP |
| T08 | Ações | Contribuidores, aprovadores, admin | Ações abertas, concluídas e atrasadas; concluir com comentário | MVP |
| T09 | Change Requests | Contribuidores, aprovadores | Abrir CR; decidir com atual × proposto lado a lado | F2 |
| T10 | Evidências | Contribuidores, aprovadores | Upload por meta ou marco; aceitar ou devolver | F3 |
| T11 | Configuração do ciclo | Admin | Ciclo, BUs, grupos, metas, pesos, prazos, textos padrão, parâmetros | MVP |
| T12 | Sem acesso / não encontrado | — | Mensagem neutra, sem revelar dados | MVP |

## 11. Critérios de aceite

| ID | Critério | Ref. |
| --- | --- | --- |
| CA-01 | Usuário sem papel no ciclo vê T12 e a tentativa aparece no log | AC-03 |
| CA-02 | Todos os perfis visualizam todas as BUs; contribuidor não edita BU fora do seu cadastro e a API responde 403 | AC-04, AC-05 |
| CA-03 | Não é possível submeter com campo obrigatório vazio ou régua incoerente, nem pelo cliente nem pela API | RN-03 |
| CA-04 | Submeter gera vN imutável e notifica todos os membros do grupo de aprovação por e-mail e no sino | RN-04 |
| CA-05 | A primeira aprovação do grupo torna a versão oficial; não existe etapa intermediária | RN-05, RN-07 |
| CA-06 | Decisão de um membro do grupo tira o card da fila dos demais e registra quem decidiu | RN-06 |
| CA-07 | Devolver exige comentário com no mínimo 10 caracteres e uma seção Ajustar; o contribuidor abre o card nessa seção | RN-08 |
| CA-08 | Resubmeter gera vN+1, volta à fila do grupo de aprovação e mostra as diferenças ao aprovador | RN-10 |
| CA-09 | Card Aprovado não aceita edição por nenhum perfil, nem pela API, exceto pela reabertura da RN-17 dentro da janela inicial do ciclo | RN-07, RN-17 |
| CA-10 | Ninguém decide sobre um card que editou ou submeteu | RN-12 |
| CA-11 | Gravar metas e pesos com soma diferente do total do desdobramento é recusado pelo servidor, e o ciclo não abre com BU fora do total | RN-16 |
| CA-12 | T05 imprime e gera PDF com versão, status e data; versão não oficial sai com marca d'água | §8 |
| CA-13 | Todo comentário, decisão, ação e mudança de configuração aparece no log, filtrável e exportável em Excel | §7 |
| CA-14 | Comentário convertido em ação notifica o responsável e entra no T01 dele | §7 |
| CA-15 | Contagens do T02 batem com a lista de metas de cada BU | T02 |
| CA-16 | Interface completa em pt-BR e en (nenhum texto fixo sem `data-i18n`), tema claro e escuro com contraste AA e nenhuma cor fora de token, em 1024, 1280×590, 1366, 1440, 1920 e 3840 px sem rolagem lateral; status sempre com ícone e rótulo (nos gráficos compactos, com legenda, `title` e `aria-label`) | §8 |
| CA-17 | Clicar duas vezes em Aprovar gera uma única decisão | §9 |
| CA-18 | O grupo de consulta não vê botões de edição, comentário ou decisão, e qualquer escrita pela API responde 403 com registro no log | AC-05, RN-19 |

## 12. Pendências e decisões em aberto

| ID | Decisão | Opções | Quem decide | Bloqueia? |
| --- | --- | --- | --- | --- |
| P-03 | Serviço de envio de e-mail | Mesma solução do Kaizen (provável) / outra homologada | TI + P&CI | Não; o sino cobre até a definição |
| P-04 | BU pode propor meta fora do desdobramento? | Não / sim, com aprovação do P&CI | P&CI + COO | Não |
| P-05 | Nomes oficiais dos estados | Conforme §4 | P&CI | Não |
| P-06 | Conteúdo do card em um ou dois idiomas | Um idioma por card / bilíngue obrigatório | P&CI | Não |
| P-07 | Janela de Change Request | Fixa no ciclo / a qualquer momento | P&CI + RH | Não (F2) |
| P-08 | Retenção de evidências e dados do ciclo | Anos de retenção | P&CI + Jurídico/RH | Não (F3) |
| P-09 | Aprovação local da CEO-2 | Não incluir (aprovação em nível único, D-09) / tratar fora do app | P&CI + COO | Não |
| P-10 | Dono do produto e sustentação | Nome e área | P&CI | Não |
| P-12 | Modelo de dados | Validar a proposta do §9 | Time de dados | Sim, para o banco |

Decisões já tomadas (P-01, P-02, P-11 → D-09, P-13 → D-11 e itens validados) estão em [LEVANTAMENTO-REQUISITOS.md](LEVANTAMENTO-REQUISITOS.md).

**Ordem técnica recomendada** (dependências, sem datas): esquema do banco e parâmetros; perfis e autorização no servidor; configuração do ciclo (T11); Goal Card com pré-checagem e versões; aprovação em nível único com revisão por seção; Action Log, comentários e ações; notificações no app e por e-mail; Minhas pendências e painel do ciclo; visão imprimível; testes de permissão, estados e idempotência; depois, Change Request (F2) e Evidências (F3).

## 13. Telas desenvolvidas

Cinco telas do MVP estão prontas no protótipo (T00 Início, T01 Minhas pendências, T02 Painel do ciclo, T03 Metas da BU e T04 Goal Card), com dados de exemplo até a validação do modelo de dados (P-12). As demais telas do catálogo já têm endereço no menu e abrem "Tela em construção".

| Tela | Situação | O que já funciona | Depende de |
| --- | --- | --- | --- |
| T00 Início | Desenvolvida | Abertura do ciclo AIP 2027: etapa atual e prazo, data dos Goal Cards oficiais, BUs por país, jornada do ciclo com a etapa atual e índice das telas do perfil | Janelas e BUs reais (T11, P-12) |
| T01 Minhas pendências | Desenvolvida | Fila por tipo, resumo que filtra, filtros País › BU, ordenação e só paradas ou atrasadas na URL, status com ícone e rótulo, idade em dias úteis (RN-14), estados de carregando, vazio, erro, sem acesso e desatualizado | Consulta real da fila (P-12) |
| T02 Painel do ciclo | Desenvolvida | Só para P&CI/COO e administrador; título Ciclo AIP 2027 e jornada do ciclo com um anel por etapa (% do total, prazo e quantitativo, como "27 de 41"), matriz BU × situação com barra de composição, funil, tempo em aprovação com o limite da RN-14, cards parados há mais tempo e filtro País › BU na URL; contagens calculadas da mesma lista de cards (CA-15) | Goal Cards reais por BU (P-12) |
| T03 Metas da BU | Desenvolvida | Metas de uma BU no recorte do usuário (AC-04/AC-05, fora do recorte → 404); quatro anéis por peso (distribuído, submetido, em aprovação, aprovado); alerta da soma dos pesos (RN-16); tabela com peso, tipo, situação e versão; BU na URL | Metas e pesos reais por BU (P-12) |
| T04 Goal Card | Desenvolvida | Modo pelo grupo e pela situação (servidor): edição para contribuidores da BU (Rascunho e Em revisão), análise para o grupo de aprovação (Em aprovação, respeitando a RN-12) e leitura para os demais; topo com número da meta, situação, versão, peso, tipo e polaridade e linha do tempo do card; 7 seções com régua pela polaridade e marcos; pré-checagem ao vivo e no servidor (Submeter só com tudo verde); revisão OK/Ajustar por seção, decisão Aprovar/Devolver/Negar com RN-08 e RN-09 e confirmação no segundo clique (`alertdialog`); comentários por seção; rascunho salvo no navegador; escritas validadas e simuladas | Gravação real (P-12) |
| T12 Sem acesso | Parcial | Estado "Sem acesso" dentro da T01 e da T02 quando a API responde 401 ou 403 | Tela própria e evento "Acesso negado" no log |
| T05, T06, T07, T08, T11 | Em construção | Endereço no menu e na T00 (cada perfil vê só as suas) | Modelo de dados (P-12) |
| T09, T10 | Não iniciadas | — | Fases 2 e 3 |

Comum às telas prontas: barra em vidro com menu no topo, tema claro e escuro e idioma pt-BR/en pela engrenagem, tokens `vbm-design` e escopo notebook e desktop (§8). **Ajuste pendente no protótipo:** os dados de exemplo e as telas T01, T02 e T03 ainda mostram dois níveis (Diretor da BU e P&CI/COO) e os papéis antigos; passam a nível único e aos grupos contribuidores, aprovadores e consulta na próxima entrega. **Ajuste pendente pelas regras de 17/11:** leitura aberta a todos (hoje a API filtra por BU e o Painel é só do P&CI/COO), sem o alerta de pendência parada (antiga RN-14) e sem o alerta de soma dos pesos na T03 (RN-16 passa a ser validação na gravação). Código em `VBM-Aip-Goals/` (raiz do portal-pci, PR #94), API em `/VBM-Aip-Goals/api/pendencias`, documentação em `docs/projetos/aip-goals.md`.
