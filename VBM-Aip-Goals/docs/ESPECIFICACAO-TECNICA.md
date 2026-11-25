# Especificação Técnica — Aplicação AIP Goals v1

> Cópia em Markdown do documento "AIP Goals — Especificação funcional e levantamento de requisitos" (aba Especificação técnica v1), atualizada em 18/11/2026. Ao mudar a especificação, atualize o documento e esta cópia no mesmo PR.

16 de nov de 2026 · Cristian

Versão 1 · Especificação funcional, técnica e catálogo de telas do MVP, com as fases 2 e 3 já desenhadas. O levantamento de requisitos que originou esta versão está em [LEVANTAMENTO-REQUISITOS.md](LEVANTAMENTO-REQUISITOS.md).

**Objetivo:** orientar diretamente o desenvolvimento da aplicação, sem cronograma, orçamento ou estimativas. Toda regra de permissão, estado e validação deve ser aplicada no servidor; a interface apenas antecipa o resultado.

## 1. Visão e escopo

O AIP Goals é a aplicação do portal-pci que leva cada meta de AIP das BUs de VBM (Brasil, Canadá e International Refineries) do desdobramento do COO até o Goal Card aprovado, versionado e rastreável. Ela substitui o PPT e o e-mail como fonte oficial.

**Objetivo:** governar a definição das metas com um fluxo único de preenchimento, aprovação e registro, para que cada BU tenha uma versão oficial de cada Goal Card e todo comentário e decisão fique no histórico.

| Fase | Escopo |
| --- | --- |
| MVP | Configuração do ciclo (T11); preenchimento do Goal Card com campos obrigatórios (T04); aprovação em nível único com revisão por seção (T14); versões imutáveis e comparação (T06); Action Log e comentários (T07); notificações; painel do ciclo (T02) e metas da BU (T03) |
| Fase 2 (Q2–Q4) | Change Request de meta aprovada |
| Fase 3 (Q2–Q4) | Envio e validação de evidências |
| Backlog | Visão entre BUs, painel de calibração, digest diário, Teams, tradução assistida do conteúdo |

**Fora do escopo:** apuração do resultado, cálculo de bônus, integração com sistemas de RH e app nativo. **Descontinuado (D-20):** visão imprimível e PDF do Goal Card (antiga T05) e gestão de ações com responsável e prazo a partir de comentários (antiga T08). O Goal Card oficial é consultado na própria T04, em leitura, e os comentários do grupo de aprovação orientam o ajuste dentro do fluxo Devolver → Resubmeter, sem virar tarefas paralelas.

**Premissas:** BUs do ciclo com os nomes dos sites do COO Dashboard — Onça Puma, Salobo e Sossego (Brasil); Ontario e VNL (Canadá); Clydach e Matsusaka (International Refineries) (cadastro editável); interface em português e inglês; ferramentas homologadas pela TI; identidade `vbm-design`.

## 2. Perfis e acesso

| Perfil | Telas | Edição | Cadastro |
| --- | --- | --- | --- |
| Qualquer usuário do Portal | Todas as telas de leitura (Início, COO AIP, AIP BU's, Goal Card, Versões, Action Log) | Nenhuma (somente leitura) | Nenhum: basta acesso ao Portal (`IBP.USERS`) |
| Contribuidor | Início (menu), COO AIP e AIP BU's, com Goal Card, Versões e Histórico nos popups | Só os Goal Cards da sua BU (ex.: cadastrado em Salobo edita os cards de Salobo; os demais, só lê) | `AIP_PAPEL` com `TP_GRUPO = CONTRIBUIDOR` e `ID_SITE` (uma linha por BU) |
| Aprovador | Todas, exceto a Administração (configuração do ciclo): menu com Aprovações e Action Log | Edita e aprova (ou devolve para ajuste) os Goal Cards de todas as BUs | `AIP_PAPEL` com `TP_GRUPO = APROVACAO` |
| Administrador | Todas as telas | Tudo, inclusive configuração do ciclo | `AIP_PAPEL` com `TP_GRUPO = ADMIN` |

| ID | Regra de acesso |
| --- | --- |
| AC-01 | Identidade pelo proxy (`X-Forwarded-Email`), vinculada a `IBP.USERS` (`CD_MATRICULA`). |
| AC-02 | O papel (contribuidor, aprovador ou administrador) é atribuído por ciclo em `AIP_PAPEL`; o contribuidor tem uma linha por BU. O antigo grupo Consulta deixa de existir: a leitura é aberta a qualquer usuário do Portal. |
| AC-03 | Usuário sem papel no ciclo entra em somente leitura; só as telas administrativas e as ações de escrita respondem 403 (com evento "Acesso negado" no log). |
| AC-04 | Escrita (editar, submeter, recolher ou comentar) em BU que não está no cadastro do usuário retorna 403 e gera evento no log. |
| AC-05 | Todos veem todos os dados de todas as BUs. Editar um Goal Card: contribuidor da BU do card, aprovador ou administrador. Aprovar ou devolver: aprovador ou administrador. |
| AC-06 | Usuário inativo em `IBP.USERS` é tratado como sem acesso; suas pendências aparecem para o administrador reatribuir. |
| AC-07 | As telas de leitura (Início, COO AIP, AIP BU's, Goal Card em leitura, Versões e Action Log do card) ficam abertas a qualquer usuário do Portal. As telas administrativas (submenu Administração) são só do administrador. |
| AC-08 | A fila de Aprovações é do aprovador e do administrador; os demais não veem o item no menu e a API responde 403 (com evento no log). |

## 3. Regras de negócio

| ID | Condição | Resultado |
| --- | --- | --- |
| RN-01 | Administrador abre o ciclo | Metas da BU ficam em Rascunho; contribuidores são notificados |
| RN-02 | Meta criada | Título, peso e tipo vêm do desdobramento do COO; só o administrador edita |
| RN-03 | Contribuidor clica em Submeter com campo obrigatório vazio | Submissão bloqueada; campos que faltam destacados (cliente e servidor) |
| RN-04 | Submissão aceita | Gera versão vN imutável; card vai a Em aprovação e entra na fila do grupo de aprovação, que é notificado |
| RN-05 | Aprovação em nível único | Não há aprovação intermediária na BU; a decisão do grupo de aprovação é final |
| RN-06 | Qualquer membro do grupo de aprovação decide | A decisão vale para o grupo; o card sai da fila dos demais; o log registra quem decidiu |
| RN-07 | Aprovação | vN vira a versão oficial; card travado para todos os perfis, salvo a reabertura da RN-17 |
| RN-08 | Devolução | Exige comentário com no mínimo 10 caracteres e ao menos uma seção marcada Ajustar |
| RN-09 | Negação | Exige justificativa com no mínimo 10 caracteres; estado final |
| RN-10 | Contribuidor resubmete um card Em revisão | Gera vN+1; card volta à fila do grupo de aprovação; aprovadores veem as diferenças entre vN e vN+1 |
| RN-11 | Contribuidor recolhe a submissão antes da decisão | Card volta a Rascunho; vN fica no histórico como Recolhida |
| RN-12 | Aprovador também é contribuidor da BU e editou ou submeteu a versão | Não pode decidir; a pendência fica com os demais membros do grupo de aprovação |
| RN-13 | Comentário publicado | Estado do card não muda; o comentário fica ancorado à seção e aparece no Goal Card e no Action Log |
| RN-16 | Soma dos pesos da unidade: no máximo o total do desdobramento (100 pts) | Acima do total é bloqueado (o campo limita o peso ao que ainda cabe e o servidor recusa); abaixo do total é só aviso por unidade e a gravação parcial é permitida, para terminar depois (D-31, D-33). |
| RN-15 | Sem negação | O grupo de aprovação só aprova ou devolve para ajuste; não existe Negar nem o estado Negado no modelo (D-25). |
| RN-17 | Card Aprovado precisa mudar | Só o administrador do sistema reabre um card aprovado para edição (botão "Reabrir para edição" no Goal Card, com confirmação). O card volta para Rascunho; a versão aprovada continua no histórico e a reabertura vai ao Action Log. |
| RN-18 | Exclusão de BU, meta ou pessoa | Não existe; o registro é desativado e o histórico é preservado |
| RN-19 | Usuário do grupo de consulta tenta editar, comentar ou decidir | A ação não aparece na interface; a API responde 403 e o log registra a tentativa |

Limites (definidos na aplicação, fora do banco e da tela de Administração): comentário de devolução com mínimo de 10 caracteres; anexo de até 25 MB por arquivo.

## 4. Estados e transições do Goal Card

| Estado (pt / en) | Significado | Editável por |
| --- | --- | --- |
| Rascunho / Draft | Em preenchimento; salvamento automático | Contribuidores da BU |
| Em aprovação / Pending approval | Submetido; aguarda a decisão do grupo de aprovação (nível único) | Ninguém |
| Em revisão / In Review | Devolvido aos contribuidores com seções marcadas Ajustar | Contribuidores da BU |
| Aprovado / Approved | Versão oficial; travado | Ninguém (reabertura na janela inicial do ciclo, RN-17; depois, só via CR) |

| De | Evento | Para | Quem |
| --- | --- | --- | --- |
| Rascunho | Submeter (campos obrigatórios preenchidos) | Em aprovação | Contribuidor |
| Em aprovação | Aprovar | Aprovado | Membro do grupo de aprovação |
| Em aprovação | Devolver | Em revisão | Membro do grupo de aprovação |
| Em aprovação, sem decisão | Recolher | Rascunho | Contribuidor |
| Em revisão | Resubmeter | Em aprovação | Contribuidor |
| Aprovado, dentro da janela inicial do ciclo | Reabrir com justificativa (RN-17) | Rascunho | Grupo de aprovação ou administrador |
| Aprovado, fora da janela inicial | CR aprovado (fase 2) | Aprovado (nova versão oficial) | Grupo de aprovação |

Não mudam o estado: comentário e alteração dos membros dos grupos (a pendência só muda de dono).

**Revisão por item (T14 Aprovações):** a ficha mostra os dados como no Goal Card, sem o comparativo de versões (o que mudou aparece só no botão Versões, em popup), com acesso direto às Versões e ao Histórico. Cada item tem um lápis "Marcar para ajuste" que abre um popup com o campo obrigatório "O que precisa ser ajustado" (Salvar ajuste, Cancelar e, se já marcado, Remover marcação); o item marcado mostra um resumo do ajuste. Se o item tem comentário, aparece o balão (sem texto), que abre os comentários em popup, somente leitura. Itens sem o lápis contam como OK. Aprovar não aceita item marcado; Devolver exige ao menos um item marcado, o comentário de cada um e o comentário da decisão (mínimo de caracteres). Não há Negar (D-25). A decisão é final (nível único).

## 5. Tipos de meta e campos do Goal Card

| Tipo | Como pontua | Régua | Pré-condição |
| --- | --- | --- | --- |
| Por fórmula | Resultado calculado (ex.: t produzidas, % de redução de custo) | Valores numéricos Mín / Meta / Exc na unidade da meta | Fórmula de cálculo preenchida (uma linha) |
| Por marcos | Quantidade de marcos concluídos (ex.: 6 / 8 / 10) | Inteiros (nº de marcos) | Fórmula de cálculo preenchida (uma linha) |

Cada meta tem uma **orientação** (`TP_ORIENTACAO`) definida no desdobramento: "maior é melhor" ou "menor é melhor"; ela aparece no card, sem validação da régua nesta etapa.

| # | Campo | Obrigatório | Regra |
| --- | --- | --- | --- |
| — | Goal Title | Sim | Vem do desdobramento; somente leitura para a BU |
| — | Peso (pts) | Sim | Vem do desdobramento; somente leitura para a BU |
| 1 | Objective / Goal | Sim | 20 a 1.000 caracteres |
| 2 | Calculation Formula | Sim | Memória de cálculo: uma linha com a fórmula |
| 3 | Unit of Measurement | Sim | Lista padrão (%, t, US$, nº de marcos, dias) ou Outra com texto |
| 4 | Ruler | Sim | Três valores: Mín., Meta e Exc. |
| 5 | Area Responsible | Não editável | Preenchido do cadastro da BU: área Diretoria Executiva e o diretor da BU como responsável (Administração › Business Units) |
| 6 | Evidence | Sim | Descrição da evidência que comprovará o resultado |
| 7 | Exceptions and Considerations | Sim | Texto do site definido pelo administrador na aba Exceções (não editável pela BU, aparece se o olho do site estiver aberto), mais o campo livre de exceções preenchido pela BU |

**Campos obrigatórios:** os campos 1 a 6 (Objective, Calculation Formula, Unit of Measurement, os três valores do Ruler, Area Responsible com área e responsável, e Evidence) são obrigatórios e marcados com \*; as exceções da BU são opcionais. Submeter fica bloqueado enquanto algum obrigatório estiver vazio, e o servidor repete a mesma verificação.

## 6. Fluxos por perfil e navegação

### 6.1 Contribuidor (T03, T04)

| Passo | Comportamento |
| --- | --- |
| 1 | Abre a meta em Rascunho pela T03 AIP BU's: o botão Abrir mostra o Goal Card num popup grande, já pronto para editar (Ctrl+clique abre a tela inteira). Também pelo aviso recebido por e-mail e no app. |
| 2 | Preenche os campos com salvamento automático ("Salvo às 14:32"). Se a gravação falhar, o texto fica no navegador e aparece "Não salvo · tentar de novo". |
| 3 | Com os campos obrigatórios preenchidos, submete e confirma no segundo clique. |
| 4 | Acompanha a situação na linha do tempo do card. |
| 5 | Se devolvido, recebe e-mail e aviso no app, abre o card nas seções marcadas Ajustar, responde os comentários e resubmete. |

### 6.2 Aprovador (T14)

| Passo | Comportamento |
| --- | --- |
| 1 | Recebe "Decisão pendente" por e-mail e no app; o link abre a T14 Aprovações na ficha do card. |
| 2 | Marca cada seção como OK ou Ajustar; em resubmissões, vê as diferenças entre as versões. |
| 3 | Aprova, devolve ou nega, com confirmação no segundo clique e comentário quando exigido. |
| 4 | O app abre a próxima ficha da fila ("3 restantes"); com a fila vazia, volta à lista da T14. |

### 6.3 Administrador (T11, T02)

| Passo | Comportamento |
| --- | --- |
| 1 | Configura ciclo, BUs, grupos (contribuidores, aprovadores e consulta), metas, pesos, prazos e textos padrão. |
| 2 | Abre o ciclo; os contribuidores são notificados. |
| 3 | Acompanha pelo T02 e reatribui pendências de quem está ausente ou inativo. |
| 4 | Quando preciso, edita e submete Goal Cards de qualquer BU em Rascunho ou Devolvido para ajuste (D-16). |

### 6.4 Consulta (T00, T03, T04, T06, T07)

O grupo de consulta acompanha o ciclo sem agir: vê metas, Goal Cards (só leitura), versões e Action Log de todas as BUs e exporta o log. Não recebe pendências nem notificações de decisão.

### 6.5 Navegação

| Situação | Comportamento |
| --- | --- |
| Menu no topo | Nesta ordem: Início (T00), COO AIP (antes Desdobramento), AIP BU's (antes Metas da BU; o Painel do ciclo, T02, está oculto: fora do menu e sem rota, mantido no código), Aprovações (T14), Action Log (T07), Change Requests (F2), Evidências (F3) e Administração (T11, a configuração do ciclo, em abas). Cada perfil vê apenas os itens que pode usar: Aprovações e Action Log para o grupo de aprovação e o administrador; Administração só para o administrador (D-28). |
| Filtros e seleção | Ficam na URL; o botão Voltar do navegador retorna à tela anterior com o mesmo filtro. |
| Saída de T04 com alteração não salva | O app pede confirmação antes de sair. |
| Link de e-mail | Abre a tela exata (card ou seção); sem acesso, abre T12. |
| Endereço antigo ou fora do catálogo | Volta ao Início (ex.: `#acoes`, da antiga T08). |

## 7. Gestão do ciclo, Action Log e notificações

### 7.1 Configuração do ciclo (T11)

| Item | Regra |
| --- | --- |
| Ciclo | A tela se chama **Administração**. O cartão **Identificação** traz uma barra do ciclo: lista de ciclos ("AIP 2027 · Aberto"), situação e as ações do ciclo no mesmo lugar — *Fechar ciclo* (ciclo aberto), *Reabrir ciclo* (ciclo fechado, só sem outro aberto) e *+ Abrir novo ciclo* (só sem ciclo aberto; aviso "Só pode haver um ciclo aberto"). Abaixo, o resumo da jornada calculado das janelas (início, fim, dias úteis e etapa atual), o nome e o texto padrão de exceções. O cartão **Janelas do <ciclo>** tem, em cada uma das 4 etapas, data de início e de fim: o início vem preenchido com o fim da etapa anterior (campo tracejado) e pode ser alterado; ao mudar o fim de uma etapa, o início padrão da próxima acompanha. A etapa atual é calculada pela data de hoje. Validação: fim depois do início em cada etapa e inícios na ordem das etapas. Ciclo fechado: janelas, nome e texto ficam desativados. A barra de **Descartar / Salvar alterações** só aparece quando há alterações (com destaque); sem alterações, mostra "Tudo salvo". |
| Grupos | Seções no padrão dos Aprovadores do Kaizen: Aprovação, Administradores e uma por BU (contribuidores e consulta), com contagem e cards de pessoa (iniciais, nome, e-mail, cargo). Botão *Novo usuário* abre popup que busca no **MDM** por nome ou e-mail (mín. 2 caracteres) e mostra nome completo, matrícula, e-mail, cargo, estado e cidade (somente leitura); o administrador escolhe grupo e, para contribuidor e consulta, a BU. O AIP guarda só a matrícula; os dados da pessoa são lidos do MDM. |
| BU | Cadastro das BUs do ciclo aberto que está sendo configurado: criar (nome e país ou região), diretor da BU (responsável da Area Responsible nos Goal Cards), editar (renomear atualiza pesos, pessoas e Gerências Gerais ligadas), tirar do ciclo (a BU fica no cadastro, mas não recebe Goal Cards nem notificações e sai das somas) e excluir. Só se exclui BU sem Goal Card submetido; com card submetido, tira-se do ciclo. Nome único. |
| Níveis do desdobramento | Fixos: CEO → COO → BU, com 100 pontos por unidade. GG e GA ficam fora no primeiro momento. A aba Parâmetros foi descontinuada (D-22): os pontos herdados se editam em Metas e pesos e os limites das regras (mínimo de caracteres, tamanho de anexo) ficam na aplicação. |
| Metas e pesos | Seletor CEO › COO › BU. Por nível: número, título, tipo e orientação, e o peso de cada unidade (`AIP_META.VL_PESO` para CEO e COO; `AIP_META_PESO` para as BUs). A linha "Resultado do nível acima" mostra os pontos herdados e é **editável**: é onde se definem os pontos herdados do COO (do resultado do CEO) e de cada BU (do resultado do COO). A soma de cada unidade (herdado + metas) fica sempre visível com aviso das que não fecham; dá para salvar parcial e terminar depois (RN-16, D-31). |
| Exceções | Aba própria da Administração: o administrador escreve o texto de Exceptions and Considerations, marca os sites (com "Marcar todos") e clica em "Adicionar aos sites marcados". Embaixo, a tabela "Exceção em uso em cada site" mostra o texto de cada um, com olho (aparece ou riscado = oculto), lápis (carrega o texto e o site no formulário) e × (remover). Cada site pode ter um texto diferente. A BU não edita; as exceções próprias da BU são preenchidas por ela no Goal Card. |
| Auditoria | Toda alteração de configuração gera evento no log com valor antes e depois. |

### 7.2 Versões (T06)

Cada submissão, resubmissão ou CR aprovado gera uma versão imutável com todos os campos, status, data, autor e motivo. Rascunho não gera versão. A versão oficial é a última aprovada.

| Item | Regra |
| --- | --- |
| Acesso | Pela linha do tempo do Goal Card (T04), no link "Versões"; endereço `#versoes?card=`. Todos os perfis leem; ninguém altera. |
| Lista | vN, data e hora, autor, motivo (Submissão, Resubmissão, Reabertura, CR) e decisão que recebeu; a versão oficial leva o selo "Oficial". |
| Comparação | Duas versões lado a lado, campo a campo, na ordem das 7 seções; campos alterados destacados e os iguais recolhidos. Por padrão compara a última com a anterior. |
| Uso na aprovação | A T14 abre a mesma comparação para mostrar ao aprovador o que mudou numa resubmissão (RN-10). |

### 7.3 Action Log (T07) e comentários

| Item | Regra |
| --- | --- |
| Timeline | Única e imutável, por card e por ciclo; mais recente primeiro, paginada. É um item do menu (depois de Aprovações) e é lida pelos perfis com acesso ao item (aprovação e administração). |
| Tipos de evento | Submissão, Recolhimento, Decisão, Reabertura, Comentário, Change Request (F2), Evidência (F3), Configuração e Acesso negado. |
| Conteúdo do evento | Quem, papel, quando, BU, meta, seção, detalhe e, nas edições, valor antes e depois. Nunca registra segredos. |
| Comentários | Ancorados a uma seção, com respostas encadeadas; não podem ser editados nem apagados depois de publicados. São feitos na T14 Aprovações; no Goal Card (T04) o campo com comentário mostra um indicador com o número, e o clique abre um pop-up só de leitura com as mensagens. |
| Filtros | BU, Meta, Seção, Tipo e Período (ciclo atual por padrão), guardados na URL; o card do Goal Card leva ao log já filtrado por ele. |
| Exportação | Excel com os filtros aplicados, com os dados de todas as BUs (leitura aberta a todos os perfis, AC-05). |

### 7.4 Notificações

| Evento | Destinatário |
| --- | --- |
| Ciclo aberto | Contribuidores |
| Card submetido ou resubmetido | Grupo de aprovação |
| Aprovado ou devolvido | Contribuidores da BU |
| Novo comentário no card | Contribuidores da BU e grupo de aprovação |

Cada notificação chega por e-mail e no app. O e-mail vai no idioma do destinatário, com assunto `[AIP Goals] <evento>: <BU> · <meta>` e botão que abre a tela; não carrega conteúdo além do título da meta. O serviço de envio deve ser o mesmo do Kaizen (P-03). Se o e-mail falhar, o aviso no app garante a entrega.

## 8. Interface

| Requisito | Definição (padrão `vbm-design`) |
| --- | --- |
| Identidade visual | Blocos das skills copiados, não reescritos: `vbm-tokens.css` e `vbm-componentes.css` (vbm-design) e `setup-dashboards.css`/`.js` (barra e engrenagem). Toda cor sai de um token com par escuro (`:root`, bloco `prefers-color-scheme` e `:root[data-theme="dark"]`); nenhum hex solto na regra. Tokens próprios da aplicação (abertura, vidro, cores de situação do card) ficam no `aip.css`, sempre com o par escuro, e só quando a vbm-design não tem um equivalente. |
| Estrutura de tela | Barra `setup-dashboards` em vidro, no tom do fundo: logo Vale à esquerda, menu da aplicação centralizado e só com texto (inspirado no VBM Kaizen), engrenagem e usuário à direita; a barra continua visível em tela cheia, para trocar de tela pelo menu. Não há menu lateral. Todas as telas ocupam a largura da janela, com margens fluidas, e fontes e objetos se ajustam ao tamanho da tela. Abaixo da barra: topo da tela sobre a foto dos minerais, que começa no alto da tela, por trás da barra (título com o nome em letras vazadas, jornada do ciclo ou linha do tempo, e as ações atualizar e tela cheia no canto superior direito) → `.filters` → painel com os cartões, em cinza suave e borda leve → "Last updated …" → `.toast`. As telas não mostram a pílula "Dados de exemplo". O Início (T00) é uma abertura em tela cheia sobre a foto dos três minerais. |
| Tema, idioma e formato | Só na engrenagem: grava `data-theme` no `<html>` e as chaves `vdt-theme`, `vdt-lang` e `vdt-num`; sem botão de tema nem chave nova. Textos fixos com `data-i18n` (pt-BR e en); números e datas por `VBMSetup.fmt` (Brasil 1.234,56 · Canadá 1,234.56). Conteúdo digitado no card (P-06) e nomes vindos do banco (BU, meta, pessoa) não são traduzidos. |
| Tipografia e ícones | Poppins local, com as faces embutidas (`VBM-Aip-Goals/assets/css/poppins.css`, cópia da do Performance Hub); nada de Google Fonts. Ícones em SVG próprio (sprite inline na página) ou pelo Font Awesome já servido pelo app, em subconjunto local; nunca por CDN. |
| Rede | Corporativa fechada: sem CDN, Google Fonts ou kit; fontes, ícones e scripts locais. |
| Filtros | Padrão COO: rótulo em itálico em cima; `.seg` com `aria-pressed` para poucas opções (Estado, Tipo, Período); `.switch` com `role="switch"` para liga/desliga (ex.: só atrasadas); `.unit` para País › BU e para Ciclo (mais recente primeiro). Estado na URL. |
| Status do Goal Card | Pílula com ícone + rótulo + cor do token de fluxo `--status-*` (mesmo do Kaizen): Rascunho `--status-draft` (cinza), Em aprovação `--status-pending` (âmbar), Em revisão `--status-review` (azul), Aprovado `--status-approved` (verde). Nunca só por cor: nos gráficos compactos a situação vai também na legenda, no `title` e no `aria-label`. `--good` e `--bad` ficam para desempenho nos gráficos; ciclo e prazo usam o âmbar `--wait` (atrasada com `--late-bg`), nunca verde ou vermelho. Na tabela da T03 a pílula leva só o ponto e o rótulo, sem ícone, e o trecho da barra de peso usa a mesma cor `--status-*` do card. |
| Gráficos | SVG próprio, sem biblioteca: anéis de progresso da jornada do ciclo (T02 e T03, mesmo componente e tamanho), barras de composição (T02), barra de peso em cascata (T03), funil e tempo em aprovação em barras; sem pizza. Séries com `--serie-a` / `--serie-b` / `--serie-p`; situação com `--status-*`; deltas, se houver, com `--good` / `--bad` / `--flat`. `NULL` = "sem dado", nunca 0; `role="img"` + `aria-label` com o resumo; redesenho ao trocar filtro, idioma, formato, tema e tamanho; animação só de `transform` e `opacity`. |
| Avisos e salvamento | `.toast` com `role="status" aria-live="polite"` ("Salvo às 14:32"; erro com `.is-err`), em linguagem de negócio. Botão salvar com `.is-pendente` enquanto houver alteração não salva. |
| Perfis na interface | Cada grupo vê só o que pode fazer: ações que o perfil não tem não são desenhadas (não basta desabilitar). **Contribuidores e administrador (T04):** ficha com os campos da BU abertos, placeholder de orientação e obrigatórios marcados com \*; Salvar rascunho e Submeter no rodapé da ficha. **Aprovadores (T14):** fila das fichas em aprovação e painel de decisão com Aprovar (`.btn`), Devolver (`.btn-sec`), confirmação no segundo clique; os botões não usam `--good`/`--bad`, a cor de situação fica só na pílula. **Consulta e demais casos:** ficha em leitura com pílula neutra "Somente leitura" (`--flat`, ícone de cadeado) e o motivo; menu sem Aprovações, Action Log e Administração quando o perfil não tem acesso. |
| Estados de tela | Toda tela trata carregando, vazio, erro, sem permissão e desatualizado ("Last updated …"). |
| Ações irreversíveis | Confirmação no segundo clique, em caixa `role="alertdialog"`, nunca `confirm()`. Mensagens de erro não mostram texto do banco. |
| Acessibilidade | Contraste AA (texto ≥ 4,5:1; texto grande e ícones ≥ 3:1); `--accent` só em texto ≥ 24 px, abaixo disso `--accent-strong`; foco visível com `--focus`; alvos ≥ 32 px (44 px no toque); `aria-label` e `title` em botões só com ícone; `aria-expanded` nos popovers, Esc fecha e devolve o foco. |
| Dispositivos | Notebook e desktop, de 1024 px a 4K; celular fora do escopo (D-07). Raiz fluida (`clamp`), menu em gaveta em janelas de até 1080 px, layout compacto com até 820 px de altura e cards por container query; conferido em 1024, 1180, 1280×590, 1280×800, 1366, 1440, 1920, 2560 e 3840 px e com zoom de 200%, nos dois temas, sem rolagem lateral. |

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

**Modelo de dados (proposta para validação com o time de dados, versão de 19/11/2026)**

DDL testado em PostgreSQL e DER navegável em `database/der/` (`der.html`, `modelo.sql`, `exemplos.sql`). Convenções do Schema IBP (levantamento de 21/10/2026): prefixo `AIP_`, campos ID_, NM_, DS_, DT_ (DT_INI/DT_FIM), NO_, CD_ (CD_MATRICULA), TP_, SG_ em `char(1)` S/N, QTDE_, VL_; restrições `PK_`, `FK_<FILHA>_<PAI>`, `UQ_`, `CK_` e `IX_<TABELA>_FK_<PAI>` em toda FK; a BU é o site da `IBP.SITES` (`ID_SITE`). 9 tabelas do AIP na fase 1, mais a `IBP.SITES` existente:

| Tabela | Conteúdo |
| --- | --- |
| AIP_CICLO | Ano (único), nome, `SG_STATUS` S/N (S = aberto, N = fechado; **só um S**, índice único parcial), ciclo de origem, quem e quando abriu e fechou, datas das 4 etapas da jornada (início e fim de cada etapa; início padrão = fim da anterior), pontos herdados pelo COO e por cada BU (100 pts por unidade) |
| IBP.SITES (existente) | A BU é o site do IBP: `ID_SITE` é o ID da BU em todo o modelo; nome e país vêm de NM_SITE e NM_PAIS |
| AIP_PAPEL | Ciclo, matrícula (dados da pessoa no MDM), grupo (contribuidor, aprovação, consulta, admin), BU (ID_SITE, só contribuidor e consulta), ativo, data da última atualização |
| AIP_CICLO_SITE | Site (BU) no ciclo: participa ou não (`SG_ATIVA`), diretor (`CD_MATRICULA_DIRETOR`, nome no MDM) e exceção do site: texto (`DS_EXCECAO`) e se aparece (`SG_EXCECAO_VER`). Alimenta as telas Business Units e Exceções |
| AIP_META | Ciclo, nível (CEO, COO ou BU), número, peso (`VL_PESO`, só CEO e COO), título, tipo, orientação (`TP_ORIENTACAO`: maior ou menor é melhor), meta de origem (desdobrada de), ativa |
| AIP_META_PESO | Meta da BU, site, peso (um por site) |
| AIP_GOAL_CARD | Código (GC-BU-meta), meta, site, estado, versão oficial, rascunho (o que foi digitado e ainda não submetido, em JSON), quem e quando fez a última mudança |
| AIP_GOAL_CARD_VERSAO | Versão: número, motivo, foto dos campos, autor, data e a decisão do grupo de aprovação (aprovado ou devolvido, comentário obrigatório para devolver, marcação OK/Ajustar de cada seção, quem e quando), gravada uma única vez |
| AIP_EVENTO_LOG | Action Log imutável (gatilho bloqueia UPDATE e DELETE): tipo (inclui abrir, fechar e reabrir ciclo e os comentários do Goal Card, com texto e resposta a), quem, grupo, quando, card, seção, antes, depois |
| AIP_NOTIFICACAO | Evento, destinatário, canal (e-mail ou app), enviado em, lido em |

Saiu a `AIP_UNIDADE` (D-26): o desdobramento usa o próprio site da `IBP.SITES`. Saíram do modelo também: `AIP_PARAMETRO` (limites ficam na aplicação), `AIP_DECISAO`, `AIP_REVISAO_SECAO` e `AIP_COMENTARIO` (revisão enxuta) `AIP_NIVEL` (níveis fixos; pontos herdados no `AIP_CICLO`, nível como código na meta e na unidade) e os níveis GG e GA no primeiro momento. Fases 2 e 3: `AIP_CHANGE_REQUEST` e `AIP_EVIDENCIA`.

## 10. Catálogo de telas

| ID | Tela | Perfis | Conteúdo e ações | Fase |
| --- | --- | --- | --- | --- |
| T00 | Início | Todos | Abertura do ciclo AIP: etapa atual e prazo, data dos Goal Cards oficiais, número de BUs e jornada do ciclo na vertical; o acesso às telas é pelo menu do topo | MVP |
| T02 | Painel do ciclo | Todos | KPIs (submetidos, aprovados %, em aprovação, em revisão); matriz BU × status; funil; tempo em aprovação; filtro País › BU | MVP |
| T03 | AIP BU's | Todos | Metas com peso, tipo, status, contribuidor, versão e última atualização; soma de pesos; Goal Card em popup | MVP |
| T04 | Goal Card | Todos | Ficha de cadastro da meta pelos contribuidores e pelo administrador (D-16), em tela própria ou em popup aberto pela T03: campos obrigatórios marcados, Salvar rascunho e Submeter; comentários do grupo de aprovação em pop-up por campo; linha do tempo do card; leitura para os demais (sem decisão nesta tela) | MVP |
| T06 | Versões | Todos | Aberta pelo link "Versões" da linha do tempo do Goal Card: lista das versões do card (vN, data, autor, motivo e decisão) com a oficial marcada; comparação de duas versões lado a lado, campo a campo, com as diferenças destacadas; só leitura (§7.2) | MVP |
| T07 | Action Log | Todos | Item do menu: linha do tempo única e imutável do ciclo (submissões, recolhimentos, decisões, reaberturas, comentários, configuração e acessos negados), cada evento com quem, papel, quando, BU, meta, seção e antes/depois; filtros BU, Meta, Seção, Tipo e Período na URL; exportar Excel com os filtros aplicados (§7.3) | MVP |
| T09 | Change Requests | Contribuidores, aprovadores | Abrir CR; decidir com atual × proposto lado a lado | F2 |
| T10 | Evidências | Contribuidores, aprovadores | Upload por meta; aceitar ou devolver | F3 |
| T11 | Administração (configuração do ciclo) | Admin | Item do menu (só o administrador), em abas: Ciclo (lista de ciclos, um aberto por vez, fechar, reabrir e abrir novo ciclo com ano maior que o atual e datas das janelas escolhidas no diálogo (ano atual ou seguinte, D-32); nome, janelas e textos padrão), Business Units (criar, com o diretor (hierarquia N4 do MDM) buscado sozinho e editável, editar, tirar do ciclo e excluir BU sem Goal Card submetido), Grupos (seções por grupo e BU, popup de cadastro com busca no MDM), Metas e pesos (CEO, COO e BU, herdado editável, soma por unidade e aviso das unidades que não fecham, gravação permitida mesmo parcial, RN-16) e Exceções (texto por site, com olho); toda alteração vai ao Action Log com antes e depois (§7.1) | MVP |
| T12 | Sem acesso / não encontrado | — | Mensagem neutra, sem revelar dados | MVP |
| T14 | Aprovações | Só o grupo de aprovação | Fila com todas as fichas Em aprovação (filtro País › BU, idade); abre a ficha com revisão OK/Ajustar por seção, comentários por seção e decisão Aprovar ou Devolver (RN-06, RN-08, RN-12); o lápis de Exceções só existe quando a BU cadastrou exceção (o texto padrão da administração não recebe comentário) | MVP |

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
| CA-11 | Metas e pesos com soma acima do total não grava nem aceita o valor digitado; com soma abaixo do total grava e a tela avisa a unidade que não fecha (D-31, D-33) | RN-16 |
| CA-13 | Todo comentário, decisão, reabertura e mudança de configuração aparece no log, filtrável e exportável em Excel | §7.3 |
| CA-20 | A T06 compara duas versões quaisquer do card campo a campo e marca a versão oficial; nenhuma versão pode ser alterada | §7.2 |
| CA-19 | Só o grupo de aprovação acessa a T14: para os demais perfis o item não aparece no menu e a API responde 403 | AC-08 |
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

**Ordem técnica recomendada** (dependências, sem datas): esquema do banco e parâmetros; perfis e autorização no servidor; configuração do ciclo (T11); Goal Card com campos obrigatórios e versões; aprovação em nível único com revisão por seção; Action Log e comentários; notificações no app e por e-mail; fila de aprovação (T14) e painel do ciclo; testes de permissão, estados e idempotência; depois, Change Request (F2) e Evidências (F3).

## 13. Telas desenvolvidas

As oito telas do MVP estão prontas no protótipo (T00 Início, T02 Painel do ciclo, T03 AIP BU's, T04 Goal Card, T06 Versões, T07 Action Log, T11 Configuração do ciclo e T14 Aprovações), além da visão COO AIP, segundo item do menu. Todas usam dados de exemplo até a validação do modelo de dados (P-12).

| Tela | Situação | O que já funciona | Depende de |
| --- | --- | --- | --- |
| T00 Início | Desenvolvida | Abertura do ciclo AIP 2027: etapa atual e prazo, data dos Goal Cards oficiais, número de BUs e jornada do ciclo na vertical, em vidro, com a etapa atual (no lugar do antigo índice de telas) | Janelas e BUs reais (T11, P-12) |
| COO AIP | Desenvolvida | Visão executiva CEO → COO → BUs: scorecard do COO em cards com a barra dos 100% (paleta executiva em degradê) e a situação dos cards por BU; matriz meta × BU com peso e situação do Goal Card; o clique numa célula abre o Goal Card daquela BU em popup, só com a meta clicada (sem seletor nem setas para trocar de meta), em leitura ou em edição conforme a permissão do usuário (contribuidor da BU ou administrador, em Rascunho ou Devolvido); no popup, Versões e Histórico trocam o conteúdo do mesmo popup, com o botão "← Goal Card" para voltar; segundo item do menu. Fica fora do catálogo de telas porque os dados de cada BU estão na T03 | Desdobramento real (T11, P-12) |
| T02 Painel do ciclo | Desenvolvida | Só para P&CI/COO e administrador; título Ciclo AIP 2027 e jornada do ciclo com um anel por etapa (% do total, prazo e quantitativo, como "27 de 41"), matriz BU × situação com barra de composição, funil, tempo em aprovação com o limite da RN-14, cards parados há mais tempo e filtro País › BU na URL; contagens calculadas da mesma lista de cards (CA-15) | Goal Cards reais por BU (P-12) |
| T03 AIP BU's | Desenvolvida | Metas de uma BU no recorte do usuário (AC-04/AC-05, fora do recorte → 404); jornada do ciclo igual à da T02 (Desdobramento COO, Propostas BU's, Calibração e Aprovação, Goal Card oficial; mesmo tamanho, linha até hoje e prazos), com os Goal Cards da BU em cada etapa (ex.: 6 de 10); alerta da soma dos pesos (RN-16); tabela com barra de peso curta em cascata (cada meta começa onde a anterior termina e todas somam o total), Status do fluxo de aprovação (sem o aviso de parada), Contribuidor responsável, Versão centralizada e Última atualização; o botão Abrir mostra o Goal Card num popup grande, editável para quem pode editar (Ctrl+clique abre a tela inteira); BU na URL | Metas e pesos reais por BU (P-12) |
| T04 Goal Card | Desenvolvida | Ficha de cadastro da meta pelos contribuidores da BU e pelo administrador, em qualquer BU (Rascunho e Em revisão, D-16); abre em tela própria ou no popup da T03 e da COO AIP, onde o card mantém o mesmo modelo e só ajusta a escala à altura da tela, sem barra de rolagem (mínimo de 50%); leitura para os demais, com o motivo no rodapé; ficha única no modelo VBM "CARD" com seletor das metas da BU na mesma página; pílula de modo (Edição ou Somente leitura) no canto direito da linha do título; links Versões e Histórico, que no popup abrem dentro do mesmo popup; campos do desdobramento e texto padrão do ciclo com cadeado; campos da BU com placeholder, \* de obrigatório e borda âmbar enquanto vazios; fórmula de cálculo em uma linha; régua Mín./Meta/Exc. e direção da meta; Salvar rascunho e Submeter (bloqueado sem os obrigatórios, cliente e servidor) no rodapé; comentários em pop-up só de leitura; linha do tempo do card; sem decisão nem painel lateral; escritas validadas e simuladas | Gravação real (P-12) |
| T12 Sem acesso | Parcial | Mesmo padrão da tela "Acesso não autorizado" do Portal PCI: cartão central em vidro sobre a foto dos minerais, cadeado em quadrado vermelho suave, título "Acesso não autorizado", mensagem única e neutra (não revela se o card existe) e botões Voltar e ação principal (Início ou AIP BU's), com foco no título; aparece na COO AIP, na T02, na T03 e na T04 quando a API responde 401, 403 ou 404, e o resto da tela sai de cena | Evento "Acesso negado" no log e sem acesso ao ciclo pelo Início (AC-03) |
| T06 Versões | Desenvolvida | Aberta pelos links "Versões" do Goal Card e do Action Log. Linha das versões (v1 → v2) com motivo, autor, data, decisão e selo da oficial; comparação de duas versões (de/para, inverter, endereço `#versoes?card=&de=&para=`), campo a campo nas 7 seções, alterados em destaque e iguais recolhidos ("Só o que mudou"), com a marca das seções em que o grupo pediu ajuste; versão única mostrada inteira; rascunho explica que a v1 nasce na primeira submissão; seletor das metas da BU | Versões gravadas (P-12) |
| T07 Action Log | Desenvolvida | Todos os perfis com papel leem. Topo só com o título (sem o ano nem cartões de resumo); filtros Período (7 dias, 30 dias, ciclo), BU, Meta, Seção, Tipo e Goal Card, na URL; linha do tempo agrupada por dia, com hora, ponto colorido pelo tipo (decisão pela cor do resultado), frase traduzível, comentário citado, antes → depois e etiquetas que viram filtro; links para o Goal Card e as Versões; 40 eventos por página com "Mostrar mais"; exportação CSV (abre no Excel) com os filtros aplicados; registro imutável | Eventos reais (AIP_EVENTO_LOG, P-12) |
| T11 Administração | Desenvolvida | Só o administrador (403 → T12). Título "Administração" e abas na URL. Ciclo: lista de ciclos no campo Ano, situação Aberto/Fechado, botões Fechar, Reabrir e Abrir novo ciclo (diálogo com o ano, maior que o atual, e as datas das 4 janelas em branco para preencher, D-32) no cabeçalho da seção (um ciclo aberto por vez), janelas desativadas em ciclo fechado, cards com a mesma altura. Business Units: nova BU, editar, tirar do ciclo, excluir só sem Goal Card submetido. Grupos: seções Aprovação, Administradores e por BU com cards de pessoa; popup Novo usuário com busca no diretório (MDM) por nome ou e-mail. Metas e pesos: CEO › COO › BU, linha herdada editável, nova meta e remoção, total por unidade com aviso, gravação parcial permitida (RN-16). Rodapé fixo com o que mudou e o que impede gravar | Gravação real, MDM real e evento no log (P-12) |
| T14 Aprovações | Desenvolvida | Item do menu, só para o grupo de aprovação e o administrador (AC-08; demais perfis: item fora do menu e API 403 → T12). Filtros País › BU e tempo na fila (qualquer, 3+ ou 5+ dias úteis) na URL; fila das fichas Em aprovação, das mais antigas para as mais novas, com idade em dias úteis, etiqueta de resubmissão e "Você editou" (RN-12); análise da ficha com links para Goal Card, Versões e histórico; nas resubmissões, seções alteradas destacadas com o antes da versão anterior (RN-10); revisão OK/Ajustar por seção com progresso; ficha em coluna única, no mesmo desenho do Goal Card; lápis por item com comentário obrigatório (o de Exceções só quando a BU tem exceção) e balão com os comentários em popup (RN-13); decisão Aprovar ou Devolver com comentário e confirmação no segundo clique (RN-08); reabrir card aprovado só pelo administrador (RN-17), validada no cliente e no servidor; quem editou ou submeteu não vê a decisão (RN-12); depois da decisão, o card sai da fila e abre a próxima ficha ("3 restantes"), com a fila vazia, "Fila concluída" | Decisão, comentários e notificações gravados (P-12, P-03) |
| T09, T10 | Não iniciadas | — | Fases 2 e 3 |

**Descontinuadas (D-20):** T05 Visão do Goal Card e T08 Ações saíram do catálogo, do menu e do modelo de dados; o endereço antigo `#acoes` volta ao Início.

**Dados atuais (D-34):** como a ferramenta é colaborativa, cada navegação entre telas busca o dado novo em segundo plano (a tela mostra o que já tem e troca quando chega, sem aviso nem piscar); gravações com sucesso invalidam o que a tela guardou e atualizam a tela aberta; voltar à aba do navegador atualiza no máximo a cada 30 s; falha ao atualizar em segundo plano mantém o que está na tela; a Administração não sobrescreve edições sem salvar. Goal Card e Versões em edição não são trocados.

Comum às telas prontas: barra em vidro com menu no topo (visível também em tela cheia), largura total da janela com fontes e objetos fluidos, foto do topo desde o alto da tela, atualizar e tela cheia no canto superior direito, tema claro e escuro e idioma pt-BR/en pela engrenagem, tokens `vbm-design` e escopo notebook e desktop (§8). **Ajuste pendente no protótipo:** os dados de exemplo e a tela T02 (funil e tempo por nível) ainda mostram dois níveis (Diretor da BU e P&CI/COO) e os papéis antigos; passam a nível único e aos grupos contribuidores, aprovadores e consulta na próxima entrega. **Ajuste pendente pelas regras de 17/11:** leitura aberta a todos (hoje a API filtra por BU e o Painel é só do P&CI/COO), sem o alerta de pendência parada (antiga RN-14) e sem o alerta de soma dos pesos na T03 (RN-16 passa a ser validação na gravação). Código em `VBM-Aip-Goals/` (raiz do portal-pci, PR #94), API em `/VBM-Aip-Goals/api` (`/inicio`, `/painel`, `/metas`, `/desdobramento`, `/goal-card`, `/versoes`, `/aprovacoes`, `/action-log` e `/configuracao`), documentação em `docs/projetos/aip-goals.md`.
