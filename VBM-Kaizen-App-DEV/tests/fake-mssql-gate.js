const tipo = (n) => ({ tipo: n });
const MDM = { ID_USUARIO: 901, NM_USUARIO: "CRISTIAN ARLAN ALVES", CD_MATRICULA: "01181222",
  CD_EMAIL: "membro@vale.com", NM_SITE: "CORPORATIVO", NM_ESTADO: "MG", NM_CIDADE: "Nova Lima", ID_TIPO_USUARIO: 1 };

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    const uma = q.replace(/\s+/g, " ");
    const email = this.inputs.email;
    if (/COLUMN_NAME IN \('DT_ATUALIZACAO', 'DT_CRIACAO'\)/i.test(uma)) return { recordset: [{ COLUMN_NAME: "DT_CRIACAO" }] };
    if (/EH_ADMIN/i.test(uma)) {
      if (email === "membro@vale.com") return { recordset: [{ ID_USUARIO: 901, EH_ADMIN: 0, EH_APROVADOR: 0 }] };
      return { recordset: [] }; // ninguém encontrado -> não-membro
    }
    if (/WHERE CD_EMAIL = @email/i.test(uma)) {
      if (email === "membro@vale.com") return { recordset: [MDM] };
      return { recordset: [] };
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(uma)) return { recordset: [] };
    if (/kzn_mdm_hierarquia/i.test(uma) || /FROM \[ci\]\.\[kzn_\w+\] base/i.test(uma)) {
      return { recordset: [{ ID: 1, NM: "5S", VALOR: "CORPORATIVO", NM_USUARIO: MDM.NM_USUARIO,
        NM_SITE: MDM.NM_SITE, NM_ESTADO: MDM.NM_ESTADO, NM_CIDADE: MDM.NM_CIDADE, ATIVO: true, SG_ATIVO: "S" }] };
    }
    return { recordset: [{ TOTAL: 0 }], rowsAffected: [1] };
  }
}
class ConnectionPool { async connect() { return this; } request() { return new Request(); } }
class Transaction { constructor(p){this.p=p;} async begin(){} async commit(){} async rollback(){} request(){return this.p.request();} }
module.exports = { ConnectionPool, Transaction, Request, MAX: -1,
  Int: tipo("int"), BigInt: tipo("bigint"), Bit: tipo("bit"), Date: tipo("date"),
  DateTime2: tipo("datetime2"), Char: (n)=>tipo("char"+n), VarChar: (n)=>tipo("varchar"+n),
  NVarChar: (n)=>tipo("nvarchar"+n), Decimal: ()=>tipo("decimal") };
