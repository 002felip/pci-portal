# VBM - Stable & Capable

Gera os relatórios PDF de **estabilidade e capabilidade (SPC)** por Business Unit, para o período que a pessoa escolhe na tela.
Endereço: `/VBM-Stable-and-Capable/`, aplicação da raiz do Portal (card na página inicial, ao lado do VBM-Kaizen-App e do VBM-Performance-Hub).
Montada pelo `server.js` da raiz, depois do controle de acesso do Portal (IBP.USERS com CD_MATRICULA).

## Como funciona

```
Tela (index.html)
  │  data início, data fim, BUs
  ▼
POST api/execucoes ── stable-capable-api.js
  1. consulta   database/query_stable_and_capable.sql  (banco do Kaizen)
                as datas do WHERE viram @dtInicio / @dtFim
  2. entrada    resultado gravado como Stable.xlsx (aba "base") — o mesmo arquivo de antes
  3. PDFs       python/scripts/generate_multi_kpi_report.py, uma BU por vez
  4. Blob       <AZURE_STORAGE_CONTAINER>/01 - Imagens/Stable & Capable/<id>/
                  <BU>_<início>_<fim>.pdf · Stable_<início>_<fim>.xlsx · execucao.log
                e o histórico em .../Stable & Capable/execucoes.json
```

- **Uma execução por vez** (uma segunda recebe 409 e a tela mostra a que está rodando). Leva ~30 s por BU.
- Uma BU com erro **não interrompe** as outras; o status fica "Concluída com erros" e o motivo aparece na linha da BU.
- O **SAS do Blob não vai para o navegador**: os downloads passam por `api/execucoes/:id/arquivos/:nome`.
- O histórico fica num JSON no Blob porque o SAS atual (`sp=racw`) não tem permissão de **listar**.

## Fluxo mensal

Antes: editar a data fim da query, exportar o `Stable.xlsx` e rodar o script.
Agora: abrir a tela, que já vem com **1º de janeiro do ano anterior → último dia do mês anterior** (o atalho "Fechamento mensal"), e clicar em **Gerar relatórios**.

Qualquer intervalo de até 10 anos funciona. Os gráficos mostram os anos do intervalo (`--years` e `--reference-year` passados ao gerador). Antes, o gerador usava o ano do relógio e cortava períodos passados.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Tela (mesmo topo, fundo, tema e idioma do Hub) |
| `portal.js` | Monta a aplicação no Portal (chamado pelo `server.js` da raiz): pool SQL próprio, Blob do Kaizen, bloqueio dos arquivos internos |
| `stable-capable-api.js` | Rotas e execução (consulta → Excel → Python → Blob) |
| `server.js` | App standalone para desenvolvimento/teste |
| `database/query_stable_and_capable.sql` | Query do time, **como entregue**. Para mudar KPIs/sites é só editar aqui (a data do WHERE é ignorada e trocada por parâmetro) |
| `python/` | Gerador de PDF (`src/`, `scripts/`, `config/`, `data/kpi_list.xlsx`, `data/images/cover_template.png`) |

`kpi_list.xlsx` continua controlando a ordem e o filtro de KPIs por BU. Para mudar, substitua o arquivo em `python/data/`.

## Configuração (app.yaml)

Nada é obrigatório além do que o Portal já tem:

| Variável | Padrão |
|---|---|
| Banco | `KAIZEN_AZURE_SQL_DATABASE` (o mesmo do Kaizen) + `AZURE_SQL_SERVER/USER/PASSWORD/PORT` |
| Blob | `AZURE_STORAGE_ACCOUNT / _CONTAINER / _SAS_TOKEN` (os do Kaizen) |
| `STABLECAPABLE_AZURE_SQL_DATABASE` | opcional: outro banco só para esta aplicação |
| `STABLECAPABLE_BLOB_PASTA` | `01 - Imagens/Stable & Capable` |
| `STABLECAPABLE_PYTHON` | `python3`, depois `python` |

As bibliotecas Python estão no **`requirements.txt` da raiz do Portal**. O Databricks Apps instala esse arquivo no deploy, junto com o `package.json`.

## Diagnóstico

- `api/health`: conexão com o banco.
- `api/diagnostico`: Python encontrado e bibliotecas importáveis. Se falhar, a tela mostra um aviso no rodapé.
- `execucao.log` de cada execução, baixável no histórico.

## Testar localmente sem banco

```bash
cd VBM-Stable-and-Capable
npm install
pip install -r ../requirements.txt
STABLECAPABLE_EXCEL_TESTE=/caminho/Stable.xlsx node server.js   # http://localhost:8010/
```

Nesse modo, a "consulta" lê o Excel e filtra `DT_REF` pelo período escolhido. Sem `AZURE_STORAGE_*`, os arquivos vão para uma pasta local.
