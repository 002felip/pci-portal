# VBM Value Driver Tree (VDT) dentro do Portal PCI

Endereço: `/VBM-Vdt/` (card na página inicial do Portal). O resto desta pasta é o VDT como ele é. Este arquivo explica só o que muda dentro do Portal.

## Como roda

O Portal é um único processo Node (Databricks App). Ao subir, ele inicia o VDT como **processo filho**, com o mesmo comando do `app.yaml` standalone (`uvicorn app.main:create_app --factory`), na porta interna `127.0.0.1:8101`. Depois encaminha `/VBM-Vdt/...` para lá, tirando o prefixo. Ver `apps-python.js` e `server.js` na raiz.

- O acesso segue a regra do Portal: usuário em `IBP.USERS` com matrícula.
- **Caminhos absolutos:** o frontend compilado pede `/assets/...` e `/api/...`, que no Portal pertencem ao próprio Portal e ao Kaizen. Ao entregar HTML, CSS e JS do VDT, o Portal troca esses caminhos por `/VBM-Vdt/assets/...` e `/VBM-Vdt/api/...`. Não é preciso recompilar nada.

## Atualizar o VDT no Portal

1. Substitua o conteúdo desta pasta pela versão nova, mantendo este `PORTAL.md` e o `.gitignore`.
2. Pronto. A troca de caminhos é feita na hora pelo Portal.

Se as dependências Python mudarem, atualize também o `requirements.txt` da raiz do Portal.

> **Atenção ao `vdt.db`:** é o banco SQLite com os dados publicados no VDT. Substituir a pasta substitui também o banco. Se houver publicações feitas pelo app que não estão no `vdt.db` novo, elas se perdem.

## Dados (SQLite)

- `VDT_DB_PATH`: padrão `vdt.db`, relativo a esta pasta.
- `VDT_ARCHIVE_DIR`: opcional.

As duas variáveis têm os mesmos nomes do app standalone.

O arquivo fica no disco do Databricks App. **Um deploy novo volta ao `vdt.db` publicado no repositório**, igual ao que já acontecia no app standalone. Para os dados sobreviverem a deploys, o caminho seria apontar `VDT_DB_PATH` para um armazenamento persistente.

## Diagnóstico

- `/VBM-Vdt/__estado`: estado do processo (`iniciando`, `instalando`, `pronto` ou `erro`), com o motivo.
- `/VBM-Vdt/api/health`: a saúde do próprio VDT, com a versão.
- Logs do Portal: as linhas do VDT saem com o prefixo `[vbm-vdt]`.
