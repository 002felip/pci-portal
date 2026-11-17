/**
 * AIP Goals — dados de exemplo da T00 (Início), T01 (Minhas pendências) e T02 (Painel do ciclo).
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
      { id: 'desdobramento', fim: desde(15) },
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
        id: 'p-101', tipo: 'decidir', card: 'GC-VNL-03', secao: null,
        bu: { sigla: 'VNL', pais: 'Canadá' },
        meta: { numero: 3, titulo: 'Finished nickel production' },
        estado: 'em_aprovacao', nivel: { atual: 1, total: 2, nome: 'Diretor da BU' }, versao: 2,
        desde: desde(5), prazo: prazo(2),
        detalhe: 'Resubmissão: seções Ruler e Evidence alteradas desde a v1',
      },
      {
        id: 'p-102', tipo: 'preencher', card: 'GC-SAL-01', secao: null,
        bu: { sigla: 'Salobo', pais: 'Brasil' },
        meta: { numero: 1, titulo: 'Copper concentrate production' },
        estado: 'rascunho', nivel: null, versao: null,
        desde: desde(2), prazo: prazo(6),
        detalhe: '4 de 7 seções preenchidas',
      },
      {
        id: 'p-103', tipo: 'preencher', card: 'GC-SSG-04', secao: 'ruler',
        bu: { sigla: 'Sossego', pais: 'Brasil' },
        meta: { numero: 4, titulo: 'Plant physical availability' },
        estado: 'em_revisao', nivel: null, versao: 1,
        desde: desde(4), prazo: prazo(1),
        detalhe: 'Devolvido pelo grupo P&CI/COO: ajustar Ruler e Unit of Measurement',
      },
      {
        id: 'p-104', tipo: 'comentario', card: 'GC-SAL-02', secao: 'formula',
        bu: { sigla: 'Salobo', pais: 'Brasil' },
        meta: { numero: 2, titulo: 'C1 cash cost reduction' },
        estado: 'em_aprovacao', nivel: { atual: 2, total: 2, nome: 'P&CI/COO' }, versao: 1,
        desde: desde(1), prazo: null,
        detalhe: '“Incluir o efeito do câmbio na fórmula?” — comentário na seção Calculation Formula',
      },
      {
        id: 'p-105', tipo: 'acao', card: 'GC-SSG-02', secao: 'evidence',
        bu: { sigla: 'Sossego', pais: 'Brasil' },
        meta: { numero: 2, titulo: 'Predictive maintenance program rollout' },
        estado: 'em_aprovacao', nivel: { atual: 1, total: 2, nome: 'Diretor da BU' }, versao: 1,
        desde: desde(6), prazo: prazo(-1),
        detalhe: 'Anexar o cronograma dos 8 marcos com as datas previstas',
      },
      {
        id: 'p-106', tipo: 'decidir', card: 'GC-VNL-05', secao: null,
        bu: { sigla: 'VNL', pais: 'Canadá' },
        meta: { numero: 5, titulo: 'TRIF — recordable injury frequency' },
        estado: 'em_aprovacao', nivel: { atual: 1, total: 2, nome: 'Diretor da BU' }, versao: 1,
        desde: desde(1), prazo: prazo(4),
        detalhe: 'Primeira submissão',
      },
      {
        id: 'p-107', tipo: 'acao', card: 'GC-SAL-01', secao: 'evidence',
        bu: { sigla: 'Salobo', pais: 'Brasil' },
        meta: { numero: 1, titulo: 'Copper concentrate production' },
        estado: 'rascunho', nivel: null, versao: null,
        desde: desde(0), prazo: prazo(2),
        detalhe: 'Confirmar com a Geologia a fonte do dado de produção',
      },
    ],
  };
}

// ── T02 Painel do ciclo: Goal Cards de todas as BUs do ciclo ──
// Gerador determinístico (mesma semente → mesmos cards), para o exemplo não mudar a cada leitura.
const METAS_EXEMPLO = [
  ['Finished nickel production', 'formula'], ['Copper concentrate production', 'formula'], ['C1 cash cost reduction', 'formula'],
  ['Plant physical availability', 'formula'], ['TRIF — recordable injury frequency', 'formula'], ['Predictive maintenance program rollout', 'marcos'],
  ['Metallurgical recovery', 'formula'], ['Tailings dam safety plan', 'marcos'], ['Energy intensity reduction', 'formula'],
];
// Distribuição de situação na etapa de proposta: muitos em rascunho, alguns já em aprovação ou devolvidos.
const SITUACOES = ['rascunho', 'rascunho', 'rascunho', 'em_aprovacao', 'em_aprovacao', 'em_aprovacao', 'em_revisao', 'aprovado', 'aprovado', 'negado'];
const QTD_METAS = { OP: 5, Salobo: 7, Sossego: 6, ON: 8, VNL: 7, UK: 4, JPN: 4 };

function painelExemplo(hoje = new Date()) {
  const ciclo = cicloExemplo(hoje);
  let semente = 20271;
  const sorte = () => { semente = (semente * 48271) % 2147483647; return semente / 2147483647; };
  const cards = [];
  ciclo.bus.forEach((bu, b) => {
    const n = QTD_METAS[bu.sigla] || 5;
    for (let i = 0; i < n; i++) {
      const [titulo, tipo] = METAS_EXEMPLO[(b * 2 + i) % METAS_EXEMPLO.length];
      const estado = SITUACOES[Math.floor(sorte() * SITUACOES.length)];
      const nivel = estado === 'em_aprovacao'
        ? (sorte() < 0.6 ? { atual: 1, total: 2, nome: 'Diretor da BU' } : { atual: 2, total: 2, nome: 'P&CI/COO' })
        : null;
      const versao = estado === 'rascunho' ? null : 1 + Math.floor(sorte() * 2);
      cards.push({
        card: `GC-${bu.sigla.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
        bu: { sigla: bu.sigla, pais: bu.pais },
        meta: { numero: i + 1, titulo, tipo },
        estado, nivel, versao,
        // Desde quando o card está na situação (ou no nível) atual
        desde: iso(somarDiasUteis(hoje, -Math.floor(sorte() * (estado === 'em_aprovacao' ? 8 : 12)))),
      });
    }
  });
  return { ciclo, parametros: { diasParado: 3 }, cards };
}

module.exports = { pendenciasExemplo, painelExemplo, cicloExemplo, somarDiasUteis, iso };
