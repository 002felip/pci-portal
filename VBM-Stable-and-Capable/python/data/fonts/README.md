# Fontes do relatório

O relatório usa a **Poppins**, a mesma fonte do Dashboard do app, para o PDF e a tela terem o mesmo
visual. Os arquivos estão nesta pasta e são lidos por caminho, então funcionam no Databricks sem
instalar nada no sistema:

| Arquivo | Onde é usado |
|---|---|
| `Poppins-Regular.ttf` | textos, eixos, tabelas |
| `Poppins-Italic.ttf` | títulos das páginas (itálico azul, como no Dashboard) e datas |
| `Poppins-Medium.ttf` | títulos dos cards e cabeçalhos de tabela |
| `Poppins-SemiBold.ttf` | rótulos de destaque (CL, valores das colunas, pílulas dos trimestres) |
| `Poppins-Bold.ttf` | reserva |

Licença: SIL Open Font License 1.1 (Indian Type Foundry / Google Fonts), que permite redistribuir as
fontes junto com o software. Ver `OFL.txt`.

A capa continua usando a Vale Sans quando ela estiver aqui (`ValeSans-Bold.ttf`, `ValeSans-Italic.ttf`);
sem ela, usa a Poppins. Outra pasta pode ser indicada com a variável de ambiente `REPORT_FONTS_DIR`.
