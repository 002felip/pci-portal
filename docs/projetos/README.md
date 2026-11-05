# Documentação técnica dos projetos do Portal

Um documento por projeto hospedado no Portal PCI. A visão de conjunto (hospedagem, roteamento,
acesso, bancos) está em [`../ARQUITETURA.md`](../ARQUITETURA.md); aqui fica o detalhe de cada
projeto: arquivos, rotas, dados, variáveis, fluxos, testes e pontos de atenção.

| Projeto | Endereço | Stack | Documento |
|---|---|---|---|
| Núcleo do Portal | `/` | Node/Express | [portal-nucleo.md](portal-nucleo.md) |
| VBM Kaizen | `/VBM-Kaizen-App/` | Node/Express + HTML/JS | [kaizen.md](kaizen.md) |
| VBM Performance Hub | `/VBM-Performance-Hub/` | Node/Express + HTML/JS | [performance-hub.md](performance-hub.md) |
| ↳ VBM Performance Studio | `/VBM-Performance-Hub/VBM-Performance-Studio/` | idem | [performance-studio.md](performance-studio.md) |
| ↳ COO Business Units Dashboard (atual e Historical) | `/VBM-Performance-Hub/COO-Business-Units-Dashboard*/` | idem | [coo-dashboards.md](coo-dashboards.md) |
| ↳ VBM Health of the Business | `/VBM-Performance-Hub/VBM-Health-of-the-Business/` | idem | [health-of-the-business.md](health-of-the-business.md) |
| VBM Stable & Capable | `/VBM-Stable-and-Capable/` | Node/Express + Python + HTML/JS | [stable-and-capable.md](stable-and-capable.md) |
| VBM Value Driver Tree (VDT) | `/VBM-Vdt/` | Python/FastAPI + SQLite | [vdt.md](vdt.md) |
| VBM Strategic Cockpit | `/VBM-Cockpit/` | Python/FastAPI + React + Lakebase | [cockpit.md](cockpit.md) |

## Convenções usadas nos documentos

- **Caminhos de API** são relativos ao prefixo da aplicação (ex.: `GET /ciclos` no COO é
  `/VBM-Performance-Hub/COO-Business-Units-Dashboard/api/ciclos`). A exceção é o Kaizen, cuja API
  fica em `/api` na raiz.
- **Variáveis de ambiente** são declaradas no `app.yaml` da raiz. A coluna "Padrão" mostra o valor
  usado quando a variável não existe.
- **Scripts `.sql` em `database/`** são operacionais (rodados à mão no SSMS), a menos que o documento
  diga que a API os carrega.
- Situação de referência: `main` em novembro de 2026. Ao mudar um projeto, atualize o documento dele
  no mesmo PR.
