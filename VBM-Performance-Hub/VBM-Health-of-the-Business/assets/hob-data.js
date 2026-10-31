/* VBM Health of the Business — DADOS DE DEMONSTRAÇÃO.
   Valores ilustrativos (ordem de grandeza do PDF de referência), gerados de forma
   determinística, só para validar o desenho. Quando a fonte existir (Azure SQL do
   Performance Hub, como no COO), troque este arquivo por uma chamada à API que
   devolva o MESMO formato:

   HOB_DATA = {
     fonte: 'demo' | 'db', atualizado: ISO, anos: [..], ultimoReal: { ano, mes },
     bu: { <vbm|cu|ni>: { <ano>: {
       <indicador mensal>: { b: [12], a: [12] },   // b = Budget; a = Actual até ultimoReal, Forecast depois
       ebitdaYear: [{ lbl, v, tipo }],             // ponte do EBITDA do ano (só vbm)
       fcfYear:    [{ lbl, v, tipo }]              // ponte do FCF do ano (só vbm)
     } } }
   }
   tipo da ponte: 'tot' (barra cheia, reinicia o acumulado), 'd' (variação flutuante),
   'sub' (subtotal calculado), 'ref' (referência, ex.: Budget), 'zero' (reinicia o acumulado em 0).
   cinza: true = coluna no cinza do Budget (subtotais e referências da ponte do FCF). */
(function () {
  var semente = 20261029;
  function rnd() { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; }
  var SAZ = [0.9, 0.88, 0.97, 0.98, 1.02, 1.0, 1.04, 1.03, 1.0, 1.04, 1.06, 1.08];

  // base mensal; vol = desvio do Actual | Forecast contra o Budget
  function serie(base, vol, semSaz) {
    var b = [], a = [];
    for (var m = 0; m < 12; m++) {
      var v = base * (semSaz ? 1 : SAZ[m]) * (1 + (rnd() - 0.5) * 0.06);
      b.push(v);
      a.push(v * (1 + (rnd() - 0.38) * vol)); // leve viés, para o Delta aparecer na demo
    }
    return { b: b, a: a };
  }

  function negocio(k, p) {
    return {
      prod: serie(p.prod * k, 0.10), sales: serie(p.sales * k, 0.12),
      ebitda: serie(p.ebitda * k, 0.25), capex: serie(p.capex * k, 0.35),
      fcf: serie(p.fcf * k, 0.6),
      sus: serie(p.sus, 0.25, true), cost: serie(p.cost, 0.08, true), byp: serie(p.byp, 0.08, true)
    };
  }
  function vbm(k) {
    return {
      ebitdaCu: serie(0.32 * k, 0.12), ebitdaNi: serie(0.085 * k, 0.4), ebitdaOut: serie(-0.009 * k, 0.6),
      capex: serie(132 * k, 0.3),
      ebitdaYear: [
        { lbl: 'FY M-1 (Act/Fcst)', v: Math.round(4874 * k), tipo: 'tot' },
        { lbl: 'FX impact', v: 16, tipo: 'd' }, { lbl: 'Price', v: -200, tipo: 'd' }, { lbl: 'Volume', v: -17, tipo: 'd' },
        { lbl: 'Unit COGS', v: -58, tipo: 'd' }, { lbl: 'Other', v: 49, tipo: 'd' },
        { lbl: 'FY Act/Fcst', tipo: 'sub' },
        { tipo: 'zero' },
        { lbl: 'Copper', v: Math.round(3881 * k), tipo: 'd' }, { lbl: 'Nickel', v: Math.round(963 * k), tipo: 'd' },
        { lbl: 'Other Seg.', v: -179, tipo: 'd' }, { lbl: 'Non-Alloc.', v: 0, tipo: 'd' }
      ],
      fcfYear: [
        { lbl: (k < 1 ? '2024' : '2025') + ' Net Debt', v: 1189, tipo: 'tot' },
        { lbl: 'EBITDA', v: Math.round(4665 * k), tipo: 'tot' },
        { lbl: 'Streaming & Wheaton Bonus', v: -1210, tipo: 'd' }, { lbl: 'ARO, PTVI, Energy', v: -284, tipo: 'd' },
        { lbl: 'Working Capital', v: 127, tipo: 'd' },
        { lbl: 'Gross Operational Cash Flow', tipo: 'sub', cinza: true },
        { lbl: 'Investments', v: -1488, tipo: 'd' }, { lbl: 'Income Tax', v: -445, tipo: 'd' },
        { lbl: 'Financial Expenses / Income', v: -241, tipo: 'd' }, { lbl: 'Others', v: 331, tipo: 'd' },
        { lbl: 'Free Cash Flow', tipo: 'sub', cinza: true },
        { lbl: 'Debt Adjustments (accrued interest, FX variation)', v: 1154, tipo: 'tot', cinza: true },
        { lbl: (k < 1 ? '2025B' : '2026B') + ' Net Debt', v: -27, tipo: 'ref', cinza: true },
        { lbl: (k < 1 ? '2025F' : '2026F') + ' Net Debt', v: 1784, tipo: 'tot' }
      ]
    };
  }
  function porAno(fn) { return { 2025: fn(0.96), 2026: fn(1) }; }

  window.HOB_DATA = {
    fonte: 'demo',
    atualizado: '2026-10-20T18:51:11',
    anos: [2025, 2026],
    ultimoReal: { ano: 2026, mes: 9 },
    bu: {
      vbm: porAno(vbm),
      cu: porAno(function (k) { return negocio(k, { prod: 31, sales: 30, ebitda: 310, capex: 52, fcf: 160, sus: 1.3, cost: 6.9, byp: -7.1 }); }),
      ni: porAno(function (k) { return negocio(k, { prod: 13.5, sales: 13, ebitda: 80, capex: 85, fcf: 25, sus: 4.2, cost: 14.5, byp: -3.4 }); })
    }
  };
})();
