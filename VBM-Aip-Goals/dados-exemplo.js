/**
 * AIP Goals — dados de exemplo da T01 (Minhas pendências).
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

function pendenciasExemplo(hoje = new Date()) {
  const desde = (n) => iso(somarDiasUteis(hoje, -n));
  const prazo = (n) => iso(somarDiasUteis(hoje, n));
  const ano = hoje.getMonth() >= 9 ? hoje.getFullYear() + 1 : hoje.getFullYear();

  return {
    ciclo: {
      id: `AIP-${ano}`, nome: `AIP ${ano}`, ano,
      // Jornada do ciclo (janelas configuradas em T11). etapaAtual = a janela aberta hoje.
      etapaAtual: 'proposta',
      etapas: [
        { id: 'desdobramento', fim: desde(15) },
        { id: 'proposta', fim: prazo(8) },
        { id: 'calibracao', fim: prazo(18) },
        { id: 'oficial', fim: prazo(23) },
      ],
    },
    usuario: {
      // Papéis por BU e por ciclo (AC-02): a mesma pessoa pode ter papéis diferentes.
      papeis: [
        { papel: 'ponto_focal', bu: 'Salobo' },
        { papel: 'ponto_focal', bu: 'Sossego' },
        { papel: 'diretor', bu: 'VNL' },
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

module.exports = { pendenciasExemplo, somarDiasUteis, iso };
