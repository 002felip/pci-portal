# Levantamento de requisitos — AIP Goals

> Cópia em Markdown do documento "AIP Goals — Especificação funcional e levantamento de requisitos" (aba Levantamento de requisitos), atualizada em 18/11/2026.

Versão 1 · 16 de nov de 2026 · Cristian · Tipo de projeto: app de fluxo/aprovação + painel de acompanhamento

Registro do levantamento que originou a [Especificação Técnica v1](ESPECIFICACAO-TECNICA.md). As regras detalhadas, telas e critérios de aceite estão na especificação; aqui ficam o contexto, a prontidão, as decisões e o que falta decidir.

Status usados: Decidido (confirmado pelo solicitante), A confirmar (padrão portal-pci ou inferido do material) e Pendente (depende de decisão de terceiros).

## 1. Contexto

Hoje as metas de AIP das BUs de VBM (Brasil, Canadá e International Refineries) são definidas em PPT e e-mail, sem versão oficial, sem trilha de aprovação e sem visão consolidada do ciclo. O AIP Goals cobre as etapas 3 a 5 do processo (proposta da BU, calibração e aprovação, Goal Card final) e registra o resultado do desdobramento do COO.

| Item | Resposta | Status |
| --- | --- | --- |
| Usuários | Três grupos — contribuidores (por BU), aprovadores (grupo de aprovação P&CI/COO) e consulta — mais o administrador do ciclo | Decidido |
| BUs do ciclo | Nomes dos sites do COO Dashboard: Onça Puma, Salobo e Sossego (Brasil); Ontario e VNL (Canadá); Clydach e Matsusaka (International Refineries) (cadastro editável) | Decidido |
| Indicador de sucesso | 100% dos Goal Cards do ciclo aprovados no app, sem PPT paralelo | A confirmar |
| Fases | MVP na definição de metas; Change Request e Evidências em Q2–Q4 | Decidido |

## 2. Prontidão para desenvolvimento

| Item | Status | Observação |
| --- | --- | --- |
| Objetivo, dono do produto e escopo do MVP | A confirmar | Escopo definido; dono do produto a nomear (P-10) |
| Perfis, fonte do perfil e recorte de dados | Decidido | Todos veem todas as BUs; a edição cabe aos contribuidores da própria BU, conforme o cadastro no banco (D-11) |
| Entidades, estados e transições | Decidido | Especificação, seções 3 e 4 |
| Regras críticas | Decidido | Aprovação em nível único pelo grupo de aprovação (D-09) |
| Lista de telas do MVP | Decidido | Especificação, seções 10 e 13: T00, T02, T03, T04, T06, T07, T11, T12 e T14; T00, T02, T03, T04, T06, T07 e T11 desenvolvidas; T05 e T08 descontinuadas (D-20) |
| Fontes de dados confirmadas com o dono | Pendente | Modelo de dados a validar com o time de dados (P-12) |
| Critérios de aceite | A confirmar | Especificação, seção 11; validar com P&CI |

**Conclusão:** pronto para iniciar o desenvolvimento. A rota de aprovação está fechada (nível único, D-09); P-12 precisa ser fechado antes de implementar o banco; o envio de e-mail (P-03) não bloqueia, porque as notificações no app cobrem o fluxo.

## 3. Decisões registradas

| ID | Decisão | Data |
| --- | --- | --- |
| P-01 | Aprovação final por um grupo único de acesso P&CI/COO; qualquer membro decide | 16/11/2026 |
| P-02 | Pontos focais e diretores veem apenas a própria BU; o P&CI e o grupo cadastrado com ele (P&CI/COO) veem todas as metas de todas as BUs. Visão entre BUs para pontos focais e diretores vai para o backlog | 16/11/2026 |
| D-01 | Minhas pendências como tela inicial, revisão por seção, campos obrigatórios, comparação de versões e alertas de pendência parada | 16/11/2026 |
| D-02 | Campos obrigatórios do Goal Card, fluxo Aprovar / Devolver / Negar, versão a cada submissão, Action Log com histórico de alterações e comentários | 16/11/2026 |
| D-03 | Interface em português e inglês; acesso restrito a pontos focais, diretores e aprovadores | 16/11/2026 |
| D-04 | Aplicação na pasta VBM-Aip-Goals, na raiz do portal-pci (fora do Performance Hub), em HTML e JavaScript com servidor Node, no padrão das demais aplicações | 16/11/2026 |
| D-05 | Identidade vbm-design; menu no topo, centralizado e só com texto (inspirado no Kaizen), barra em vidro no tom do fundo, sem menu lateral e sem bordas laterais nos cartões | 16/11/2026 |
| D-06 | Tela de entrada T00 Início com os dados do ciclo AIP 2027 (etapa, prazos, número de BUs e jornada do ciclo na vertical), sem pendências pessoais e sem índice de telas (acesso pelo menu do topo); foto dos três minerais, clara no tema claro | 16/11/2026 |
| D-07 | Uso em notebook e desktop (1024 px a 4K); celular fora do escopo | 16/11/2026 |
| D-09 | Aprovação em nível único, feita por um grupo de usuários (grupo de aprovação P&CI/COO): qualquer membro aprova, devolve ou nega, e a decisão é final. Não há nível do Diretor da BU (encerra a P-11) | 17/11/2026 |
| D-10 | Três grupos de acesso: contribuidores (preenchem e submetem os Goal Cards da BU), aprovadores (decidem) e consulta (só leitura); o administrador do ciclo configura os grupos | 17/11/2026 |
| D-11 | Todos os usuários visualizam todos os dados de todas as BUs; a edição cabe só aos contribuidores da própria BU, conforme o cadastro no banco de dados (substitui o recorte de leitura da P-02 e encerra a P-13) | 17/11/2026 |
| D-12 | Regras ajustadas: sem alerta de pendência parada (RN-14 retirada); soma dos pesos garantida pelo sistema, sem diferença possível (RN-16); card Aprovado pode ser reaberto dentro da janela inicial do ciclo e, depois, só via Change Request (RN-17) | 17/11/2026 |
| D-13 | O Goal Card (T04) é a ficha de cadastro dos contribuidores, sem decisão; a aprovação acontece numa tela própria (T14 Aprovações) com todas as fichas em aprovação; no Goal Card, os comentários aparecem em pop-up só de leitura | 17/11/2026 |
| D-14 | Retirada a tela T01 Minhas pendências (substitui a tela inicial da D-01): as decisões ficam na T14 Aprovações, exclusiva do grupo de aprovação; os contribuidores entram pela T03 Metas da BU e pelos avisos | 17/11/2026 |
| D-15 | Nomes das BUs iguais aos sites do COO Dashboard: Onça Puma, Salobo e Sossego (Brasil); Ontario e VNL (Canadá); Clydach e Matsusaka (International Refineries); as antigas siglas ON, VNL, UK, JPN e OP deixam de ser usadas | 17/11/2026 |
| D-16 | O administrador edita os Goal Cards de todas as BUs, com as mesmas regras de situação dos contribuidores (só Rascunho ou Devolvido para ajuste); quem edita um card não o decide (RN-12) | 17/11/2026 |
| D-17 | Todas as telas ocupam a largura da janela, com fontes e objetos que se ajustam ao tamanho da tela; a foto do topo começa no alto da tela, atualizar e tela cheia ficam no canto superior direito, a pílula "Dados de exemplo" sai das telas e, em tela cheia, a barra com o menu continua visível | 17/11/2026 |
| D-18 | T03 Metas da BU: jornada do ciclo igual à do Painel, na visão da BU; tabela com barra de peso em cascata na cor do status, Status sem aviso de parada e sem ícone, Contribuidor, Versão, Última atualização e colunas centralizadas; o botão Abrir mostra o Goal Card num popup grande, editável para quem pode editar | 18/11/2026 |
| D-19 | Navegação: menu na ordem Início, Desdobramento, Painel do ciclo, Metas da BU e Administração; Administração é um submenu com Aprovações, Action Log e Configuração (Ações saiu com a D-20) | 18/11/2026 |
| D-20 | Descontinuadas a T05 Visão do Goal Card (impressão e PDF) e a T08 Ações (tarefas com responsável e prazo a partir de comentários), por acrescentarem complexidade sem ganho para o processo. O Goal Card oficial é consultado na T04 em leitura e o histórico na T06; os comentários do grupo de aprovação orientam o ajuste no fluxo Devolver → Resubmeter e ficam no Action Log. Saem também a tabela AIP_ACAO, as notificações de ação e os critérios CA-12 e CA-14 | 18/11/2026 |
| D-21 | Configuração do ciclo: ano editável; cadastro completo de BU (criar, editar, tirar do ciclo e excluir só sem Goal Card submetido), sempre para o ciclo aberto que está sendo configurado; desdobramento de pontos em níveis CEO → COO → BU → GG → GA, com total e herdado por nível nos Parâmetros e metas e pesos por nível; sem o histórico de últimas alterações na tela | 18/11/2026 |

## 4. Suposições a confirmar

| Suposição | Base |
| --- | --- |
| Metas e pesos são cadastrados pelo administrador a partir do desdobramento do COO; a BU só preenche o card | Processo descrito no material |
| Qualquer resubmissão volta para a fila do grupo de aprovação | Regra do material, ajustada ao nível único |
| Card Aprovado reabre na janela inicial do ciclo; depois, só via Change Request | Regra do material, ajustada (D-12) |
| Exceções padrão definidas pelo administrador e não editáveis pela BU | Material (exceções pré-preenchidas) |
| Stack, banco, variáveis (prefixo AIPGOALS_), localização (pasta VBM-Aip-Goals na raiz do portal-pci), identidade visual e cores de status | Padrão portal-pci (skill vbm-design; Especificação, seções 8 e 9) |
| Piloto com uma BU por país antes de abrir para todas | Padrão de governança portal-pci |

## 5. Pendências e decisões em aberto

| ID | Decisão | Opções | Quem decide | Bloqueia? |
| --- | --- | --- | --- | --- |
| P-12 | Modelo de dados | Validar a proposta da especificação | Time de dados | Sim, para o banco |
| P-03 | Serviço de envio de e-mail | Mesma solução do Kaizen (provável) / outra homologada | TI + P&CI | Não |
| P-04 | BU pode propor meta fora do desdobramento? | Não / sim, com aprovação do P&CI | P&CI + COO | Não |
| P-05 | Nomes oficiais dos estados (Em revisão × Em análise) | Conforme a especificação, seção 4 | P&CI | Não |
| P-06 | Conteúdo do card em um ou dois idiomas | Um idioma por card / bilíngue obrigatório | P&CI | Não |
| P-07 | Janela de Change Request | Fixa no ciclo / a qualquer momento | P&CI + RH | Não (F2) |
| P-08 | Retenção de evidências e dados do ciclo | Anos de retenção | P&CI + Jurídico/RH | Não (F3) |
| P-09 | Aprovação local da CEO-2 | Não incluir (nível único, D-09) / tratar fora do app | P&CI + COO | Não |
| P-10 | Dono do produto e sustentação | Nome e área | P&CI | Não |

## 6. Próximas perguntas

| Pergunta | Destrava |
| --- | --- |
| Quem reabre o card Aprovado na janela inicial: o grupo de aprovação, o administrador ou ambos? | D-12 |
| O time de dados valida o modelo proposto ou indica ajustes? | P-12 |
| Haverá aprovação local da CEO-2 antes do envio? | P-09 |
| Quais BUs, pessoas e pesos entram no piloto, e quem é o dono do produto? | P-10 |
