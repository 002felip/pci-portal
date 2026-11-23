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
        // Regra de acesso: leitura aberta; contribuidor por BU; aprovador edita e aprova; admin tem todas as telas
        { papel: 'contribuidor', bu: 'Salobo' },
        { papel: 'admin', bu: null },
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
  // Contribuidor responsável pelo card (o mesmo nome que aparece nos editores do Goal Card)
  cards.forEach((c) => { c.contribuidor = PESSOAS[(c.meta.numero + c.bu.sigla.length) % PESSOAS.length]; });
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

// Diretor de cada BU (exemplo; no banco, a matrícula fica na AIP_UNIDADE e o nome vem do MDM): responsável pela meta
const DIRETORES = { 'Onça Puma': 'Ricardo Menezes', Salobo: 'Fernanda Lacerda', Sossego: 'Marcelo Antunes', Ontario: 'David Thompson', VNL: 'Sarah Mitchell', Clydach: 'Owen Hughes', Matsusaka: 'Kenji Nakamura' };
const AREA_RESPONSAVEL = 'Diretoria Executiva';
// Exceções e considerações por BU (o administrador aplica um texto a uma ou mais BUs; sem texto próprio, vale o padrão do ciclo)
const EXCECOES_BU = { Clydach: 'Refinery feed variations caused by third-party concentrate supply are excluded from the result.', Matsusaka: 'Refinery feed variations caused by third-party concentrate supply are excluded from the result.' };
const areaDaBu = (sigla) => ({ area: AREA_RESPONSAVEL, responsavel: DIRETORES[sigla] || '' });
function goalCardExemplo(codigo, hoje = new Date()) {
  const base = painelExemplo(hoje);
  const c = base.cards.find((x) => x.card === codigo);
  if (!c) return null;
  const ano = base.ciclo.ano;
  const conteudo = conteudoMeta(c.meta.numero, ano);
  const sec = conteudo.secoes;
  const n = c.meta.numero, k = (n + c.bu.sigla.length) % PESSOAS.length;
  // Rascunho em andamento: faltam área e evidência (a pré-checagem mostra o que falta)
  if (c.estado === 'rascunho') sec.evidence = '';
  // Área responsável: não editável, vem do cadastro da BU (Diretoria Executiva e o diretor da BU)
  sec.area = areaDaBu(c.bu.sigla);
  if (EXCECOES_BU[c.bu.sigla]) sec.exceptions.padrao = EXCECOES_BU[c.bu.sigla];
  // Resubmissão: a exceção da BU entrou na v2 (a mesma das Versões, T06), para o "antes" da T14 bater
  if (c.versao > 1 && c.estado !== 'rascunho') sec.exceptions.bu = 'FX effect excluded from the result, as agreed with P&CI.';
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

// ── T11 Configuração do ciclo ──
// Diretório de exemplo (IBP.USERS): nome, matrícula e e-mail. No modelo validado, a pessoa entra no grupo pela matrícula.
const DIRETORIO = [
  'Ana Ribeiro', 'Bruno Costa', 'Carla Mendes', 'Daniel Souza', 'Elisa Martins', 'Felipe Araújo', 'Gabriela Lima', 'Henrique Prado',
  'Isabela Nunes', 'João Ferreira', 'Karen Duarte', 'Lucas Teixeira', 'Mariana Rocha', 'Nicolas Barros', 'Olivia Campos', 'Paulo Moreira',
  'Rafaela Pires', 'Sérgio Almeida', 'Tatiana Lopes', 'Vinícius Cardoso', 'William Grant', 'Emily Clarke', 'Hiroshi Tanaka', 'Yuki Sato',
  'Owen Davies', 'Rhys Morgan', 'Jessica Tremblay', 'Marc Gagnon', 'Usuário Demonstração',
];
const semAcento = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
// Diretório de pessoas (exemplo do MDM): nome, matrícula, e-mail, cargo, estado e cidade
const CARGOS = ['ANL Excelência Operacional SR', 'Engenheiro Senior', 'Técnico Controle Processo II', 'ANL Gestão Desempenho', 'Especialista P&CI', 'Gerente de Área', 'ANL Operacional', 'Engenheiro Master'];
const LOCAIS = [['PA', 'Canaã dos Carajás'], ['PA', 'Marabá'], ['PA', 'Ourilândia do Norte'], ['MG', 'Belo Horizonte'], ['RJ', 'Rio de Janeiro'], ['ON', 'Sudbury'], ['NL', "Voisey's Bay"]];
const pessoaDe = (nome, i) => ({ nome, matricula: `C${String(410200 + i * 37).padStart(6, '0')}`, email: semAcento(nome).toLowerCase().replace(/\s+/g, '.') + '@vale.com',
  cargo: CARGOS[i % CARGOS.length], estado: LOCAIS[i % LOCAIS.length][0], cidade: LOCAIS[i % LOCAIS.length][1] });
function configuracaoExemplo(hoje = new Date()) {
  const ciclo = cicloExemplo(hoje);
  const pessoas = DIRETORIO.map(pessoaDe);
  const por = (nome) => pessoas.find((p) => p.nome === nome);
  const membros = [];
  // Grupo de aprovação (P&CI/COO, nível único) e administrador: sem BU
  ['Gabriela Lima', 'Henrique Prado', 'Isabela Nunes', 'João Ferreira', 'Usuário Demonstração'].forEach((n) => membros.push({ ...por(n), grupo: 'aprovacao', bu: null }));
  ['Usuário Demonstração', 'Karen Duarte'].forEach((n) => membros.push({ ...por(n), grupo: 'admin', bu: null }));
  // Contribuidores (2 por BU)
  const contrib = { 'Onça Puma': ['Ana Ribeiro', 'Lucas Teixeira'], Salobo: ['Carla Mendes', 'Usuário Demonstração'], Sossego: ['Daniel Souza', 'Usuário Demonstração'],
    Ontario: ['Jessica Tremblay', 'Marc Gagnon'], VNL: ['William Grant', 'Emily Clarke'], Clydach: ['Owen Davies', 'Rhys Morgan'], Matsusaka: ['Hiroshi Tanaka', 'Yuki Sato'] };
  ciclo.bus.forEach((b) => {
    contrib[b.sigla].forEach((n) => membros.push({ ...por(n), grupo: 'contribuidor', bu: b.sigla }));
  });
  // Desdobramento em níveis (CEO → COO → BU → GG → GA): cada unidade de um nível recebe os pontos herdados do
  // nível acima (linha "Resultado do nível acima") e distribui o restante entre as metas do seu nível (RN-16).
  const niveis = [
    { id: 'ceo', nome: 'CEO', total: 100, herdado: 0, ativo: true, fixo: true },
    { id: 'coo', nome: 'COO', total: 100, herdado: 75, ativo: true, fixo: true },
    { id: 'bu', nome: 'Business Unit', total: PESO_TOTAL, herdado: PESO_RESULTADO_COO, ativo: true, fixo: true },
    // GG e GA fora no primeiro momento: o desdobramento vai até a BU
  ];
  // Unidades acima e abaixo das BUs (as BUs vêm da aba Business Units): GG por BU e GA por GG
  const unidades = [{ id: 'CEO', nivel: 'ceo', nome: 'CEO VBM', pai: null }, { id: 'COO', nivel: 'coo', nome: 'COO VBM', pai: 'CEO' }];
  ciclo.bus.forEach((b) => {
    const cod = CODIGO_SITE[b.sigla];
    [['MIN', `GG Mina ${b.sigla}`], ['PRO', `GG Processo ${b.sigla}`]].forEach(([g, nome]) => {
      const gid = `${cod}-${g}`;
      unidades.push({ id: gid, nivel: 'gg', nome, pai: b.sigla });
      const gas = g === 'MIN' ? [['LAV', 'GA Lavra'], ['MAN', 'GA Manutenção Mina']] : [['BEN', 'GA Beneficiamento'], ['MAN', 'GA Manutenção Usina']];
      gas.forEach(([a, n]) => unidades.push({ id: `${gid}-${a}`, nivel: 'ga', nome: `${n} ${b.sigla}`, pai: gid }));
    });
  });
  const de = (nivel, valor) => Object.fromEntries(unidades.filter((u) => u.nivel === nivel).map((u) => [u.id, valor]));
  const metasNivel = {
    ceo: [
      { numero: 1, titulo: 'Safety & Sustainability', tipo: 'formula', polaridade: 'maior', pesos: { CEO: 20 } },
      { numero: 2, titulo: 'Financial Results (EBITDA)', tipo: 'formula', polaridade: 'maior', pesos: { CEO: 50 } },
      { numero: 3, titulo: 'Growth Projects', tipo: 'marcos', polaridade: 'maior', pesos: { CEO: 15 } },
      { numero: 4, titulo: 'People & Culture', tipo: 'formula', polaridade: 'maior', pesos: { CEO: 15 } },
    ],
    coo: SCORECARD_COO.filter((m) => !m.resultado).map((m, k) => ({ numero: k + 2, titulo: m.titulo, tipo: k >= 2 ? 'marcos' : 'formula', polaridade: 'maior', pesos: { COO: m.peso } })),
    bu: METAS_BU.map((m) => ({ numero: m.numero, titulo: m.titulo, tipo: m.tipo, polaridade: conteudoMeta(m.numero, ciclo.ano).polaridade, origem: m.origem || null, nova: !!m.nova, pesos: { ...m.pesos } })),
    gg: [
      { numero: 1, titulo: 'GG Safety Routine Adherence', tipo: 'formula', polaridade: 'maior', pesos: de('gg', 15) },
      { numero: 2, titulo: 'GG Cost Adherence', tipo: 'formula', polaridade: 'menor', pesos: de('gg', 20) },
      { numero: 3, titulo: 'GG Production Plan', tipo: 'formula', polaridade: 'maior', pesos: de('gg', 15) },
    ],
    ga: [
      { numero: 1, titulo: 'GA Asset Availability', tipo: 'formula', polaridade: 'maior', pesos: de('ga', 20) },
      { numero: 2, titulo: 'GA Safety Observations Closed', tipo: 'formula', polaridade: 'maior', pesos: de('ga', 20) },
    ],
  };
  // Goal Cards já submetidos por BU: a BU com card submetido não pode ser excluída (só tirada do ciclo)
  const submetidos = {};
  painelExemplo(hoje).cards.forEach((c) => { if (c.estado !== 'rascunho') submetidos[c.bu.sigla] = (submetidos[c.bu.sigla] || 0) + 1; });
  return {
    ciclo: { ...ciclo, status: 'aberto', textoPadraoExcecoes: TEXTO_PADRAO_EXCECOES },
    // Ciclos registrados (exemplo): só um pode estar aberto
    ciclos: [{ ano: ciclo.ano, nome: ciclo.nome, aberto: true }, { ano: ciclo.ano - 1, nome: `AIP ${ciclo.ano - 1}`, aberto: false }, { ano: ciclo.ano - 2, nome: `AIP ${ciclo.ano - 2}`, aberto: false }],
    bus: ciclo.bus.map((b) => ({ ...b, ativa: true, diretor: DIRETORES[b.sigla] || '', cardsSubmetidos: submetidos[b.sigla] || 0 })),
    membros,
    diretorio: pessoas,
    excecoesBu: { ...EXCECOES_BU },
    niveis,
    unidades,
    metasNivel,
    parametros: [
      { id: 'minComentario', valor: 10, unidade: 'caracteres', min: 1, max: 500 },
      { id: 'anexoMb', valor: 25, unidade: 'MB', min: 1, max: 100 },
    ],
  };
}

// ── T07 Action Log: linha do tempo do ciclo (AIP_EVENTO_LOG), derivada dos mesmos cards de exemplo ──
// Cada evento: quem, papel, quando, BU, meta, seção e, nas edições, valor antes e depois (§7.3).
const APROVADORES = ['Gabriela Lima', 'Henrique Prado', 'Isabela Nunes', 'João Ferreira'];
function actionLogExemplo(hoje = new Date()) {
  const base = painelExemplo(hoje), cfg = configuracaoExemplo(hoje);
  const ev = [];
  let seq = 0;
  // Data e hora determinísticas a partir de uma data ISO (dias úteis para trás) e de uma semente
  const em = (isoDia, semente, deslocDias = 0) => {
    const p = isoDia.split('-').map(Number);
    const d = somarDiasUteis(new Date(p[0], p[1] - 1, p[2]), -deslocDias);
    const h = 8 + (semente * 7) % 10, m = (semente * 13) % 60;
    return `${iso(d)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  };
  const add = (e) => ev.push({ id: `EV-${String(++seq).padStart(4, '0')}`, antes: null, depois: null, secao: null, versao: null, ...e });
  base.cards.forEach((c, i) => {
    const meta = { numero: c.meta.numero, titulo: c.meta.titulo };
    const comum = { bu: c.bu.sigla, meta, card: c.card };
    const contrib = c.contribuidor, aprov = APROVADORES[i % APROVADORES.length];
    const regua = conteudoMeta(c.meta.numero, base.ciclo.ano).secoes.ruler;
    if (c.estado === 'rascunho') {
      if (i % 3 === 0) add({ ...comum, tipo: 'recolhimento', quando: em(c.desde, i, 1), quem: contrib, papel: 'contribuidor', versao: 1, detalhe: 'recolheu a submissão para ajustar a evidência' });
      return;
    }
    const v = c.versao || 1;
    if (v > 1) {
      add({ ...comum, tipo: 'submissao', quando: em(c.desde, i, 9), quem: contrib, papel: 'contribuidor', versao: 1, detalhe: 'submeteu a v1' });
      add({ ...comum, tipo: 'comentario', quando: em(c.desde, i + 1, 7), quem: aprov, papel: 'aprovador', secao: 'ruler', detalhe: 'Minimum is too close to the target; review the ruler with the budget sensitivity.' });
      add({ ...comum, tipo: 'decisao', decisao: 'devolver', quando: em(c.desde, i + 2, 6), quem: aprov, papel: 'aprovador', versao: 1, secao: 'ruler', detalhe: 'devolveu a v1 para ajuste na seção Ruler' });
      add({ ...comum, tipo: 'submissao', quando: em(c.desde, i + 3, 2), quem: contrib, papel: 'contribuidor', versao: v, secao: 'ruler', detalhe: `resubmeteu como v${v}`,
        antes: `Mín. ${regua.min - (regua.min > regua.exc ? -2 : 2)} · Meta ${regua.meta} · Exc. ${regua.exc}`, depois: `Mín. ${regua.min} · Meta ${regua.meta} · Exc. ${regua.exc}` });
    } else {
      add({ ...comum, tipo: 'submissao', quando: em(c.desde, i, c.estado === 'em_aprovacao' ? 0 : 3), quem: contrib, papel: 'contribuidor', versao: 1, detalhe: 'submeteu a v1' });
    }
    if (c.estado === 'em_aprovacao' && i % 4 === 1) add({ ...comum, tipo: 'comentario', quando: em(c.desde, i + 4, 0), quem: aprov, papel: 'aprovador', secao: 'formula', detalhe: 'Should the formula include the FX effect?' });
    if (c.estado === 'aprovado') add({ ...comum, tipo: 'decisao', decisao: 'aprovar', quando: em(c.desde, i + 5, 0), quem: aprov, papel: 'aprovador', versao: v, detalhe: `aprovou a v${v}; versão oficial` });
    if (c.estado === 'negado') add({ ...comum, tipo: 'decisao', decisao: 'negar', quando: em(c.desde, i + 5, 0), quem: aprov, papel: 'aprovador', versao: v, detalhe: 'negou a meta: fora do desdobramento acordado com o COO' });
    if (c.estado === 'em_revisao') {
      add({ ...comum, tipo: 'comentario', quando: em(c.desde, i + 6, 1), quem: aprov, papel: 'aprovador', secao: 'unit', detalhe: 'Use the same unit as the COO scorecard (%).' });
      add({ ...comum, tipo: 'decisao', decisao: 'devolver', quando: em(c.desde, i + 7, 0), quem: aprov, papel: 'aprovador', versao: v, secao: 'unit', detalhe: `devolveu a v${v} para ajuste nas seções Unit e Ruler` });
    }
  });
  // Uma reabertura dentro da janela inicial (RN-17)
  const aprovado = base.cards.find((c) => c.estado === 'aprovado');
  if (aprovado) add({ bu: aprovado.bu.sigla, meta: { numero: aprovado.meta.numero, titulo: aprovado.meta.titulo }, card: aprovado.card, tipo: 'reabertura',
    quando: em(iso(hoje), 3, 1), quem: 'Karen Duarte', papel: 'admin', versao: aprovado.versao, detalhe: 'reabriu o card na janela inicial: peso revisto no desdobramento',
    antes: 'Aprovado', depois: 'Rascunho' });
  // Configuração (T11), com antes e depois
  const cfgEv = [
    { d: 2, quem: 'Karen Duarte', secao: 'metas', detalhe: 'alterou o peso da meta 10 em Clydach', antes: '10 pts', depois: '15 pts', bu: 'Clydach' },
    { d: 4, quem: 'Usuário Demonstração', secao: 'grupos', detalhe: 'incluiu Yuki Sato como contribuidora de Matsusaka', antes: '—', depois: 'Contribuidor · Matsusaka', bu: 'Matsusaka' },
    { d: 9, quem: 'Karen Duarte', secao: 'ciclo', detalhe: "ajustou o fim da etapa Propostas BU's", antes: iso(somarDiasUteis(hoje, 6)), depois: cfg.ciclo.etapas[1].fim },
    { d: 15, quem: 'Karen Duarte', secao: 'ciclo', detalhe: 'abriu o ciclo; contribuidores notificados', antes: 'Em preparação', depois: 'Aberto' },
  ];
  cfgEv.forEach((x, k) => add({ tipo: 'configuracao', quando: em(iso(hoje), 20 + k, x.d), quem: x.quem, papel: 'admin', bu: x.bu || null, meta: null, card: null, secao: x.secao, detalhe: x.detalhe, antes: x.antes, depois: x.depois }));
  // Acessos negados (AC-03, AC-04, RN-19)
  add({ tipo: 'acesso_negado', quando: em(iso(hoje), 31, 1), quem: 'Nicolas Barros', papel: 'leitor', bu: null, meta: null, card: null, detalhe: 'tentou editar um Goal Card de Salobo sem ser contribuidor da BU' });
  add({ tipo: 'acesso_negado', quando: em(iso(hoje), 32, 5), quem: 'Lucas Teixeira', papel: 'contribuidor', bu: null, meta: null, card: null, secao: null, detalhe: 'tentou abrir a Configuração do ciclo' });
  ev.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
  return { ciclo: base.ciclo, eventos: ev, bus: base.ciclo.bus, metas: [META_RESULTADO_COO].concat(METAS_BU).map((m) => ({ numero: m.numero, titulo: m.titulo })) };
}

// ── T06 Versões (§7.2): cada submissão gera uma versão imutável (snapshot das 7 seções). Rascunho não gera versão. ──
function versoesExemplo(codigo, hoje = new Date()) {
  const gc = goalCardExemplo(codigo, hoje);
  if (!gc) return null;
  const base = { ciclo: gc.ciclo, card: gc.card, bu: gc.bu, meta: gc.meta, estado: gc.estado, versaoAtual: gc.versao, contribuidor: gc.submetidoPor };
  if (!gc.versao) return { ...base, versoes: [], oficial: null };
  const n = gc.meta.numero, k = (n + gc.bu.sigla.length) % PESSOAS.length;
  const autor = gc.submetidoPor || PESSOAS[k], aprov = APROVADORES[(n + gc.bu.sigla.length) % APROVADORES.length];
  const p = gc.desde.split('-').map(Number), d0 = new Date(p[0], p[1] - 1, p[2]);
  const quando = (dias, h) => `${iso(somarDiasUteis(d0, -dias))}T${h}:00`;
  const atual = JSON.parse(JSON.stringify(gc.secoes));
  // No exemplo, a versão atual de um card em revisão/aprovação já tem área e evidência (o rascunho em edição é outro)
  if (!atual.area.area) atual.area = conteudoMeta(n, gc.ciclo.ano).secoes.area;
  if (!atual.evidence) atual.evidence = conteudoMeta(n, gc.ciclo.ano).secoes.evidence;
  const versoes = [];
  if (gc.versao > 1) {
    // v1: régua mais apertada, fórmula preliminar e sem a exceção da BU; devolvida pelo grupo de aprovação
    const v1 = JSON.parse(JSON.stringify(atual));
    const passo = atual.ruler.min > atual.ruler.exc ? -2 : 2;
    v1.ruler = { ...atual.ruler, min: atual.ruler.min + passo };
    v1.formula = atual.formula.includes(' vs budget') ? atual.formula.replace(' vs budget', ' vs plan') : `${atual.formula} (preliminary)`;
    v1.exceptions = { ...atual.exceptions, bu: '' };
    atual.exceptions = { ...atual.exceptions, bu: 'FX effect excluded from the result, as agreed with P&CI.' };
    versoes.push({ versao: 1, quando: quando(9, '10:12'), autor, motivo: 'submissao', secoes: v1,
      decisao: { tipo: 'devolver', quem: aprov, quando: quando(6, '16:48'), secoes: ['ruler', 'formula'], comentario: 'Minimum is too close to the target; review the ruler with the budget sensitivity.' } });
  }
  const dec = { aprovado: 'aprovar', negado: 'negar', em_revisao: 'devolver' }[gc.estado];
  versoes.push({ versao: gc.versao, quando: quando(gc.versao > 1 ? 2 : 3, '09:40'), autor, motivo: gc.versao > 1 ? 'resubmissao' : 'submissao', secoes: atual,
    decisao: dec ? { tipo: dec, quem: aprov, quando: quando(0, '15:20'), secoes: dec === 'devolver' ? ['ruler', 'unit'] : [],
      comentario: dec === 'negar' ? 'Goal outside the cascade agreed with the COO.' : dec === 'devolver' ? 'Use the same unit as the COO scorecard (%).' : '' } : null });
  const oficial = gc.estado === 'aprovado' ? gc.versao : null;
  versoes.forEach((v) => { v.oficial = v.versao === oficial; });
  return { ...base, versoes: versoes.reverse(), oficial };
}

module.exports = { pendenciasExemplo, painelExemplo, desdobramentoExemplo, goalCardExemplo, configuracaoExemplo, actionLogExemplo, versoesExemplo, SECOES, cicloExemplo, somarDiasUteis, iso, areaDaBu, DIRETORES };
