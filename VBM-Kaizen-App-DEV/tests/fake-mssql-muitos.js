/**
 * Dublê com POPULAÇÃO GRANDE e desigual — 50 aprovadores em 6 unidades,
 * de 2 (MANITOBA) a 15 (CORPORATIVO). É essa desigualdade que produz o
 * vazio do print: com 2 e 3 aprovadores, "sobrou espaço" e "está certo"
 * seriam indistinguíveis.
 */
const dados = require("./dados-muitos.json");
const tipo = (n) => ({ tipo: n });
const MDM = dados.mdm, APR = dados.apr;
const pessoa = (a) => MDM.find((m) => String(m.ID_USUARIO) === String(a.CD_MATRICULA)) || null;

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    if (/EH_ADMIN/i.test(q)) return { recordset: [{ ID_USUARIO: MDM[0].ID_USUARIO, EH_ADMIN: 1, EH_APROVADOR: 1 }] };
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(q)) return { recordset: [{ TAM: 500, OK: 1 }] };
    if (/WHERE CD_EMAIL = @email/i.test(q)) {
      const p = MDM.find((m) => m.CD_EMAIL === this.inputs.email);
      return { recordset: p ? [p] : [MDM[0]] };
    }
    if (/kzn_aprovador\]\s+a/i.test(q) && /OUTER APPLY/i.test(q)) {
      const linhas = APR.map((a) => {
        const m = pessoa(a);
        return { ID_APROVADOR: a.ID_APROVADOR, CD_MATRICULA: a.CD_MATRICULA, SG_ATIVO: "S",
                 DT_ATUALIZACAO: new Date("2026-09-01T12:00:00Z"), ID_CONCEDENTE: 100,
                 ID_USUARIO: m && m.ID_USUARIO, NM_USUARIO: m && m.NM_USUARIO,
                 DS_EMAIL: m && m.CD_EMAIL, NM_POSICAO: m && m.NM_POSICAO,
                 NM_ESTADO: m && m.NM_ESTADO, NM_CIDADE: m && m.NM_CIDADE, NM_SITE: m && m.NM_SITE };
      });
      linhas.sort((x, y) => String(x.NM_SITE).localeCompare(String(y.NM_SITE)) ||
                            String(x.NM_USUARIO).localeCompare(String(y.NM_USUARIO)) ||
                            x.ID_APROVADOR - y.ID_APROVADOR);
      return { recordset: linhas };
    }
    if (/kzn_mdm_hierarquia/i.test(q)) return { recordset: [MDM[0]] };
    return { recordset: [], rowsAffected: [1] };
  }
}
class ConnectionPool { async connect() { return this; } request() { return new Request(); } }
class Transaction { constructor(p){this.p=p;} async begin(){} async commit(){} async rollback(){} request(){return this.p.request();} }
module.exports = { ConnectionPool, Transaction, Request, MAX: -1,
  Int: tipo("int"), BigInt: tipo("bigint"), Bit: tipo("bit"), Date: tipo("date"),
  DateTime2: tipo("datetime2"), Char: (n)=>tipo("char"+n), VarChar: (n)=>tipo("varchar"+n),
  NVarChar: (n)=>tipo("nvarchar"+n), Decimal: ()=>tipo("decimal") };
