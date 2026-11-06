# VBM Lean Six Sigma

Portfólio dos projetos Green Belt do programa Lean Six Sigma: status, etapas DMAIC, ciclos, timeline
de coaching, calendário de sessões, treinamentos e a tabela de projetos. É o `LSS_3.pbix` (feito em
HTML Content no Power BI) refeito no design dos dashboards do Portal.

- **Endereço:** `/VBM-Performance-Hub/VBM-Lean-Six-Sigma/`
- **Código:** `VBM-Performance-Hub/VBM-Lean-Six-Sigma/`
- **Acesso:** regra do Portal (`IBP.USERS` com `CD_MATRICULA`), como todo o Performance Hub
- **Stack:** Node/Express (`lss-api.js`) lendo Excel com ExcelJS por streaming; tela HTML/CSS/JS sem
  biblioteca de gráficos
- **Contrato comum do Hub:** [performance-hub.md](performance-hub.md)

## Dados: planilhas, sem banco

Os dados não estão em banco. Vêm das duas planilhas que alimentavam o `.pbix`, **versionadas** em
`data/`:

| Arquivo (padrão do nome) | Abas lidas | Uso |
|---|---|---|
| `*Training*Tracker*.xlsx` | `Portfolio` | projetos: site, status, ciclo, etapa, datas, certificação, apuração |
| | `Comentario Geral Power BI` | insights gerais (PT e EN), por mês |
| | `Comentário por BU` | insights por BU, por mês |
| `*Coach*Manager*.xls[xm]` | `Calendário por Projeto` | coaching por projeto: sessões realizadas, faltas e previstas, aderência, início, entregas DMAIC e conclusão prevista |
| | `Historico` | sessões realizadas, faltas do belt e adiamentos, com data |

- **Atualizar os dados:** substituir o arquivo em `data/` (o nome pode mudar, desde que case com o
  padrão) e publicar. Com mais de um arquivo para o mesmo padrão, vale o modificado por último.
  `LSS_PASTA_DADOS` aponta para outra pasta, se precisar.
- **Mesmas transformações do Power Query:**
  - o cabeçalho do Portfolio é achado pela linha que tem `Project`, `Site`, `Status Detail` e `Etapa`;
  - só entram linhas com Site;
  - `2025 Cycle Online` vira `2025 Cycle`;
  - `Delayed 2025 cycle` vira `Delayed 2025`.
- **Fórmulas:** as células com fórmula usam o valor gravado na planilha. O Excel precisa ter sido
  salvo com o cálculo em dia.
- **"Atualizado em":** a data mostrada no topo vem de dentro do próprio Excel (`docProps/core.xml`),
  não do arquivo no disco, que muda a cada deploy.
- **Cache:** o resultado fica em memória até um dos arquivos mudar (tamanho ou data). As planilhas
  são lidas já na subida, em cerca de 1 s.
- **Proteção:** `data/` não pode ser baixado pelo navegador. Da pasta, só `index.html` e `assets/` são
  públicos.

## API (`/VBM-Performance-Hub/VBM-Lean-Six-Sigma/api`)

| Rota | O que faz |
|---|---|
| `GET /ping` | diagnóstico sem ler as planilhas |
| `GET /health` | as duas planilhas existem e são lidas (503 se não) |
| `GET /dados` | projetos, comentários gerais e por BU, calendário de coaching, histórico de sessões e os nomes e datas dos arquivos (503 `SEM_PLANILHA` se faltar arquivo) |

Os cálculos das medidas ficam no navegador (`assets/js/lss.js`), uma função por visual, com o nome da
medida DAX de origem no comentário.

## Páginas

| Página | Visuais (medida DAX de origem) |
|---|---|
| **Visão geral** | 5 cartões: projetos, em andamento (In progress + Delayed, barra dividida), concluídos, atrasados e cancelados (`Card_HTML_*`); em andamento por etapa (`Grafico_Etapas`); em andamento por site, no prazo × atrasado (`Grafico_Projetos_Site`); concluídos por site (`Grafico_Projetos_Site_Concluidos`) |
| **Projetos em detalhe** | ciclo × site (`Grafico_Cycle_Site`); insights (`Card_HTML_Insights`); status por site: VBM, Salobo, Sossego, Onça Puma, Voisey's Bay, Long Harbour, Clydach, Ontario e Corporate (`Grid` / `Grafico_Status_<site>`) |
| **Por Business Unit** | distribuição do status (`Grafico_Status`); matriz status × etapa (`Matrix_Status_Etapa_HTML`); timeline (`Grafico_Gantt_Projetos`); insights da BU (`Card_HTML_By_BU_Insights`) |
| **Timeline e coaching** | Gantt com as trilhas real e planejada (`Grafico_Gantt_Projetos_2`) |
| **Calendário de coaching** | sessões previstas por projeto e mês (`Calendario_Sessoes_Projetos`) |
| **Treinamentos** | quantidade de treinamentos (`Card_HTML_Treinamentos`) e certificação por site |
| **Tabela** | gestão de projetos com busca e ordenação (`Tabela_HTML_Projetos`) |

- **Filtros** no padrão do COO: Site, Status, Ciclo e Etapa, mais Restaurar padrão e tela cheia. Ficam
  na URL junto com a página (`?aba=gantt&site=Sossego`), então o link pode ser compartilhado.
- **Gantt e Calendário:** respondem só ao Site, como no `.pbix`, porque a planilha de coaching não tem
  status, ciclo nem etapa.
- **Cartões por site** (Projetos em detalhe): não usam o filtro de site, porque cada cartão já é um site.
- **Idioma:** PT e EN pela engrenagem (o slicer "Idioma" do `.pbix`).

### Regras do Gantt (`Grafico_Gantt_Projetos_2`)

- **Modelo do projeto:** 8 sessões (quando "Sessões Previstas" = 8) ou 15, a cada 15 dias a partir do
  início.
- **Fim planejado:** "Conclusão Prevista"; sem ela, início + 150 dias (8 sessões) ou + 255 dias (15).
- **Sessões do Historico:** "Realizada" e "Belt faltou" são mapeadas para o número da sessão pelo código
  (`D1`, `M2`…). Uma sessão que não existe no modelo de 8 cai na última sessão da mesma fase. Sem
  nenhuma "Realizada", valem as N primeiras sessões (N = Sessões Realizadas).
- **Trilha real:** 15 dias por sessão realizada. Uma falta não reposta vira lacuna com um anel vermelho;
  uma sessão reposta ganha um ponto vermelho.
- **Trilha planejada:** as etapas pelas datas de entrega da planilha (ou início + 15 dias × sessão). As
  sessões futuras são anéis, e as já agendadas no mês ganham destaque.
- **Dica do projeto:** fase atual, etapa da 1ª falta, etapa prevista para hoje, início, fim planejado e
  coaching (realizadas | faltas | previstas | aderência acumulada).
- **Ordem:** atrasados primeiro, depois "a iniciar", depois os demais por data de início.

### Paletas

| O quê | Cores |
|---|---|
| Status do projeto | em andamento = azul Vale, concluído = verde-azulado, atrasado = vermelho (o único alerta), cancelado = cinza, a iniciar = hachurado |
| Fases DMAIC (Gantt, calendário, etapas) | rampa sequencial de azuis, D (claro) → F (azul-marinho); invertida no tema escuro, com a cor da letra por fase |
| Sites | categórica em azuis, verde-azulados e cinzas (a do `.pbix`, ajustada), com âmbar para o Corporate |

## Diferenças em relação ao `.pbix`

- **Insights:** o `.pbix` mostra só os comentários do mês de hoje, e como a planilha só tem
  comentários de agosto de 2026, o card estaria vazio. A tela mostra o mês mais recente com
  comentários e permite escolher os anteriores.
- **Nomes de BU e unidade:** `LH`, `CNR` e `Corporate` casam com Long Harbour, Clydach e Asset
  Management. No `.pbix` eles não casavam com o slicer de site.
- **Calendário:** usa o modelo de 8 ou 15 sessões de cada projeto, como o Gantt; o `.pbix` usava sempre
  15. A grade é por mês, não por dia: no `.pbix` cada dia era uma coluna.
- **Treinamentos:** a medida `Grafico_Treinamentos` citada no layout não existe no modelo do `.pbix`.
  No lugar, a página mostra a certificação por site (Certified Green Belts × Green Belt in Training).
- **Matriz status × etapa:** casa a etapa pelo número (`4-Improve` cai em "I"). No `.pbix`, a coluna
  "I" procurava `4-Implementation`.

## Arquivos

```
VBM-Lean-Six-Sigma/
├── index.html              tela (setup-dashboards + hero + filtros + 7 páginas)
├── assets/css/lss.css      estilos (base do Dashboard do Stable & Capable + componentes do LSS)
├── assets/js/lss.js        cálculos e desenho de todos os visuais
├── assets/css|js/setup-dashboards.*   barra superior e Configurações (skill)
├── lss-api.js              leitura e normalização das planilhas, rotas /ping e /dados
├── portal.js               montagem no Hub (/api, /api/health, bloqueio de data/ e do código)
├── server.js               standalone, só para desenvolvimento (sem o controle de acesso)
├── data/                   as duas planilhas
└── tests/lss-api.test.js   node --test com as planilhas reais
```

## Desenvolvimento e testes

- `node server.js` na pasta sobe a tela em `http://localhost:8000/`, sem banco e sem o controle de acesso.
- `npm test`: os testes leem as planilhas reais e conferem:
  - as regras do Power Query;
  - o cache;
  - o 503 sem planilha;
  - a busca do cabeçalho;
  - os valores de fórmula.
- Os números da tela foram conferidos com um cálculo independente direto das planilhas:
  - cartões;
  - etapas;
  - sites;
  - ciclos;
  - matriz status × etapa.

## Pontos de atenção

- As planilhas têm nomes e e-mails de pessoas e ficam versionadas no repositório (decisão do negócio,
  porque os dados não estão em banco).
- Atualizar os dados exige um deploy.
- No celular, a matriz, o Gantt e o calendário rolam para o lado dentro do card.
