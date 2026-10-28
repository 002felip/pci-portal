---
name: otimizacao-da-aplicacao
description: Auditoria técnica completa ("pente-fino") e aplicação segura de correções em uma aplicação web — segurança (OWASP/ASVS/CWE), performance de front-end, back-end, APIs e banco (Azure SQL/SQL Server), valores hardcoded, segredos, autenticação/autorização (Entra ID, proxy do Databricks Apps), dependências, arquitetura, testes e UX — com matriz de gaps priorizada, plano por ondas e correções que não mudam o funcionamento. Use SEMPRE que o pedido citar "Otimização da Aplicação", "pente-fino", "auditoria técnica", "revisão de segurança e performance", "gaps da aplicação", "hardcoded", "vulnerabilidades", "gargalos", "matriz de gaps", "plano de correção por ondas", ou pedir para revisar e corrigir uma aplicação inteira sem quebrar o funcionamento.
---

# Otimização da Aplicação

Auditoria em profundidade seguida de correções pequenas, rastreáveis e sem mudança de comportamento. O método foi usado no COO Business Units Dashboard (`VBM-Performance-Hub/COO-Business-Units-Dashboard/docs/AUDITORIA-TECNICA.md` é o exemplo completo).

| Arquivo | Para quê |
|---|---|
| `references/checklists.md` | O que verificar em cada etapa (segurança, performance, banco, hardcoded, arquitetura, UX) |
| `references/padroes-de-correcao.md` | Correções já validadas, com código: fallback de API, cache com dado anterior em falha, deduplicação, junção por `CONCAT`, health mínimo, limite de pedidos, testes com banco simulado |
| `assets/relatorio-modelo.md` | Estrutura do relatório (20 seções) e cabeçalho da matriz de gaps |
| `scripts/varredura.sh` | Varredura inicial: candidatos a segredo, sinks de HTML, SQL montada por texto, valores fixos — mostra arquivo:linha e o TIPO, nunca o valor |

## Regras que não mudam

- **Evidência sempre:** todo gap tem arquivo:linha (ou trecho) e status — `confirmado` (visto no código ou reproduzido), `provável` (evidência forte, falta dado real), `precisa de validação` (depende de banco, ambiente ou política inacessível).
- **Segredo nunca é exibido:** informar arquivo, linha, tipo, risco, onde guardar (variável de ambiente, Databricks Secrets/`valueFrom`, Key Vault) e se precisa rotacionar.
- **Severidade justificada:** CRÍTICA só com comprometimento/indisponibilidade/perda de integridade real; diferenciar vulnerabilidade, má prática, dívida técnica e oportunidade.
- **Não inventar:** sem acesso ao banco, não afirmar índice faltando — indicar o que medir (plano real, `SET STATISTICS IO, TIME ON`, cardinalidade, frequência de escrita).
- **Escopo:** auditar a aplicação pedida e os módulos compartilhados que ela usa; não alterar outros projetos (só citar o impacto).
- **Um problema, um ID:** nas outras seções, referenciar o ID em vez de repetir.

## Etapas

1. **Inventário antes de qualquer achado.** Estrutura e finalidade dos módulos, versões (`require('<pkg>/package.json').version`), pontos de entrada, rotas (quais a interface usa de fato — `grep` das chamadas), variáveis de ambiente, fluxo de autenticação/autorização, conexões de banco (pool, timeouts, credencial), integrações, jobs. Rode `scripts/varredura.sh <pasta>` para os candidatos e confirme cada um lendo o código. Não declarar arquivo como "sem uso" sem checar import dinâmico, rotas, templates e acesso por URL.
2. **Segurança** (`references/checklists.md` §A–G). Verificar também o que está CERTO (SQL parametrizada, escape de saída, bloqueio de arquivos internos) e registrar como "verificado sem achado".
3. **Performance** — front, back, banco, rede; para cada gap, a métrica e como medir antes/depois.
4. **Hardcoded** — classificar cada valor (1 inadequado · 2 constante legítima · 3 configuração por ambiente · 4 regra de negócio · 5 dado mestre · 6 valor visual · 7 segredo) e dizer POR QUE precisa ou não ser dinâmico.
5. **Arquitetura, testes, observabilidade, UX.**
6. **Matriz consolidada** (cabeçalho em `assets/relatorio-modelo.md`) e **plano por ondas**: 1 imediata (segurança/segredos/indisponibilidade) · 2 estabilidade/performance · 3 parametrização/governança · 4 manutenibilidade — com dependências, aceite, testes e rollback.
7. **Relatório** na estrutura de 20 seções do modelo, salvo em `docs/` da própria aplicação (pasta não servida ao navegador — confirme a regra de arquivos públicos do projeto).

## Aplicando as correções

Quando o pedido for aplicar ("sem impactar o funcionamento"):

- **Aplicar:** correções de código isoladas, que mantêm o resultado igual para o usuário — ver `references/padroes-de-correcao.md`. Padrões novos ficam com o mesmo valor padrão de antes (ex.: TTL configurável com o padrão antigo).
- **Não aplicar (registrar o motivo no relatório):** decisões de política (quem pode ver o quê), rotação de credencial, colunas novas em cadastro, mudança de regra de negócio que altera números na tela, SQL de outro time que muda o resultado, refatorações amplas, mudanças que afetam outras aplicações (CSP global, atualização de dependência compartilhada).
- **SQL de outro time:** só alterações que preservem o resultado (ex.: separador em `CONCAT` mantém o tratamento de `NULL`); trocas que mudam o resultado vão como recomendação, com a consulta de validação.
- **Um commit por objetivo**, mensagem dizendo o gap tratado; rollback = `git revert`.

## Validação obrigatória

1. Testes automatizados das funções puras e das rotas com banco simulado (`node --test`, sem dependência nova — modelo em `references/padroes-de-correcao.md` §9).
2. Smoke do ponto de entrada real (acesso sem identidade, usuário sem cadastro, arquivos internos bloqueados, parâmetros inválidos → 400).
3. Regressão de interface com Playwright: todas as unidades/telas, com e sem cada opção, larguras 390/1440/1920, erros de console.
4. Cenários de falha: banco fora com e sem leitura anterior, timeout, pedidos simultâneos (contar idas ao banco).
5. Relatório atualizado com "Correções aplicadas" (gap → mudança → arquivo) e "Não aplicadas" (motivo).
