# Fontes do relatório

No Windows o relatório usa Calibri / Arial / Segoe UI / Vale Sans, que **não existem no Linux (Databricks)**.
Sem nada nesta pasta, o código usa automaticamente **DejaVu Sans** (vem com o matplotlib) no mesmo peso/estilo — o layout fica correto, só a tipografia muda.

Para ficar idêntico ao Windows, copie os `.ttf` para esta pasta (os nomes precisam ser exatamente estes):

| Arquivo | Onde é usado |
|---|---|
| `calibri.ttf`, `calibrib.ttf`, `calibrii.ttf`, `calibriz.ttf` | títulos e tabelas das páginas de KPI |
| `ValeSans-Bold.ttf`, `ValeSans-Italic.ttf` | capa |
| `segoeuiz.ttf`, `segoeuii.ttf` | página de lista de KPIs |

No Windows eles ficam em `C:\Windows\Fonts\`. Verifique a licença da fonte antes de distribuí-la.
Também é possível apontar outra pasta com a variável de ambiente `REPORT_FONTS_DIR`.
