/**
 * AIP Goals — dados de exemplo da T00 (Início), T01 (Minhas pendências), T02 (Painel do ciclo), T03 (Metas da BU) e T13 (Desdobramento).
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
      { sigla: 'OP', pais: 'Brasil' }, { sigla: 'Salobo', pais: 'Brasil' }, { sigla: 'Sossego', pais: 'Brasil' },
      { sigla: 'ON', pais: 'Canadá' }, { sigla: 'VNL', pais: 'Canadá' }, { sigla: 'UK', pais: 'Canadá' }, { sigla: 'JPN', pais: 'Canadá' },
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
const todas = (p) => ({ ON: p, VNL: p, UK: p, JPN: p, OP: p, Salobo: p, Sossego: p });
// Metas específicas da BU (60%): número, título, tipo, se é nova no ciclo, meta do COO de origem e peso por BU.
const METAS_BU = [
  { numero: 1, titulo: 'BU Working Capital', tipo: 'formula', pesos: todas(5) },
  { numero: 2, titulo: 'BU Unit Cost and Investments', tipo: 'formula', pesos: todas(10) },
  { numero: 3, titulo: 'BU Spatial Mine Adherence', tipo: 'formula', pesos: { ON: 5, VNL: 5, OP: 5, Salobo: 5, Sossego: 5 } },
  { numero: 4, titulo: 'BU Adherence to Production Budget', tipo: 'formula', pesos: todas(10) },
  { numero: 5, titulo: 'BU Chronic Unease', tipo: 'formula', nova: true, origem: '2027_02', pesos: todas(5) },
  { numero: 6, titulo: 'BU Asset Management', tipo: 'marcos', nova: true, origem: '2027_03', pesos: { ...todas(10), Salobo: 5, Sossego: 5 } },
  { numero: 7, titulo: 'BU Operating Model & Continuous Improvement', tipo: 'marcos', nova: true, origem: '2027_04', pesos: todas(5) },
  { numero: 8, titulo: 'BU Copper Growth Bacaba', tipo: 'marcos', origem: '2027_05', pesos: { Sossego: 10 } },
  { numero: 9, titulo: 'BU Copper Growth CPF', tipo: 'marcos', origem: '2027_05', pesos: { Salobo: 10 } },
  { numero: 10, titulo: 'BU VBM Operating Plan (strategic initiatives)', tipo: 'marcos', nova: true, pesos: { ON: 10, VNL: 10, UK: 15, JPN: 15, OP: 10, Salobo: 5, Sossego: 5 } },
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
        card: `GC-${bu.sigla.slice(0, 3).toUpperCase()}-${String(meta.numero).padStart(2, '0')}`,
        bu: { sigla: bu.sigla, pais: bu.pais },
        meta,
        estado, nivel, versao,
        // Desde quando o card está na situação (ou no nível) atual
        desde: iso(somarDiasUteis(hoje, -Math.floor(sorte() * (estado === 'em_aprovacao' ? 8 : 12)))),
      });
    });
  });
  return { ciclo, parametros: { diasParado: 3, pesoTotal: PESO_TOTAL }, cards };
}

module.exports = { pendenciasExemplo, painelExemplo, desdobramentoExemplo, cicloExemplo, somarDiasUteis, iso };
