/**
 * Dublê do mssql para o Dashboard (tests/teste-dashboard.js).
 *
 * Reconhece as consultas de dashboard-kaizen.js pelo texto e devolve uma
 * base fictícia com ~12.600 Kaizens (atual + histórico), hierarquia com
 * os "lixos" reais da carga ('NULL', 'N.A') e pessoas inventadas. Grava
 * o texto de cada SQL em FAKE_MSSQL_LOG para o teste conferir a
 * consulta (UNION ALL, tabelas certas, nada de coluna inexistente).
 *
 * FAKE_SEM_HIST_HIER=1 simula kzn_hist_kaizen_hierarquia ausente.
 */
const fs = require("fs");
const LOG = process.env.FAKE_MSSQL_LOG || "/tmp/dashboard-sql.jsonl";
const tipo = (n) => ({ tipo: n });

function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COO = "CHIEF OPERATING OFFICER - BM - FULANO DE TAL";
const LEAVES = [
  [COO, "DIRETOR DE OPERACOES - SALOBO - DIRETOR A", "DIR MINING SALOBO - HEAD A", "MANUTENÇÃO MINA - GERENTE A", "SUP CONTR OPER INFRA MINA - SUP A", "NULL", 1500],
  [COO, "DIRETOR DE OPERACOES - SALOBO - DIRETOR A", "DIR USINAS SALOBO I/II/IIII - HEAD B", "GER GERAL MANUT USINA SALOBO - GERENTE B", "GER MANUTENC ELETRICA SALOBO - GERENTE C", "COORD INSP CONFIAB - COORD A", 1400],
  [COO, "DIR OPER SOSSEGO BM - DIRETOR B", "GER GERAL OPERACOES SOSSEGO - HEAD C", "GER MAN USINA ALTA TENS SOSSEG - GERENTE D", "SUP MANUT PREVENTIVA - SUP B", "NULL", 1800],
  [COO, "DIR, VNL & INTERNATIONAL REFIN - DIRETOR C", "GM, LONG HARBOUR OPS - HEAD D", "MGR, PORT & LEACH - MANAGER A", "Superintendent,Production Area - Super A", "Production Area Coach - Coach A", 1600],
  [COO, "DIR, ON OPS - DIRETOR D", "DIR, PROCESSING ON - HEAD E", "N.A", "N.A", "N.A", 600],
  [COO, "DIR OPER ONCA PUMA BM - DIRETOR E", "GER GERAL MAN NIQUEL ONCAPUMA - HEAD F", "GER PCM CONFIABILID ONCA PUMA - GERENTE E", "COORD PLANEJ PROG CONTR MANUT - COORD B", null, 400],
  [COO, "DIR, MANITOBA OPS - DIRETOR F", "MGR, MANITOBA MINES - HEAD G", "SUPERINTENDENT II, PROCESS - SUPER B", "NULL", "NULL", 200],
  ["CHIEF TECHNICAL OFFICER - CTO A", "DIR, EXPLORATION & GEOSCIENCE - DIRETOR G", "HEAD OF BROWNFIELD EXPLORATION - HEAD H", null, null, null, 100],
  ["CHIEF FINANCIAL OFFICER - CFO A", null, null, null, null, null, 120],
  [null, null, null, null, null, null, 300],
];
const SITES = ["SALOBO", "SOSSEGO", "ONCA PUMA", "LONG HARBOUR", "SUDBURY", "THOMPSON", "VOISEY'S BAY"];
const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Larissa", "Lucas", "Mariana", "Paulo", "Renata", "Liam", "Olivia", "Ryan"];
const SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Costa", "Rocha", "Ribeiro", "Walsh", "Murphy", "Reid"];

function gerarBase() {
  const R = rng(20261016);
  const pool = [];
  LEAVES.forEach((l) => { for (let i = 0; i < l[6]; i++) pool.push(l); });
  const pessoa = () => NOMES[Math.floor(R() * NOMES.length)] + " " + SOBRENOMES[Math.floor(R() * SOBRENOMES.length)];
  const lideres = Array.from({ length: 400 }, pessoa);
  const linhas = [];
  let idA = 9000, idH = 1000;
  for (let i = 0; i < pool.length; i++) {
    const hist = R() < 0.55;
    const leaf = pool[Math.floor(R() * pool.length)];
    const ano = hist ? 2019 + Math.floor(R() * 6) : 2025 + Math.floor(R() * 2);
    const mes = 1 + Math.floor(R() * 12), dia = 1 + Math.floor(R() * 28);
    const st = hist ? (R() < 0.93 ? 3 : 4) : [3, 3, 3, 1, 1, 2, 4, 5][Math.floor(R() * 8)];
    const semFoto = R() < 0.03;
    linhas.push({
      ORIGEM: hist ? "H" : "A",
      ID_KAIZEN: hist ? idH++ : idA++,
      ID_STATUS: R() < 0.002 ? null : st,
      ID_CATEGORIA: 1 + Math.floor(R() * 4),
      ID_APROVADOR: 1 + Math.floor(R() * 12),
      DT: `${ano}${String(mes).padStart(2, "0")}${String(dia).padStart(2, "0")}`,
      NM_LIDER: R() < 0.01 ? null : lideres[Math.floor(Math.pow(R(), 2.2) * lideres.length)],
      NM_SITE: SITES[Math.floor(R() * SITES.length)],
      FONTE_HIER: semFoto ? "M" : "F",
      N3: leaf[0], N4: leaf[1], N5: leaf[2], N6: leaf[3], N7: leaf[4], N8: leaf[5],
    });
  }
  return linhas;
}
const BASE = gerarBase();

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    try { fs.appendFileSync(LOG, JSON.stringify({ q, inputs: this.inputs }) + "\n"); } catch (e) {}
    if (/EH_ADMIN/i.test(q)) return { recordset: [{ ID_USUARIO: 100, EH_ADMIN: 1, EH_APROVADOR: 1 }] };
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(q)) {
      if (/COLUMN_NAME IN \('DT_ATUALIZACAO', 'DT_CRIACAO'\)/.test(q)) return { recordset: [{ COLUMN_NAME: "DT_CRIACAO" }] };
      if (/CHARACTER_MAXIMUM_LENGTH/.test(q)) return { recordset: [{ TAM: 300 }] };
      // Sem ID_TIPO_KAIZEN na PVC: o POST de teste não precisa de tipo.
      if (/COLUMN_NAME = /.test(q)) return { recordset: this.inputs.coluna === "ID_TIPO_KAIZEN" ? [] : [{ OK: 1 }] };
      const tabela = String(this.inputs.tabela || "").toLowerCase();
      if (tabela === "kzn_hist_kaizen_hierarquia" && process.env.FAKE_SEM_HIST_HIER === "1") return { recordset: [] };
      if (/hierarquia/.test(tabela)) {
        return { recordset: ["ID_KAIZEN", "ID_USUARIO_LIDER", ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `NM_HIERARQUIA_N${n}`), "DT_ATUALIZACAO"].map((c) => ({ COLUMN_NAME: c })) };
      }
      return { recordset: [] };
    }
    if (/SELECT ID_STATUS, NM_STATUS, SG_ATIVO FROM/.test(q)) return { recordset: [{ ID_STATUS: this.inputs.id, NM_STATUS: ({ 1: "Aguardando aprovação", 2: "Aprovado", 3: "Reprovado", 4: "Solicitado alterações", 5: "Revisado" })[this.inputs.id] || "Status", SG_ATIVO: "S" }] };
    if (/SELECT PODE_EDITAR = /.test(q)) return { recordset: [{ PODE_EDITAR: 1, STATUS_EDITAVEL: 1, ID_STATUS: 1, ORIGEM: "A" }] };
    if (/SELECT TOP \(1\) a\.ID_APROVADOR/i.test(q)) return { recordset: [{ ID_APROVADOR: 1 }] };
    if (/ISNULL\(MAX\(ID_KAIZEN\), 0\) \+ 1 AS PROXIMO/i.test(q)) return { recordset: [{ PROXIMO: 99999 }] };
    if (/SELECT ID_STATUS, NM_STATUS FROM/i.test(q)) {
      return { recordset: [
        { ID_STATUS: 1, NM_STATUS: "Aguardando aprovação" }, { ID_STATUS: 2, NM_STATUS: "Revisado" },
        { ID_STATUS: 3, NM_STATUS: "Aprovado" }, { ID_STATUS: 4, NM_STATUS: "Reprovado" },
        { ID_STATUS: 5, NM_STATUS: "Solicitado alterações" },
      ] };
    }
    if (/SELECT ID_STATUS, ID_IDIOMA, NM_STATUS FROM/i.test(q)) {
      const pt = ["Aguardando aprovação", "Revisado", "Aprovado", "Reprovado", "Solicitado alterações"];
      const en = ["Awaiting approval", "Reviewed", "Approved", "Rejected", "Changes requested"];
      return { recordset: pt.flatMap((n, i) => [{ ID_STATUS: i + 1, ID_IDIOMA: 1, NM_STATUS: n }, { ID_STATUS: i + 1, ID_IDIOMA: 2, NM_STATUS: en[i] }]) };
    }
    if (/SELECT ID_CATEGORIA, ID_IDIOMA, NM_CATEGORIA FROM/i.test(q)) {
      const pt = ["Segurança", "Qualidade", "Produtividade", "Meio ambiente"], en = ["Safety", "Quality", "Productivity", "Environment"];
      return { recordset: pt.flatMap((n, i) => [{ ID_CATEGORIA: i + 1, ID_IDIOMA: 1, NM_CATEGORIA: n }, { ID_CATEGORIA: i + 1, ID_IDIOMA: 2, NM_CATEGORIA: en[i] }]) };
    }
    if (/SELECT a\.ID_APROVADOR, NM_USUARIO/i.test(q)) {
      return { recordset: Array.from({ length: 12 }, (_, i) => ({ ID_APROVADOR: i + 1, NM_USUARIO: i === 7 ? null : `Aprovador ${String.fromCharCode(65 + i)}` })) };
    }
    if (/FONTE_HIER/.test(q)) return { recordset: BASE };
    if (/EXTERNOS/.test(q)) {
      return { recordset: BASE.map((r, i) => ({
        ORIGEM: r.ORIGEM, ID_KAIZEN: r.ID_KAIZEN,
        NM_KAIZEN: `Melhoria ${r.ID_KAIZEN} no processo ${i % 7 === 0 ? "de britagem" : "da usina"}`,
        MEMBROS: i % 3 ? "Ana Silva, Bruno Costa" : null,
        EXTERNOS: i % 25 === 0 ? "Paulo (SOMAR)" : null,
      })) };
    }
    // Membros envolvidos (PNR28): a tabela "existe" só com FAKE_ENVOLVIDOS=1.
    if (/INFORMATION_SCHEMA\.TABLES/i.test(q) && /envolvidos/i.test(String(this.inputs.tabela || ""))) {
      return { recordset: process.env.FAKE_ENVOLVIDOS === "1" ? [{ OK: 1 }] : [] };
    }
    // Busca do MDM nos pickers de equipe: 5 pessoas por termo, tipo
    // conforme o recorte pedido (1 = Vale, 2 = terceiro, sem = misto).
    if (/kzn_mdm_hierarquia/i.test(q) && this.inputs.termo != null) {
      const t = String(this.inputs.termo).replace(/%/g, "") || "x";
      const tp = this.inputs.tipo;
      return { recordset: [1, 2, 3, 4, 5].map((i) => ({
        ID_USUARIO: (tp === 2 ? 300 : 200) + i + (tp == null ? 50 : 0),
        NM_USUARIO: `${t.toUpperCase()} PESSOA ${i}${tp === 2 ? " (TERCEIRO)" : ""}`,
        CD_MATRICULA: String(800000 + i), CD_EMAIL: `p${i}@vale.com`, NM_POSICAO: "Analista",
        ID_TIPO_USUARIO: tp || (i % 2 ? 1 : 2), SG_ATIVO: "A", NM_SITE: "SALOBO",
      })) };
    }
    if (/kzn_mdm_hierarquia/i.test(q)) {
      return { recordset: [{ ID_USUARIO: 100, NM_USUARIO: "Membro Teste", CD_MATRICULA: "000100", CD_EMAIL: "membro@vale.com", NM_POSICAO: "Analista", ID_TIPO_USUARIO: 1, SG_ATIVO: "A" }] };
    }
    if (/^\s*(UPDATE|DELETE)\b/i.test(q)) return { recordset: [], rowsAffected: [1] };
    return { recordset: [], rowsAffected: [0] };
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
  _base: BASE,
};
