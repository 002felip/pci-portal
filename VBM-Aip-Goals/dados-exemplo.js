/**
 * AIP Goals — dados de exemplo da T00 (Início), T02 (Painel do ciclo), T03 (Metas da BU), T04 (Goal Card) e T13 (Desdobramento).
 *
 * Usados enquanto o modelo de dados (Especificação §9, pendência P-12) não é
 * validado pelo time de dados. A resposta da API leva `exemplo: true` e a tela
 * mostra a pílula "Dados de exemplo". As datas são relativas a hoje, para o
 * exemplo continuar coerente (idade e prazo) em qualquer dia.
 *
 * Arquivo interno: bloqueado pelo portal.js (não é servido ao navegador).
 */

// Soma (ou subtrai) dias úteis a uma data, sem fins de semana.
function somarDiasUteis(base, n) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const passo = n < 0 ? -1 : 1;
  let faltam = Math.abs(n);
  while (faltam > 0) {
    d.setDate(d.getDate() + passo);
    if (d.getDay() !== 0 && d.getDay() !== 6) faltam--;
  }
  return d;
}
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Ciclo ativo: BUs, etapa aberta hoje e janelas (configuração do ciclo, T11).
function cicloExemplo(hoje = new Date()) {
  const desde = (n) => iso(somarDiasUteis(hoje, -n));
  const prazo = (n) => iso(somarDiasUteis(hoje, n));
  const ano = hoje.getMonth() >= 9 ? hoje.getFullYear() + 1 : hoje.getFullYear();
  return {
    id: `AIP-${ano}`, nome: `AIP ${ano}`, ano,
    // Jornada do ciclo (janelas configuradas em T11). etapaAtual = a janela aberta hoje.
    // BUs do ciclo (cadastro editável em T11)
    bus: [
      // Nomes dos sites como no COO Dashboard (IBP.SITES, nomes curtos de apresentação); Clydach e Matsusaka
      // ficam em International Refineries, como no seletor do COO Dashboard
      { sigla: 'Onça Puma', pais: 'Brasil' }, { sigla: 'Salobo', pais: 'Brasil' }, { sigla: 'Sossego', pais: 'Brasil' },
      { sigla: 'Ontario', pais: 'Canadá' }, { sigla: 'VNL', pais: 'Canadá' },
      { sigla: 'Clydach', pais: 'International Refineries' }, { sigla: 'Matsusaka', pais: 'International Refineries' },
    ],
    etapaAtual: 'proposta',
    etapas: [
      { id: 'desdobramento', inicio: desde(35), fim: desde(15) },
      { id: 'proposta', fim: prazo(8) },
      { id: 'calibracao', fim: prazo(18) },
      { id: 'oficial', fim: prazo(23) },
    ],
  };
}

// Papéis do usuário de demonstração e situação inicial de alguns cards (a T01 Minhas pendências foi retirada;
// a lista segue como base dos papéis e das situações usadas no painel, nas metas e no Goal Card).
function pendenciasExemplo(hoje = new Date()) {
  const desde = (n) => iso(somarDiasUteis(hoje, -n));
  const prazo = (n) => iso(somarDiasUteis(hoje, n));
  const ano = hoje.getMonth() >= 9 ? hoje.getFullYear() + 1 : hoje.getFullYear();

  return {
    ciclo: cicloExemplo(hoje),
    usuario: {
      // Papéis por BU e por ciclo (AC-02): a mesma pessoa pode ter papéis diferentes.
      papeis: [
        { papel: 'ponto_focal', bu: 'Salobo' },
        { papel: 'ponto_focal', bu: 'Sossego' },
        { papel: 'diretor', bu: 'VNL' },
        // Membro do grupo de aprovação final (vê todas as BUs e o Painel do ciclo, AC-07)
        { papel: 'pci_coo', bu: null },
      ],
    },
    parametros: { diasParado: 3 },
    itens: [
      {
        id: 'p-101', tipo: 'decidir', card: 'GC-VNL-04', secao: null,
        bu: { sigla: 'VNL', pais: 'Canadá' },
        meta: { numero: 4, titulo: 'BU Adherence to Production Budget' },
        estado: 'em_aprovacao', nivel: { atual: 1, total: 2, nome: 'Diretor da BU' }, versao: 2,
        desde: desde(5), prazo: prazo(2),
        detalhe: 'Resubmissão: seções Ruler e Evidence alteradas desde a v1',
      },
      {
        id: 'p-102', tipo: 'preencher', card: 'GC-SAL-09', secao: null,
        bu: { sigla: 'Salobo', pais: 'Brasil' },
        meta: { numero: 9, titulo: 'BU Copper Growth CPF' },
        estado: 'rascunho', nivel: null, versao: null,
        desde: desde(2), prazo: prazo(6),
        detalhe: '4 de 7 seções preenchidas',
      },
      {
        id: 'p-103', tipo: 'preencher', card: 'GC-SOS-08', secao: 'ruler',
        bu: { sigla: 'Sossego', pais: 'Brasil' },
        meta: { numero: 8, titulo: 'BU Copper Growth Bacaba' },
        estado: 'em_revisao', nivel: null, versao: 1,
        desde: desde(4), prazo: prazo(1),
        detalhe: 'Devolvido pelo grupo P&CI/COO: ajustar Ruler e Unit of Measurement',
      },
      {
        id: 'p-104', tipo: 'comentario', card: 'GC-SAL-02', secao: 'formula',
        bu: { sigla: 'Salobo', pais: 'Brasil' },
        meta: { numero: 2, titulo: 'BU Unit Cost and Investments' },
        estado: 'em_aprovacao', nivel: { atual: 2, total: 2, nome: 'P&CI/COO' }, versao: 1,
        desde: desde(1), prazo: null,
        detalhe: '“Incluir o efeito do câmbio na fórmula?” — comentário na seção Calculation Formula',
      },
      {
        id: 'p-105', tipo: 'acao', card: 'GC-SOS-06', secao: 'evidence',
        bu: { sigla: 'Sossego', pais: 'Brasil' },
        meta: { numero: 6, titulo: 'BU Asset Management' },
        estado: 'em_aprovacao', nivel: { atual: 1, total: 2, nome: 'Diretor da BU' }, versao: 1,
        desde: desde(6), prazo: prazo(-1),
        detalhe: 'Anexar o cronograma dos marcos do roadmap de Asset Management 2027',
      },
      {
        id: 'p-106', tipo: 'decidir', card: 'GC-VNL-05', secao: null,
        bu: { sigla: 'VNL', pais: 'Canadá' },
        meta: { numero: 5, titulo: 'BU Chronic Unease' },
        estado: 'em_aprovacao', nivel: { atual: 1, total: 2, nome: 'Diretor da BU' }, versao: 1,
        desde: desde(1), prazo: prazo(4),
        detalhe: 'Primeira submissão',
      },
      {
        id: 'p-107', tipo: 'acao', card: 'GC-SAL-09', secao: 'evidence',
        bu: { sigla: 'Salobo', pais: 'Brasil' },
        meta: { numero: 9, titulo: 'BU Copper Growth CPF' },
        estado: 'rascunho', nivel: null, versao: null,
        desde: desde(0), prazo: prazo(2),
        detalhe: 'Confirmar com Projetos as datas dos marcos da usina CPF',
      },
    ],
  };
}

// ── Desdobramento do ciclo (T13) e Goal Cards (T02, T03) ──
// Estrutura do material de referência do ciclo 2027 ("VBM COO Scorecard Details" e
// "COO and BUs Scorecard Matrix — DRAFT"): o CEO desdobra o scorecard do COO, e o COO
// desdobra para cada BU 40% do resultado do seu scorecard + 60% de metas específicas.
const SCORECARD_COO = [
  { id: '2027_01', titulo: "CEO's Scorecard Result", peso: 75, resultado: true, compartilhada: [], metasBu: [] },
  { id: '2027_02', titulo: 'Strengthen a Culture of Chronic Unease', peso: 5, compartilhada: ['CTO', 'Safety Director'], metasBu: [5],
    faixas: { min: '80%', alvo: '90%', excepcional: '100%' } },
  { id: '2027_03', titulo: 'Asset Management program', peso: 7.5, compartilhada: ['CTO', 'AM Director'], metasBu: [6],
    faixas: { min: '85%', alvo: '95%', excepcional: '100%' } },
  { id: '2027_04', titulo: 'Operating Model and Continuous Improvement', peso: 7.5, compartilhada: ['CTO', 'OM & P&CI Heads'], metasBu: [7],
    faixas: { min: '3', alvo: '4', excepcional: '5' } },
  { id: '2027_05', titulo: 'Copper Growth (Bacaba, CPF, Alemão)', peso: 5, compartilhada: ['CTO', 'Processing Director', 'Project Director'], metasBu: [8, 9],
    faixas: { min: '2', alvo: '3', excepcional: '4' } },
];
const PESO_RESULTADO_COO = 40; // parte da BU ligada ao resultado do scorecard do COO
const PESO_TOTAL = 100;        // total de pontos por BU (RN-16)
// Prefixo do código do Goal Card por site (3 letras, sem acento)
const CODIGO_SITE = { 'Onça Puma': 'ONP', Salobo: 'SAL', Sossego: 'SOS', Ontario: 'ONT', VNL: 'VNL', Clydach: 'CLY', Matsusaka: 'MAT' };
const todas = (p) => ({ Ontario: p, VNL: p, Clydach: p, Matsusaka: p, 'Onça Puma': p, Salobo: p, Sossego: p });
// Metas específicas da BU (60%): número, título, tipo, se é nova no ciclo, meta do COO de origem e peso por BU.
const METAS_BU = [
  { numero: 1, titulo: 'BU Working Capital', tipo: 'formula', pesos: todas(5) },
  { numero: 2, titulo: 'BU Unit Cost and Investments', tipo: 'formula', pesos: todas(10) },
  { numero: 3, titulo: 'BU Spatial Mine Adherence', tipo: 'formula', pesos: { Ontario: 5, VNL: 5, 'Onça Puma': 5, Salobo: 5, Sossego: 5 } },
  { numero: 4, titulo: 'BU Adherence to Production Budget', tipo: 'formula', pesos: todas(10) },
  { numero: 5, titulo: 'BU Chronic Unease', tipo: 'formula', nova: true, origem: '2027_02', pesos: todas(5) },
  { numero: 6, titulo: 'BU Asset Management', tipo: 'marcos', nova: true, origem: '2027_03', pesos: { ...todas(10), Salobo: 5, Sossego: 5 } },
  { numero: 7, titulo: 'BU Operating Model & Continuous Improvement', tipo: 'marcos', nova: true, origem: '2027_04', pesos: todas(5) },
  { numero: 8, titulo: 'BU Copper Growth Bacaba', tipo: 'marcos', origem: '2027_05', pesos: { Sossego: 10 } },
  { numero: 9, titulo: 'BU Copper Growth CPF', tipo: 'marcos', origem: '2027_05', pesos: { Salobo: 10 } },
  { numero: 10, titulo: 'BU VBM Operating Plan (strategic initiatives)', tipo: 'marcos', nova: true, pesos: { Ontario: 10, VNL: 10, Clydach: 15, Matsusaka: 15, 'Onça Puma': 10, Salobo: 5, Sossego: 5 } },
];
const META_RESULTADO_COO = { numero: 0, titulo: "COO's Scorecard Result", tipo: 'formula', resultado: true };

function desdobramentoExemplo(hoje = new Date()) {
  return {
    ciclo: cicloExemplo(hoje),
    parametros: { pesoTotal: PESO_TOTAL, pesoResultadoCoo: PESO_RESULTADO_COO },
    scorecardCoo: SCORECARD_COO,
    metasBu: METAS_BU,
  };
}

// Situação dos cards na etapa de proposta: muitos em rascunho, alguns já em aprovação ou devolvidos.
const SITUACOES = ['rascunho', 'rascunho', 'rascunho', 'em_aprovacao', 'em_aprovacao', 'em_aprovacao', 'em_revisao', 'aprovado', 'aprovado', 'negado'];

// Um Goal Card por meta desdobrada em cada BU (resultado do COO + específicas com peso).
// Gerador determinístico (mesma semente → mesmos cards), para o exemplo não mudar a cada leitura.
function painelExemplo(hoje = new Date()) {
  const ciclo = cicloExemplo(hoje);
  let semente = 20271;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  const cards = [];
  ciclo.bus.forEach((bu) => {
    const metas = [{ ...META_RESULTADO_COO, peso: PESO_RESULTADO_COO }]
      .concat(METAS_BU.filter((m) => m.pesos[bu.sigla]).map((m) => ({ numero: m.numero, titulo: m.titulo, tipo: m.tipo, peso: m.pesos[bu.sigla] })));
    metas.forEach((meta) => {
      const estado = SITUACOES[Math.floor(sorte() * SITUACOES.length)];
      const nivel = estado === 'em_aprovacao'
        ? (sorte() < 0.6 ? { atual: 1, total: 2, nome: 'Diretor da BU' } : { atual: 2, total: 2, nome: 'P&CI/COO' })
        : null;
      const versao = estado === 'rascunho' ? null : 1 + Math.floor(sorte() * 2);
      cards.push({
        card: `GC-${CODIGO_SITE[bu.sigla] || bu.sigla.slice(0, 3).toUpperCase()}-${String(meta.numero).padStart(2, '0')}`,
        bu: { sigla: bu.sigla, pais: bu.pais },
        meta,
        estado, nivel, versao,
        // Desde quando o card está na situação (ou no nível) atual
        desde: iso(somarDiasUteis(hoje, -Math.floor(sorte() * (estado === 'em_aprovacao' ? 8 : 12)))),
      });
    });
  });
  // Cards da lista acima seguem a situação dela (T02, T03 e T04 coerentes)
  pendenciasExemplo(hoje).itens.filter((it) => it.tipo !== 'acao').forEach((it) => {
    const c = cards.find((x) => x.card === it.card);
    if (c) Object.assign(c, { estado: it.estado, versao: it.versao, nivel: it.nivel, desde: it.desde });
  });
  return { ciclo, parametros: { diasParado: 3, pesoTotal: PESO_TOTAL }, cards };
}


// ── T04 Goal Card: conteúdo das 7 seções por meta (exemplo) ──
// Seções do Goal Card (Especificação §5). O conteúdo digitado não é traduzido (P-06).
const SECOES = ['objective', 'formula', 'unit', 'ruler', 'area', 'evidence', 'exceptions'];
const TEXTO_PADRAO_EXCECOES = 'Standard cycle text: effects of force majeure, regulatory changes and portfolio decisions approved by the COO are excluded from the result.';
function conteudoMeta(numero, ano) {
  const C = {
    0: { obj: "Deliver the BU share of the COO scorecard result, as measured by the consolidated COO scorecard at year end.", formula: 'COO scorecard result (%), as published by P&CI at year end', unidade: '%', regua: [80, 100, 120], area: ['P&CI', 'BU P&CI lead'], evid: 'COO scorecard closing report published by P&CI' },
    1: { obj: 'Keep BU working capital within the budget envelope, freeing cash for the operation and growth projects.', formula: 'Average monthly working capital (inventory + receivables − payables) vs budget', unidade: 'US$', regua: [105, 100, 95], pol: 'menor', area: ['Finance', 'BU controller'], evid: 'Monthly Finance closing with working capital breakdown' },
    2: { obj: 'Deliver unit cost and sustaining investments at or below budget without compromising safety and asset integrity.', formula: 'C1 unit cost (US$/t) and sustaining capex vs budget, weighted 70/30', unidade: 'US$', regua: [103, 100, 97], pol: 'menor', area: ['Finance', 'BU controller'], evid: 'Monthly cost report and capex execution report' },
    3: { obj: 'Mine according to the spatial plan to protect ore quality and the long-term mine sequence.', formula: 'Tonnes mined inside the planned polygons ÷ total tonnes mined', unidade: '%', regua: [85, 90, 95], area: ['Mine Planning', 'BU mine planning manager'], evid: 'Monthly spatial adherence report from mine planning' },
    4: { obj: 'Deliver the production budget for the year, with monthly tracking of deviations and recovery plans.', formula: 'Payable metal produced ÷ budgeted payable metal', unidade: '%', regua: [95, 100, 105], area: ['Operations', 'BU operations director'], evid: 'Monthly production report reconciled with Finance' },
    5: { obj: 'Embed chronic unease as a leadership routine: weak signals reviewed weekly and acted on before they become events.', formula: 'Chronic unease routines held with actions closed ÷ routines planned', unidade: '%', regua: [80, 90, 100], area: ['Safety', 'BU safety lead'], evid: 'Routine log with attendance and closed actions' },
    6: { obj: 'Execute the 2027 Asset Management roadmap for critical assets: standard, criticality and maintenance strategies.', formula: 'Roadmap milestones delivered in the year (count)', unidade: 'nº de marcos', regua: [4, 5, 6], area: ['Asset Management', 'BU AM lead'], evid: 'Roadmap milestone evidence validated by the AM Director' },
    7: { obj: 'Scale the VBM Operating Model in the BU and run the initiatives portfolio through one register and one cockpit.', formula: 'Operating model milestones delivered and validated (count)', unidade: 'nº de marcos', regua: [3, 4, 5], area: ['OM & P&CI', 'BU OM lead'], evid: 'Cockpit snapshots and Finance-validated value report' },
    8: { obj: 'Deliver the Bacaba must-win milestones within the approved capex.', formula: 'Bacaba must-win milestones delivered (count)', unidade: 'nº de marcos', regua: [2, 3, 4], area: ['Projects', 'Bacaba project director'], evid: 'Project milestone certificates and licence documents' },
    9: { obj: 'Keep the Salobo CPF construction on schedule for the January 2028 start-up, within the approved capex.', formula: 'CPF schedule milestones delivered on time (count)', unidade: 'nº de marcos', regua: [2, 3, 4], area: ['Projects', 'CPF project director'], evid: 'Monthly project report with schedule and capex curves' },
    10: { obj: 'Deliver the BU strategic initiatives of the VBM Operating Plan with validated value.', formula: 'Strategic initiatives delivered with validated value (count)', unidade: 'nº de marcos', regua: [3, 4, 5], area: ['Strategy', 'BU strategy lead'], evid: 'Initiative close-out reports validated by Finance' },
  }[numero];
  return {
    polaridade: C.pol === 'menor' ? 'menor' : 'maior',
    secoes: {
      objective: C.obj,
      formula: C.formula, // memória de cálculo: uma linha
      unit: C.unidade,
      ruler: { min: C.regua[0], meta: C.regua[1], exc: C.regua[2] },
      area: { area: C.area[0], responsavel: C.area[1] },
      evidence: C.evid,
      exceptions: { padrao: TEXTO_PADRAO_EXCECOES, bu: '' },
    },
  };
}
// Pessoas de exemplo (diretório): quem submeteu e quem comentou
const PESSOAS = ['Ana Ribeiro', 'Bruno Costa', 'Carla Mendes', 'Daniel Souza', 'Elisa Martins', 'Felipe Araújo'];

function goalCardExemplo(codigo, hoje = new Date()) {
  const base = painelExemplo(hoje);
  const c = base.cards.find((x) => x.card === codigo);
  if (!c) return null;
  const ano = base.ciclo.ano;
  const conteudo = conteudoMeta(c.meta.numero, ano);
  const sec = conteudo.secoes;
  const n = c.meta.numero, k = (n + c.bu.sigla.length) % PESSOAS.length;
  // Rascunho em andamento: faltam área e evidência (a pré-checagem mostra o que falta)
  if (c.estado === 'rascunho') { sec.area = { area: '', responsavel: '' }; sec.evidence = ''; }
  const comentarios = [];
  let ajustar = [];
  if (c.estado === 'em_revisao') {
    ajustar = ['ruler', 'unit'];
    comentarios.push({ id: `${codigo}-c1`, secao: 'ruler', autor: PESSOAS[(k + 1) % 6], papel: 'aprovador', quando: iso(somarDiasUteis(hoje, -3)),
      texto: 'Minimum is too close to the target; review the ruler with the budget sensitivity.', respostas: [] });
  }
  if (c.estado === 'em_aprovacao' && c.versao > 1) {
    comentarios.push({ id: `${codigo}-c2`, secao: 'formula', autor: PESSOAS[(k + 2) % 6], papel: 'aprovador', quando: iso(somarDiasUteis(hoje, -6)),
      texto: 'Should the formula include the FX effect?', respostas: [{ autor: PESSOAS[k], papel: 'contribuidor', quando: iso(somarDiasUteis(hoje, -5)), texto: 'FX effect excluded; added to the exceptions section.' }] });
  }
  return {
    ciclo: base.ciclo, card: c.card, bu: c.bu, meta: { ...c.meta, polaridade: conteudo.polaridade },
    estado: c.estado, versao: c.versao, desde: c.desde,
    submetidoPor: c.estado === 'rascunho' ? null : PESSOAS[k],
    // Nas BUs em que o usuário de demonstração é contribuidor, ele aparece entre os editores (mostra a RN-12)
    editores: ['Salobo', 'Sossego'].includes(c.bu.sigla) ? [PESSOAS[k], 'Usuário Demonstração'] : [PESSOAS[k]],
    secoes: sec, ajustar,
    alteradasDesde: c.versao > 1 ? { versao: c.versao - 1, secoes: ['formula', 'exceptions'] } : null,
    comentarios,
  };
}

module.exports = { pendenciasExemplo, painelExemplo, desdobramentoExemplo, goalCardExemplo, SECOES, cicloExemplo, somarDiasUteis, iso };
