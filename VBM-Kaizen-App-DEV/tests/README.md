# Testes de regressão

Bateria de testes automatizados trazida para o repositório em 20/09/2026,
a partir de scripts já usados e validados durante o desenvolvimento das
funcionalidades mais recentes (múltiplos filtros, histórico, fotos,
paginação/exportação da Biblioteca). Até então viviam fora do controle de
versão — este diretório existe para que parem de se perder.

## Como funciona

Cada suíte roda contra uma instância real do `server.js`, mas com o
módulo `mssql` **interceptado** por um dublê (`fake-mssql*.js`): nunca
abre conexão de verdade com o Azure SQL. O dublê responde com dados
fixos, reconhecendo cada consulta pelo texto do SQL. Isso prova o
comportamento da API e das telas (Playwright + Chromium) sem depender
de banco nem de rede.

## Requisitos

- Node.js.
- Playwright com Chromium instalado. Os scripts assumem
  `/opt/node22/lib/node_modules/playwright` e
  `/opt/pw-browsers/chromium` (ambiente de desenvolvimento usado neste
  projeto) — em outro ambiente, ajuste o `require()` no topo de cada
  `teste-*.js`/`varre-modais.js`/`conf-masonry.js` para onde o
  Playwright estiver instalado.

## Rodar tudo

```bash
bash tests/regressao.sh
```

Sobe o app em 7 portas diferentes (3994/3995/3996/3997/3998/3999/4000),
uma por grupo de suítes, cada uma com o dublê que espera. `tests/env-exemplo.sh`
fornece variáveis de ambiente fictícias — nunca credenciais reais (ver
o alerta dentro do próprio arquivo).

## Rodar uma suíte isolada

```bash
source tests/env-exemplo.sh
PORT=3994 node -r tests/preload.js server.js &   # sobe o app com o dublê certo
node tests/teste-ficha.js                         # roda só esta suíte
```

Confira, no início de cada `teste-*.js`, qual `preload-*.js` (dublê) e
qual porta (`BASE`) ele espera — nem todas usam o mesmo par.

## Cobertura atual

| Suíte | O que cobre |
|---|---|
| `teste-ui-foto.js` | Upload de foto (Antes/Depois) no Novo Kaizen |
| `teste-ficha.js` | Ficha/impressão do Kaizen |
| `teste-icones.js` | Ícones do subconjunto Font Awesome existem e renderizam (claro/escuro) |
| `teste-fechar.js` | Botões de fechar (contraste, comportamento) |
| `teste-site-aprovador.js` | Recorte de aprovadores por site |
| `teste-grupos-admin.js` | Administração de grupos |
| `varre-modais.js` | Varredura geral de modais |
| `teste-notificacoes.js` | Registro em KZN_TB_NOTIFICACAO nas 5 mudanças de status (cadastro, aprovar, reprovar, solicitar alteração, revisar): conteúdo, uma linha por evento, nada em ação recusada, falha da tabela não derruba a ação. Sobe o próprio servidor (porta 4001) |
| `conf-masonry.js` | Layout em grade (masonry) da Biblioteca |
| `teste-gate-mdm.js` | Bloqueio de acesso a quem não está no MDM — página inteira (`/`, index.html, biblioteca.html, kaizen-novo.html) e API, por URL direta, sem regredir admin.html/aprovacao.html |
| `teste-lixeira-kaizen.js` | Lixeira do card na Biblioteca — visível só para dono/admin em status permitido, modal de confirmação, DELETE revalidado no servidor (dono errado -> 403, status bloqueado -> 409), lista/resumo atualizam sem reload, cor de alerta só no hover, foco por teclado, tema escuro |

**Fora desta bateria** (não trazidas ainda, mas seguem o mesmo padrão —
ver histórico de commits de "Exportar Excel" e "paginação real"):
testes de resumo da Biblioteca, histórico, edição de histórico,
multi-select de filtros, fechar-outros-filtros, e os testes dedicados
de exportação Excel/paginação. Podem ser adicionadas aqui do mesmo
jeito, quando alguém tiver tempo de fazer a mesma limpeza de caminhos
que este README documenta.

## Por que não é `npm test`

Não há `package.json` de teste nem framework (Jest/Mocha) — os scripts
são Node puro + Playwright, do jeito que já estavam. Formalizar isso
melhor (framework, CI) fica como próximo passo, não incluído nesta
leva.
