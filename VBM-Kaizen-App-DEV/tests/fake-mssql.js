/**
 * Dublê do mssql para os testes de e-mail.
 * Libera o gate, responde ao fluxo de DECISÃO (aprovar) e grava os
 * INSERTs em kzn_email_log para o teste conferir a auditoria.
 */
const fs = require("fs");
const LOG = process.env.FAKE_MSSQL_LOG || "/tmp/email-log.jsonl";
const tipo = (n) => ({ tipo: n });

const KAIZEN = {
  ID_KAIZEN: 501, NM_KAIZEN: "Reducao de refugo na linha 3",
  DS_MOTIVO: null, ID_STATUS: 1, DT_ATUALIZACAO: new Date("2026-09-15T14:30:00Z"),
  NM_AUTOR: "Maria Souza", EMAIL_AUTOR: "maria.souza@vale.com",
  NM_SITE: "Sossego", NM_CIDADE: "Canaa dos Carajas", NM_ESTADO: "PA",
  NM_APROVADOR: "Joao Lima", EMAIL_APROVADOR: "joao.lima@vale.com",
  NM_ACAO: "Joao Lima",
  CATEGORIA_PT: "Qualidade", CATEGORIA_EN: "Quality",
  STATUS_PT: "Aprovado", STATUS_EN: "Approved",
};

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    if (/kzn_email_log/i.test(q)) {
      fs.appendFileSync(LOG, JSON.stringify({ query: q, inputs: this.inputs }) + "\n");
      return { recordset: [], rowsAffected: [1] };
    }
    if (/EH_ADMIN/i.test(q)) {
      return { recordset: [{ ID_USUARIO: 100, EH_ADMIN: 1, EH_APROVADOR: 1 }] };
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(q)) {
      return { recordset: [{ TAM: 500 }] };
    }
    // Catálogo de status (carregarCatalogoStatus).
    if (/SELECT ID_STATUS, NM_STATUS FROM/i.test(q)) {
      return { recordset: [
        { ID_STATUS: 1, NM_STATUS: "Aguardando aprovação" },
        { ID_STATUS: 2, NM_STATUS: "Revisado" },
        { ID_STATUS: 3, NM_STATUS: "Aprovado" },
        { ID_STATUS: 4, NM_STATUS: "Reprovado" },
        { ID_STATUS: 5, NM_STATUS: "Solicitado alterações" },
      ] };
    }
    // situacaoDaDecisao.
    if (/EH_APROVADOR = CASE/i.test(q)) {
      return { recordset: [{ ID_STATUS: 1, EH_APROVADOR: 1 }] };
    }
    // dadosDoComunicado (o SELECT grande do Kaizen).
    if (/NM_AUTOR/i.test(q)) {
      return { recordset: [KAIZEN] };
    }
    // Equipe do Kaizen.
    if (/kzn_membros_equipe/i.test(q)) {
      return { recordset: [{ CD_EMAIL: "equipe1@vale.com" }, { CD_EMAIL: "equipe2@vale.com" }] };
    }
    if (/kzn_mdm_hierarquia/i.test(q)) {
      return { recordset: [{ ID_USUARIO: 100, NM_USUARIO: "Admin Um", CD_MATRICULA: "000100", CD_EMAIL: "admin@vale.com", NM_POSICAO: "Analista" }] };
    }
    return { recordset: [], rowsAffected: [1] };
  }
}
class ConnectionPool {
  async connect() { return this; }
  request() { return new Request(); }
}
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
