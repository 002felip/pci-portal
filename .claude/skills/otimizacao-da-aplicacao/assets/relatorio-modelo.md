# Auditoria técnica — <Aplicação>

Data: <dd/mm/aaaa> · Versão auditada: `<branch>` @ `<commit>` · Método: <leitura do código, execução local com banco simulado, npm audit…>

Status: **confirmado** · **provável** · **precisa de validação**.

## 1. Resumo executivo
<5 a 8 linhas: o que está bom, os 3–5 riscos principais com ID, o que fazer primeiro>

### 1.1 Correções aplicadas
| Gap | O que mudou | Arquivo |
|---|---|---|

**Não aplicadas (motivo):** …
**Validação desta rodada:** …

## 2. Escopo analisado
## 3. Limitações da análise
## 4. Mapa técnico da aplicação
<tecnologias e versões · pontos de entrada · fluxo do acesso à tela · rotas (e quais a interface usa) · variáveis de ambiente · banco e tabelas · integrações · jobs · código só alcançável por URL>

## 5. Principais riscos encontrados
| # | Gap | Severidade | Status |
|---|---|---|---|

## 6. Matriz consolidada de gaps
| ID | Categoria / Sub | Título | Evidência (arquivo:linha) | Cenário de falha/exploração | Impacto técnico | Impacto negócio | Sev | Prob | Pri | Solução recomendada | Alternativa menor impacto | Esf | Risco | Dependências | Validação | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Prefixos de ID: SEC (segurança) · PERF (performance) · DB (banco) · HC (hardcoded) · DEP (dependências/config) · ARQ (arquitetura/manutenção) · UX.
Severidade: CRÍTICA · ALTA · MÉDIA · BAIXA · INFORMATIVA. Prioridade: P1 imediata … P4.

## 7. Vulnerabilidades de segurança
<reais · condicionais · má prática · verificado sem achado · referências OWASP/ASVS/CWE>
## 8. Gargalos de performance
| Gap | Métrica | Como medir |
|---|---|---|
## 9. Valores hardcoded e não dinâmicos
| Valor | Onde | Classificação (1–7) | Precisa ser dinâmico? |
|---|---|---|---|
## 10. Problemas de banco de dados
<gaps + consultas de validação somente leitura + o que medir antes de propor índice + permissões do login>
## 11. Dependências e configurações
## 12. Problemas de arquitetura e manutenção
## 13. Problemas de UX, responsividade e performance percebida
## 14. Plano de correção por ondas
<para cada onda: gaps em ordem · dependências · riscos · critério de aceite · testes · rollback>
## 15. Quick wins
| Gap | Mudança | Esforço |
|---|---|---|
## 16. Correções que exigem maior cuidado
## 17. Testes e critérios de aceite
| Teste | Como | Aceite |
|---|---|---|
## 18. Riscos de regressão
## 19. Recomendações de monitoramento
## 20. Conclusão e próximos passos
