/**
 * Fonte de dados de EXEMPLO, só para os testes automáticos (o app usa aip-goals-banco.js).
 * Mesmo contrato da fonte do banco; as gravações são validadas pelo router e respondidas como simulação.
 */
const ex = require('./dados-exemplo');

// papeisDe(email, hoje) → papéis do usuário; padrão: os do usuário de demonstração (contribuidor de Salobo e admin)
function criarFonteExemplo({ papeisDe = (email, hoje) => ex.pendenciasExemplo(hoje).usuario.papeis } = {}) {
  const painel = (hoje) => {
    const base = ex.painelExemplo(hoje);
    // Editores de cada card (RN-12 na fila de aprovação)
    base.cards.forEach((c) => { const g = ex.goalCardExemplo(c.card, hoje); c.editores = g ? g.editores : []; });
    return base;
  };
  return {
    fonte: 'exemplo', exemplo: true,
    contexto: async (email, hoje) => ({ papeis: papeisDe(email, hoje) || [], quem: 'Usuário Demonstração', nome: 'Usuário Demonstração' }),
    ciclo: async (hoje) => ex.cicloExemplo(hoje),
    painel: async (hoje) => painel(hoje),
    desdobramento: async (hoje) => ex.desdobramentoExemplo(hoje),
    goalCard: async (codigo, hoje) => ex.goalCardExemplo(codigo, hoje),
    versoes: async (codigo, hoje) => ex.versoesExemplo(codigo, hoje),
    actionLog: async (hoje) => ex.actionLogExemplo(hoje),
    configuracao: async (hoje) => ex.configuracaoExemplo(hoje),
    salvarRascunho: async () => ({ simulado: true }),
    submeter: async (card) => ({ simulado: true, estado: 'em_aprovacao', versao: (card.versao || 0) + 1 }),
    reabrir: async () => ({ simulado: true, estado: 'rascunho' }),
    decidir: async (card, corpo) => ({ simulado: true, estado: { aprovar: 'aprovado', devolver: 'em_revisao' }[corpo.decisao] }),
    comentar: async (card, secao, texto, ctx) => ({ id: `${card.card}-n${Date.now()}`, secao, autor: ctx.nome, papel: 'aprovador', quando: new Date().toISOString().slice(0, 10), texto, respostas: [] }),
    salvarConfiguracao: async () => ({ simulado: true }),
    acaoCiclo: async (acao) => ({ simulado: true, ...(acao === 'novo' ? { novoCiclo: { id: 'AIP-2028', nome: 'AIP 2028', ano: 2028 } } : {}) }),
  };
}

module.exports = { criarFonteExemplo };
