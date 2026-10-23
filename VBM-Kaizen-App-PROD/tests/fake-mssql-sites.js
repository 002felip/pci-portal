/**
 * Dublê do mssql com POPULAÇÃO POR SITE.
 *
 * O dublê original responde ao fluxo de e-mail e devolve uma pessoa só —
 * com ele, "a lista veio filtrada" e "a lista veio vazia" são
 * indistinguíveis. Aqui existem três unidades e 8 aprovadores, e o dublê
 * emula o CONTRATO da rota (recortar pelo NM_SITE do líder), não o SQL.
 * A sintaxe do comando é conferida à parte com sqlglot, e a semântica do
 * recorte é modelada em sqlite — são três perguntas diferentes.
 */
const fs = require("fs");
const LOG = process.env.FAKE_MSSQL_LOG || "/tmp/sql-sites.txt";
const tipo = (n) => ({ tipo: n });

// ── MDM ────────────────────────────────────────────────────────────
// ID_USUARIO, nome, e-mail, matrícula, cargo, site.
// O 907 existe de propósito SEM site: é o caso que zeraria a lista.
const MDM = [
  { ID_USUARIO: 901, NM_USUARIO: "Cristian Arlan Alves", CD_EMAIL: "cristian.alves@vale.com", CD_MATRICULA: "01181222", NM_POSICAO: "ANL PROGRAMACAO INTEGRADA MS", NM_SITE: "CORPORATIVO", NM_ESTADO: "MG", NM_CIDADE: "Nova Lima", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 902, NM_USUARIO: "Ana Beatriz Morais Santos", CD_EMAIL: "ana.santos5@vale.com", CD_MATRICULA: "00000902", NM_POSICAO: "AUX TEC MANUTENCAO II", NM_SITE: "CORPORATIVO", NM_ESTADO: "MG", NM_CIDADE: "Nova Lima", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 903, NM_USUARIO: "Barbara Laya Trindade", CD_EMAIL: "barbara.trindade@vale.com", CD_MATRICULA: "00000903", NM_POSICAO: "ANL OPERACIONAL PLENO", NM_SITE: "CORPORATIVO", NM_ESTADO: "MG", NM_CIDADE: "Nova Lima", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 904, NM_USUARIO: "Caio Henrique Botton Fogliarine", CD_EMAIL: "caio.fogliarine@vale.com", CD_MATRICULA: "00000904", NM_POSICAO: "ANL CONTRATOS SR", NM_SITE: "SALOBO", NM_ESTADO: "PA", NM_CIDADE: "Maraba", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 905, NM_USUARIO: "Camila da Silva Belfort", CD_EMAIL: "camila.belfort@vale.com", CD_MATRICULA: "00000905", NM_POSICAO: "ANL ARMAZEM E ESTOQUE", NM_SITE: "SALOBO", NM_ESTADO: "PA", NM_CIDADE: "Maraba", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 906, NM_USUARIO: "Cassia Amerces de Moura", CD_EMAIL: "cassia.moura@vale.com", CD_MATRICULA: "00000906", NM_POSICAO: "ANL OPERACIONAL MASTER", NM_SITE: "SOSSEGO", NM_ESTADO: "PA", NM_CIDADE: "Canaa dos Carajas", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 907, NM_USUARIO: "Cerith Richard Gill", CD_EMAIL: "cerith.gill@vale.com", CD_MATRICULA: "00000907", NM_POSICAO: "SR ANLST, OPS EXCELLENCE", NM_SITE: null, NM_ESTADO: "ON", NM_CIDADE: "Sudbury", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 908, NM_USUARIO: "Alanna Oliveira Santos de Sousa", CD_EMAIL: "alanna.sousa@vale.com", CD_MATRICULA: "00000908", NM_POSICAO: "TECNICO PROCESSO II", NM_SITE: "SOSSEGO", NM_ESTADO: "PA", NM_CIDADE: "Canaa dos Carajas", ID_TIPO_USUARIO: 1 },
  // Líderes que NÃO são aprovadores — servem só para o recorte.
  { ID_USUARIO: 950, NM_USUARIO: "Lider Salobo", CD_EMAIL: "lider.salobo@vale.com", CD_MATRICULA: "00000950", NM_POSICAO: "GERENTE", NM_SITE: "SALOBO", NM_ESTADO: "PA", NM_CIDADE: "Maraba", ID_TIPO_USUARIO: 1 },
  { ID_USUARIO: 951, NM_USUARIO: "Lider Sem Site", CD_EMAIL: "lider.semsite@vale.com", CD_MATRICULA: "00000951", NM_POSICAO: "GERENTE", NM_SITE: null, NM_ESTADO: "ON", NM_CIDADE: "Sudbury", ID_TIPO_USUARIO: 1 },
];
// A PK do MDM é composta: a mesma pessoa aparece em mais de um tipo. Esta
// linha duplicada existe para o TOP(1) sem ORDER BY doer se alguém tirar a
// ordenação — o site dela é DIFERENTE de propósito.
MDM.push({ ...MDM[0], ID_TIPO_USUARIO: 3, NM_SITE: "SITE ERRADO", CD_MATRICULA: "99999999" });

// kzn_aprovador: CD_MATRICULA guardando o ID_USUARIO (como em produção).
const APROVADORES = [901, 902, 903, 904, 905, 906, 907, 908].map((id, i) => ({
  ID_APROVADOR: i + 1, ID_USUARIO: 100, CD_MATRICULA: String(id), SG_ATIVO: "S",
  DT_ATUALIZACAO: new Date("2026-09-01T12:00:00Z"),
}));

function pessoaDoAprovador(a) {
  // Mesma prioridade do PESSOA_DO_APROVADOR/ORDEM_... do servidor:
  // matrícula, depois ID_USUARIO vindo em CD_MATRICULA; desempate por
  // ID_TIPO_USUARIO.
  const cands = MDM.filter((m) =>
    String(m.CD_MATRICULA) === String(a.CD_MATRICULA) ||
    String(m.ID_USUARIO) === String(a.CD_MATRICULA));
  cands.sort((x, y) =>
    (String(x.CD_MATRICULA) === String(a.CD_MATRICULA) ? 0 : 1) -
    (String(y.CD_MATRICULA) === String(a.CD_MATRICULA) ? 0 : 1) ||
    x.ID_TIPO_USUARIO - y.ID_TIPO_USUARIO);
  return cands[0] || null;
}
function siteDoUsuario(id) {
  const linhas = MDM.filter((m) => m.ID_USUARIO === Number(id))
    .sort((a, b) => a.ID_TIPO_USUARIO - b.ID_TIPO_USUARIO);
  return linhas.length ? linhas[0].NM_SITE : null;
}

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    try { fs.appendFileSync(LOG, "\n/*=== QUERY ===*/\n" + q + "\n"); } catch (e) {}

    if (/EH_ADMIN/i.test(q)) {
      return { recordset: [{ ID_USUARIO: 901, EH_ADMIN: 1, EH_APROVADOR: 1 }] };
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(q)) return { recordset: [{ TAM: 500, OK: 1 }] };

    // buscarMdmPorEmail (usado por idUsuarioLogado quando ?lider=logado).
    if (/WHERE CD_EMAIL = @email/i.test(q)) {
      const p = MDM.find((m) => m.CD_EMAIL === this.inputs.email);
      return { recordset: p ? [p] : [] };
    }

    // GET /api/aprovadores — a consulta desta correção.
    if (/kzn_aprovador\]\s+a/i.test(q) && /OUTER APPLY/i.test(q)) {
      const recorta = /NM_SITE\s*=\s*\(SELECT TOP \(1\) s\.NM_SITE/i.test(q);
      const siteLider = recorta ? siteDoUsuario(this.inputs.idLider) : undefined;
      let linhas = APROVADORES.map((a) => {
        const m = pessoaDoAprovador(a);
        return {
          ID_APROVADOR: a.ID_APROVADOR, CD_MATRICULA: a.CD_MATRICULA,
          SG_ATIVO: a.SG_ATIVO, DT_ATUALIZACAO: a.DT_ATUALIZACAO,
          ID_CONCEDENTE: a.ID_USUARIO,
          ID_USUARIO: m && m.ID_USUARIO, NM_USUARIO: m && m.NM_USUARIO,
          DS_EMAIL: m && m.CD_EMAIL, NM_POSICAO: m && m.NM_POSICAO,
          NM_ESTADO: m && m.NM_ESTADO, NM_CIDADE: m && m.NM_CIDADE,
          NM_SITE: m ? m.NM_SITE : null,
          ...(recorta ? { NM_SITE_LIDER: siteLider } : {}),
        };
      });
      // A regra do servidor: site do líder nulo => sem recorte.
      if (recorta && siteLider != null) linhas = linhas.filter((l) => l.NM_SITE === siteLider);
      linhas.sort((a, b) =>
        String(a.NM_SITE || "").localeCompare(String(b.NM_SITE || "")) ||
        String(a.NM_USUARIO || "").localeCompare(String(b.NM_USUARIO || "")) ||
        a.ID_APROVADOR - b.ID_APROVADOR);
      return { recordset: linhas };
    }

    // Busca de pessoas no MDM (campo Líder do Projeto).
    if (/FROM \[ci\]\.\[kzn_mdm_hierarquia\]\s*$/im.test(q) || /NM_USUARIO LIKE @termo/i.test(q)) {
      const termo = String(this.inputs.termo || "").replace(/%/g, "").toLowerCase();
      return { recordset: MDM.filter((m) =>
        m.ID_TIPO_USUARIO === 1 && String(m.NM_USUARIO).toLowerCase().indexOf(termo) === 0) };
    }
    if (/kzn_mdm_hierarquia/i.test(q)) {
      return { recordset: [MDM[0]] };
    }
    return { recordset: [], rowsAffected: [1] };
  }
}
class ConnectionPool { async connect() { return this; } request() { return new Request(); } }
class Transaction {
  constructor(p) { this.p = p; }
  async begin() {} async commit() {} async rollback() {}
  request() { return this.p.request(); }
}
module.exports = {
  ConnectionPool, Transaction, Request,
  MAX: -1,
  Int: tipo("int"), BigInt: tipo("bigint"), Bit: tipo("bit"), Date: tipo("date"),
  DateTime2: tipo("datetime2"), Char: (n) => tipo("char" + n),
  VarChar: (n) => tipo("varchar" + n), NVarChar: (n) => tipo("nvarchar" + n),
  Decimal: () => tipo("decimal"),
};
