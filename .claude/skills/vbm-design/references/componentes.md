# Componentes

Classes em `assets/vbm-componentes.css`. Exemplo vivo: `assets/exemplo.html`.

## Título do dashboard + ações

```html
<div class="dash-titulo">
  <h2 class="dash-titulo-nome">Nome do dashboard - October 2026</h2>
  <div class="dash-acoes">
    <button type="button" class="dash-acao" aria-label="Baixar dados em Excel" title="Baixar dados em Excel"
            data-i18n-aria="ui.baixar_excel" data-i18n-title="ui.baixar_excel"><i class="fa-solid fa-file-excel" aria-hidden="true"></i></button>
  </div>
</div>
```

- Ordem das ações (Studio): salvar, desfazer, Excel, imagens (PNG), tela cheia.
- `.is-pendente` = alteração não salva (botão cheio). `disabled` quando não há o que fazer.
- Botão só com ícone sempre com `aria-label` e `title`.

## Filtros (padrão COO)

```html
<div class="filters">
  <div class="filter">
    <span class="filter-label" id="lblAno" data-i18n="f.year">Ano:</span>
    <div class="seg" role="group" aria-labelledby="lblAno">
      <button type="button" aria-pressed="true">2026</button>
      <button type="button" aria-pressed="false">2025</button>
    </div>
  </div>
  <div class="filter">
    <span class="filter-label" id="lblDelta">Delta:</span>
    <button type="button" class="switch" role="switch" aria-checked="true" aria-labelledby="lblDelta">
      <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    </button>
  </div>
</div>
```

| Componente | Quando usar |
|---|---|
| `.seg` (segmentado) | escolha única entre poucas opções visíveis (Visão, Ano, Trimestre, Mês) |
| `.switch` | liga/desliga (Delta, mostrar Plan) |
| `.unit` (gatilho + `.unit-pop` em colunas) | hierarquia País › Site, Ciclo (lista de cargas, a mais recente primeiro) |
| `.nav-chip` | paginação e navegação curta |
| Horizonte agrupado (Studio) | muitas opções em grupos recolhíveis (Mensal, Trimestral, Semestral, YTD, Anual) |

Popover: `aria-expanded` no gatilho, `hidden` no fechado, Esc fecha e devolve o foco ao gatilho,
clique fora fecha.

## Painel, card e legenda

```html
<section class="panel panel-prod">
  <div class="panel-head">
    <h3 class="panel-title">Production</h3>
    <ul class="legend"><li><span class="swatch" style="background:var(--serie-b)"></span>Budget</li></ul>
  </div>
  <p class="updated">Last updated 12/11/2026 14:30</p>
</section>
```

- `.card.is-selected`: borda azul + halo; ao exportar imagem, a seleção é removida.
- `.pill-wait`: "Atualizações finais pendentes" com ícone de relógio (âmbar).

## Toast

`<div class="toast" role="status" aria-live="polite" hidden></div>`; `.is-err` para erro.
Mensagem curta, em linguagem de negócio ("Imagem PNG baixada.", "Não foi possível exportar o gráfico.").
Confirmação de ação destrutiva: 2º clique confirma (caixa `role="alertdialog"`), nunca `confirm()`.
