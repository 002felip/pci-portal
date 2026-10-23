/**
 * Dublê dedicado à Atividade "lixeira do Kaizen" (biblioteca.html +
 * DELETE /api/kaizens/:id). Mantém uma lista MUTÁVEL de Kaizens em
 * memória — a exclusão de verdade remove da lista, e uma nova consulta
 * (lista/resumo) já reflete a remoção, do mesmo jeito que o banco real
 * refletiria. Identidade varia por e-mail (X-Forwarded-Email):
 *   dono@vale.com  -> ID_USUARIO 901, não-admin (dono dos KZN 601/604)
 *   outro@vale.com -> ID_USUARIO 902, não-admin (dono do KZN 603, não é
 *                     dono de nenhum outro)
 *   admin@vale.com -> ID_USUARIO 100, admin
 */
const tipo = (n) => ({ tipo: n });

const CATALOGO_STATUS = [
  { ID_STATUS: 1, NM_STATUS: "Aguardando aprovação" },
  { ID_STATUS: 2, NM_STATUS: "Revisado" },
  { ID_STATUS: 3, NM_STATUS: "Aprovado" },
  { ID_STATUS: 4, NM_STATUS: "Reprovado" },
  { ID_STATUS: 5, NM_STATUS: "Solicitado alterações" },
];

// LINHAS mutável: DELETE remove daqui, GET sempre lê o estado atual.
let LINHAS = [
  { ID_KAIZEN: 601, NM_KAIZEN: "Postura de EPI na oficina", ID_STATUS: 1, ID_USUARIO_CADASTRO: 901, ID_USUARIO_LIDER: 901 },
  { ID_KAIZEN: 602, NM_KAIZEN: "Kaizen ja aprovado", ID_STATUS: 3, ID_USUARIO_CADASTRO: 901, ID_USUARIO_LIDER: 901 },
  { ID_KAIZEN: 603, NM_KAIZEN: "Kaizen do outro usuario", ID_STATUS: 5, ID_USUARIO_CADASTRO: 902, ID_USUARIO_LIDER: 902 },
  { ID_KAIZEN: 604, NM_KAIZEN: "Kaizen revisado do dono", ID_STATUS: 2, ID_USUARIO_CADASTRO: 901, ID_USUARIO_LIDER: 901 },
  { ID_KAIZEN: 605, NM_KAIZEN: "Kaizen rejeitado", ID_STATUS: 4, ID_USUARIO_CADASTRO: 901, ID_USUARIO_LIDER: 901 },
];

const IDENTIDADES = {
  "dono@vale.com": { ID_USUARIO: 901, EH_ADMIN: 0, EH_APROVADOR: 0, NM_USUARIO: "Dono Um" },
  "outro@vale.com": { ID_USUARIO: 902, EH_ADMIN: 0, EH_APROVADOR: 0, NM_USUARIO: "Outro Usuario" },
  "admin@vale.com": { ID_USUARIO: 100, EH_ADMIN: 1, EH_APROVADOR: 1, NM_USUARIO: "Admin Um" },
};

function statusIdPorNome(nomeSemAcento) {
  const semAcento = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const item = CATALOGO_STATUS.find((s) => semAcento(s.NM_STATUS) === nomeSemAcento);
  return item ? item.ID_STATUS : null;
}

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    const uma = q.replace(/\s+/g, " ");
    const email = this.inputs.email;

    if (/COLUMN_NAME IN \('DT_ATUALIZACAO', 'DT_CRIACAO'\)/i.test(uma)) return { recordset: [] };
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(uma)) return { recordset: [] };

    // Identidade (perfilDeAcesso / idUsuarioLogado).
    if (/EH_ADMIN/i.test(uma)) {
      const id = IDENTIDADES[email];
      return { recordset: id ? [id] : [] };
    }
    if (/WHERE CD_EMAIL = @email/i.test(uma)) {
      const id = IDENTIDADES[email];
      return { recordset: id ? [{ ID_USUARIO: id.ID_USUARIO, NM_USUARIO: id.NM_USUARIO, CD_MATRICULA: String(id.ID_USUARIO), CD_EMAIL: email, NM_POSICAO: "Analista" }] : [] };
    }

    // Catálogo de status (carregarCatalogoStatus).
    if (/SELECT ID_STATUS, NM_STATUS FROM/i.test(uma)) return { recordset: CATALOGO_STATUS };

    // GET /api/kaizens — listagem paginada.
    if (/OFFSET @deslocamento ROWS/i.test(uma)) {
      const ehAdmin = this.inputs.ehAdmin === 1;
      const idUsuarioLogado = this.inputs.idUsuarioLogado;
      const statusAprovado = this.inputs.statusAprovado;
      const statusReprovado = this.inputs.statusReprovado;
      const linhas = LINHAS.map((k) => {
        const podeExcluirPerm = ehAdmin || k.ID_USUARIO_CADASTRO === idUsuarioLogado;
        const statusExcluivel = k.ID_STATUS !== statusAprovado && k.ID_STATUS !== statusReprovado;
        return {
          ID_KAIZEN: k.ID_KAIZEN, NM_KAIZEN: k.NM_KAIZEN, ID_STATUS: k.ID_STATUS,
          NM_STATUS: CATALOGO_STATUS.find((s) => s.ID_STATUS === k.ID_STATUS).NM_STATUS,
          DS_STATUS: null,
          DT_CRIACAO: new Date("2026-09-01T12:00:00Z"), DT_CONCLUSAO: null,
          ID_CATEGORIA: 1, NM_CATEGORIA: "5S",
          NM_LIDER: "Lider Teste", NM_ESTADO: "MG", NM_CIDADE: "Nova Lima", NM_SITE: "CORPORATIVO",
          URL_IMG_ANTES: null, URL_IMG_DEPOIS: null,
          ORIGEM: "A",
          DESPERDICIOS: null,
          PODE_EDITAR: podeExcluirPerm ? 1 : 0, STATUS_EDITAVEL: 0,
          PODE_EXCLUIR: podeExcluirPerm ? 1 : 0,
          STATUS_EXCLUIVEL: statusExcluivel ? 1 : 0,
        };
      });
      return { recordset: linhas };
    }
    if (/SELECT COUNT\(\*\) AS TOTAL/i.test(uma)) return { recordset: [{ TOTAL: LINHAS.length }] };

    // GET /kaizens/resumo.
    if (/YEAR\(p?\.?DT_ATUALIZACAO\) AS ANO/i.test(uma)) return { recordset: [{ ANO: 2026, QTD: LINHAS.length }] };
    if (/GROUP BY p\.ID_STATUS/i.test(uma)) {
      const porStatus = new Map();
      LINHAS.forEach((k) => porStatus.set(k.ID_STATUS, (porStatus.get(k.ID_STATUS) || 0) + 1));
      return { recordset: [...porStatus].map(([ID_STATUS, QTD]) => ({ ID_STATUS, QTD })) };
    }
    if (/FROM .*kzn_status.* st/i.test(uma) || /st\.ID_IDIOMA = @idIdioma/i.test(uma)) {
      return { recordset: CATALOGO_STATUS.map((s) => ({
        ID_STATUS: s.ID_STATUS, NM_STATUS: s.NM_STATUS,
        QTD: LINHAS.filter((k) => k.ID_STATUS === s.ID_STATUS).length,
      })) };
    }

    // DELETE /kaizens/:id — checagem prévia (podeExcluirKaizen).
    if (/PODE_EXCLUIR = /i.test(uma) && /STATUS_EXCLUIVEL = /i.test(uma) && !/OFFSET/i.test(uma)) {
      const idKaizen = this.inputs.idKaizen;
      const k = LINHAS.find((x) => x.ID_KAIZEN === idKaizen);
      if (!k) return { recordset: [] };
      const ehAdmin = this.inputs.ehAdmin === 1;
      const idUsuarioLogado = this.inputs.idUsuarioLogado;
      const podeExcluir = ehAdmin || k.ID_USUARIO_CADASTRO === idUsuarioLogado;
      const statusExcluivel = k.ID_STATUS !== this.inputs.statusAprovado && k.ID_STATUS !== this.inputs.statusReprovado;
      return { recordset: [{ PODE_EXCLUIR: podeExcluir ? 1 : 0, STATUS_EXCLUIVEL: statusExcluivel ? 1 : 0, NM_KAIZEN: k.NM_KAIZEN }] };
    }

    // DELETE FROM <tabela> WHERE ID_KAIZEN = @idKaizen — filhos e cabeçalho.
    if (/^DELETE FROM/i.test(uma.trim())) {
      const idKaizen = this.inputs.idKaizen;
      if (/kzn_pedravisaoconsolidada/i.test(uma)) {
        const antes = LINHAS.length;
        LINHAS = LINHAS.filter((k) => k.ID_KAIZEN !== idKaizen);
        return { recordset: [], rowsAffected: [antes - LINHAS.length] };
      }
      return { recordset: [], rowsAffected: [1] }; // filhos (membros/desperdicio/resultado)
    }

    if (/kzn_mdm_hierarquia/i.test(uma)) return { recordset: [] };
    return { recordset: [], rowsAffected: [1] };
  }
}
class ConnectionPool { async connect() { return this; } request() { return new Request(); } }
class Transaction { constructor(p) { this.p = p; } async begin() {} async commit() {} async rollback() {} request() { return this.p.request(); } }
module.exports = {
  ConnectionPool, Transaction, Request, MAX: -1,
  Int: tipo("int"), BigInt: tipo("bigint"), Bit: tipo("bit"), Date: tipo("date"),
  DateTime2: tipo("datetime2"), Char: (n) => tipo("char" + n),
  VarChar: (n) => tipo("varchar" + n), NVarChar: (n) => tipo("nvarchar" + n),
  Decimal: () => tipo("decimal"),
  _statusIdPorNome: statusIdPorNome,
};
