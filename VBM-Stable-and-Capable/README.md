# VBM - Stable & Capable

Gera os relatórios PDF de **estabilidade e capabilidade (SPC)** por Business Unit, para o período que a pessoa escolhe na tela.
Endereço: `/VBM-Stable-and-Capable/`, aplicação da raiz do Portal (card na página inicial, ao lado do VBM-Kaizen-App e do VBM-Performance-Hub).
Montada pelo `server.js` da raiz, depois do controle de acesso do Portal (IBP.USERS com CD_MATRICULA).

## Opções da tela

Ao abrir, a pessoa escolhe entre:

- **Rodar o modelo** (`#modelo`): gerar os PDFs. É o fluxo descrito abaixo.
- **Importar dados** (`#importar`): subir o PCI Master do mês para a `IBP.PEDRAVISAODIARIA`.
- **Power BI** (`#powerbi`): a página "Stable and capable" do `Stable_and_Capable_3.pbix`, refeita no app (ver abaixo).

## Power BI (página refeita no app)

Reprodução da página **"Stable and capable"** do `Stable_and_Capable_3.pbix`, sem depender de licença do Power BI nem dos visuais Python. Mesmo conteúdo, com o design do app:

- **Filtros:** Business Unit → Site → KPI (Operação só aparece quando o par site/KPI tem mais de uma), período, *Remover zeros?* e *Remover outliers?*. Os padrões são os do `.pbix`: Salobo / Salobo / Ore Mined, Não, Não.
- **Carta de controle** por **trimestre** ou **ano** ("Choose the grouping"):
  - CL e limites com MR/d2 (d2 = 1,128), com LCL nunca negativo;
  - as 4 regras de Nelson e a faixa dos melhores 30 dias de cada período.
- **Medidas estatísticas e comparações:** média, melhores 30 dias, P75 e budget por período, mais a variação da média entre períodos.
- **Histograma de capabilidade:** por ano, com 35 faixas comuns, curva normal e a tabela Ano / Mean / StDev / CV / N.

**De onde vem cada parte**

| Parte | Origem |
|---|---|
| Dados | `database/query_powerbi_stable_and_capable.sql` (a consulta da tabela `base` do `.pbix`, copiada como está), sempre no banco **PRD** |
| Servidor | `bi-api.js`: o resultado (cerca de 80 mil linhas) fica em memória e é recarregado a cada `STABLECAPABLE_BI_CACHE_MIN` minutos (padrão 60) ou pelo botão "Atualizar dados" |
| Cálculos e gráficos | `assets/js/painel-spc.js`: mesma lógica dos scripts Python do `.pbix` (cada bloco cita o trecho de origem), desenhados em SVG, sem biblioteca externa |

- **Conferência:** os valores foram comparados com os scripts Python originais (CL/UCL/LCL, medidas e histograma).
- **Regra 4:** reproduz o comportamento do script, que avalia só a sequência alternada que termina no fim de cada período.

| Variável | Padrão |
|---|---|
| `STABLECAPABLE_BI_SQL_DATABASE` | `BDIBPBMSA_PRD` |
| `STABLECAPABLE_BI_SQL_SERVER` | `AZURE_SQL_SERVER` (ou o servidor PRD) |
| `STABLECAPABLE_BI_CACHE_MIN` | `60` |

O login é o do Portal (`AZURE_SQL_USER` / `AZURE_SQL_PASSWORD`).

## Importar dados (PCI Master → IBP.PEDRAVISAODIARIA)

Substitui o fluxo manual de todo mês: rodar o `mapeamento.py` no Colab e subir o `resultado.xlsx` no banco.

1. **Prévia** (`POST api/importacao/previa`): a pessoa envia o PCI Master Data File e escolhe mês e ano. O script `python/scripts/importar_pci_master.py` faz o mesmo que o `mapeamento.py`, usando o mapeamento de `python/data/mapeamento_bu_kpi.xlsx`, e **nada é gravado**. A tela mostra:
   - as linhas geradas;
   - os campos sem dados ou com dias faltando no mês;
   - quantas linhas já existem no banco.

   Dá para baixar o `resultado.xlsx`, idêntico ao de antes.
2. **Gravação** (`POST api/importacao/previa/:id/confirmar`): tudo numa única transação. Se algo falha, nada é gravado.
   - `atualizar`: linhas que já existem (mesma data, sistema, site, operação e KPI) têm **só o `VL_REAL`** atualizado; as demais são inseridas.
   - `novos`: só insere as que não existem.

   Nenhuma linha é apagada, então `VL_D30`, `VL_CS`, `VL_PD` e `VL_PROJ` vindos de outra origem não são zerados.
3. **Arquivos e histórico:** o `resultado_AAAA-MM.xlsx` e o `PCI_Master_AAAA-MM.xlsx` vão para o Blob, em `<pasta>/importacoes/<id>/`. O registro (quem, quando, linhas inseridas e atualizadas) fica em `importacoes.json`.

Antes de gravar, o app confere as colunas da tabela no próprio banco (`INFORMATION_SCHEMA`). Se faltar coluna, ou se houver coluna obrigatória que o arquivo não preenche, a gravação é bloqueada com a explicação.

**Mapeamento:** para mudar campos, sites ou KPIs, substitua `python/data/mapeamento_bu_kpi.xlsx`. Ele é baixável pela tela. Dois formatos são aceitos:
- `NM_TABELA`: nome da coluna. A aba é descoberta pelo cabeçalho, preferindo a aba da BU à `Consolidated Table`.
- `NM_ABA` + `NM_CAMPO`: formato do `mapeamento.py` original.

Também lê `ID_SISTEMA`, `ID_SITE`, `ID_OPERACAO`, `ID_KPI` e `Dividir por 100?`.

| Variável | Padrão |
|---|---|
| `STABLECAPABLE_TABELA_IMPORTACAO` | `IBP.PEDRAVISAODIARIA` (mesmo banco do resto da aplicação) |

O login do banco precisa de permissão de `SELECT`, `INSERT` e `UPDATE` nessa tabela.

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

### Bibliotecas Python

A aplicação **não depende** do deploy ter instalado as bibliotecas no Python que o Node usa. No primeiro teste no Databricks Apps deu `No module named 'pandas'`. Por isso, na subida, ela faz o seguinte:

1. Procura um Python (`STABLECAPABLE_PYTHON`, `python3`, `python`…) que já importe tudo.
2. Se nenhum importar, instala `python/requirements.txt` com `pip install --target` numa pasta própria: `STABLECAPABLE_PYLIBS`, senão `VBM-Stable-and-Capable/.pylibs`, senão o temp do sistema.
3. Passa essa pasta no `PYTHONPATH` do gerador.

Na primeira subida após o deploy isso leva alguns minutos (a tela mostra um aviso no topo, e uma execução iniciada nesse meio-tempo começa sozinha quando termina). Nas subidas seguintes, a pasta já existe e o app fica pronto na hora.

O `requirements.txt` usa **faixas de versão**, não versões fixas, para o pip achar pacotes prontos para o Python do ambiente. Testado com Python 3.12 (versões do projeto original) e 3.13 (numpy 2.5, pandas 2.3): os PDFs saem iguais.

## Diagnóstico

- `api/health`: conexão com o banco.
- `api/diagnostico`: Python usado, pasta das bibliotecas e estado (`verificando`, `instalando`, `pronto` ou `erro`, com a mensagem). Se não estiver pronto, a tela mostra um aviso no topo.
- `execucao.log` de cada execução, baixável no histórico.

## Testar localmente sem banco

```bash
cd VBM-Stable-and-Capable
npm install
pip install -r ../requirements.txt
STABLECAPABLE_EXCEL_TESTE=/caminho/Stable.xlsx node server.js   # http://localhost:8010/
```

Nesse modo, a "consulta" lê o Excel e filtra `DT_REF` pelo período escolhido. Sem `AZURE_STORAGE_*`, os arquivos vão para uma pasta local.
