/**
 * Dublê do mssql para o REGISTRO DE NOTIFICAÇÕES (KZN_TB_NOTIFICACAO).
 *
 * Emula o CONTRATO das rotas que mudam o status de um Kaizen, não o SQL:
 *   · a linha do Kaizen (kzn_pedravisaoconsolidada) é MUTÁVEL — o INSERT
 *     do cadastro cria, o UPDATE da decisão/edição troca ID_STATUS e
 *     carimba a coluna de data com um horário novo, como o banco faria;
 *   · KZN_TB_NOTIFICACAO é uma lista em memória com a mesma regra do
 *     INSERT ... WHERE NOT EXISTS do servidor: entra se ainda não houver
 *     linha com o mesmo ID_KAIZEN + TIPO_NOTIFICACAO + DT_CRIACAO.
 *
 * Controles (relidos a cada consulta, então o teste troca o
 * comportamento sem reiniciar o servidor — teste-notificacoes.js
 * escreve o arquivo de estado):
 *   FAKE_NOTIF_ESTADO  arquivo JSON com { identity, falhar, tabelaAusente,
 *                      forcarPendente, congelarRelogio, semDsMotivo,
 *                      tamMotivo }
 *   FAKE_NOTIF_LOG     arquivo onde a tabela de notificações é despejada
 */
const fs = require("fs");
const ESTADO = process.env.FAKE_NOTIF_ESTADO || "/tmp/notif-estado.json";
const LOG = process.env.FAKE_NOTIF_LOG || "/tmp/notif-tabela.json";
const tipo = (n) => ({ tipo: n });

// Catálogo igual ao de produção (ver ID_STATUS_EDITAVEIS_PADRAO = [3, 4]
// e ID_STATUS_REVISADO = 5 no server.js).
const CATALOGO_STATUS = [
  { ID_STATUS: 1, NM_STATUS: "Aprovado", SG_ATIVO: "S" },
  { ID_STATUS: 2, NM_STATUS: "Rejeitado", SG_ATIVO: "S" },
  { ID_STATUS: 3, NM_STATUS: "Aguardando aprovação", SG_ATIVO: "S" },
  { ID_STATUS: 4, NM_STATUS: "Solicitado alterações", SG_ATIVO: "S" },
  { ID_STATUS: 5, NM_STATUS: "Revisado", SG_ATIVO: "S" },
];
const STATUS_EN = { 1: "Approved", 2: "Rejected", 3: "Awaiting approval", 4: "Change requested", 5: "Reviewed" };

// Pessoas: 901 autor/logado (também aprovador — o mesmo usuário decide
// nos testes, como o admin dos outros dublês), 902 aprovador designado.
const MDM = {
  901: { ID_USUARIO: 901, NM_USUARIO: "Cristian Arlan Alves", CD_EMAIL: "cristian.alves@vale.com", CD_MATRICULA: "901", NM_POSICAO: "ANL", ID_TIPO_USUARIO: 1, SG_ATIVO: "A", NM_SITE: "CORPORATIVO", NM_CIDADE: "Nova Lima", NM_ESTADO: "MG" },
};
const APROVADOR = { NM_USUARIO: "Ana Beatriz Morais Santos", CD_EMAIL: "ana.santos5@vale.com" };

// Estado mutável.
const PVC = new Map();       // ID_KAIZEN -> linha
const NOTIF = [];            // KZN_TB_NOTIFICACAO
let relogio = Date.UTC(2026, 9, 6, 12, 0, 0); // avança 1 min por gravação

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, "utf8")); } catch (e) { return {}; }
}
function despejar() {
  try { fs.writeFileSync(LOG, JSON.stringify(NOTIF, null, 2)); } catch (e) {}
}
// Mesmo arredondamento do CAST(... AS DATETIME) — precisão de 1/300 s.
// O relógio do dublê anda em minutos inteiros, então basta o ms.
const chaveData = (d) => (d instanceof Date ? d.toISOString() : String(d));

// Kaizen 701 já existe, aguardando aprovação — usado pelas decisões.
PVC.set(701, { ID_KAIZEN: 701, NM_KAIZEN: "Reducao de refugo na linha 3", ID_STATUS: 3, DS_MOTIVO: null,
  ID_USUARIO_CADASTRO: 901, ID_CATEGORIA: 1, DT_CRIACAO: new Date(relogio) });

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    const uma = q.replace(/\s+/g, " ").trim();
    const est = lerEstado();
    const i = this.inputs;

    // ── KZN_TB_NOTIFICACAO ──
    if (/COLUMNPROPERTY\(OBJECT_ID\(@tabela\), 'ID_NOTIFICACAO', 'IsIdentity'\)/i.test(uma)) {
      if (est.tabelaAusente) return { recordset: [{ EH_IDENTITY: null }] };
      return { recordset: [{ EH_IDENTITY: est.identity ? 1 : 0 }] };
    }
    if (/^INSERT INTO \[ci\]\.\[KZN_TB_NOTIFICACAO\]/i.test(uma)) {
      // Texto exato do comando, para validação de sintaxe T-SQL à parte.
      if (process.env.FAKE_NOTIF_SQL) { try { fs.appendFileSync(process.env.FAKE_NOTIF_SQL, q + "\n;;\n"); } catch (e) {} }
      if (est.falhar) {
        const e = new Error("Invalid object name 'ci.KZN_TB_NOTIFICACAO'."); e.number = 208; throw e;
      }
      // Conferências do comando: com identity a PK não é citada; sem
      // identity ela vem de MAX+1 com trava.
      const citaPk = /\(ID_NOTIFICACAO, ID_KAIZEN/i.test(uma);
      if (!!est.identity === citaPk) throw new Error(`dublê: PK ${citaPk ? "citada" : "ausente"} com identity=${!!est.identity}`);
      if (citaPk && !/ISNULL\(MAX\(n\.ID_NOTIFICACAO\), 0\) \+ 1 FROM \[ci\]\.\[KZN_TB_NOTIFICACAO\] n WITH \(UPDLOCK, HOLDLOCK\)/i.test(uma)) {
        throw new Error("dublê: MAX+1 sem trava");
      }
      if (!/WHERE NOT EXISTS \( SELECT 1 FROM \[ci\]\.\[KZN_TB_NOTIFICACAO\] ja WITH \(UPDLOCK, HOLDLOCK\)/i.test(uma)) {
        throw new Error("dublê: INSERT sem a checagem de duplicidade travada");
      }
      // DS_MOTIVO só pode ser citada se a coluna existe — e tem de ser.
      const citaMotivo = /, DS_MOTIVO\)/.test(uma) && /, @motivo/.test(uma);
      if (citaMotivo === !!est.semDsMotivo) throw new Error(`dublê: DS_MOTIVO ${citaMotivo ? "citada sem existir" : "ausente com a coluna existindo"}`);
      if (citaMotivo && i.motivo != null && String(i.motivo).length > (est.tamMotivo || 300)) throw new Error("dublê: DS_MOTIVO maior que a coluna (truncamento)");
      const dt = i.dtAcao instanceof Date ? i.dtAcao : null;
      const chave = dt ? chaveData(dt) : "AGORA:" + Date.now() + Math.random();
      const ja = NOTIF.some((n) => n.ID_KAIZEN === i.idKaizen && n.TIPO_NOTIFICACAO === i.tipo && n._chave === chave);
      if (ja) return { recordset: [], rowsAffected: [0] };
      NOTIF.push({
        ID_NOTIFICACAO: NOTIF.length + 1, ID_KAIZEN: i.idKaizen, TIPO_NOTIFICACAO: i.tipo,
        TITULO_KAIZEN: i.titulo, EMAIL_APROVADOR: i.emailAprovador, EMAIL_AUTOR: i.emailAutor,
        DT_CRIACAO: dt ? dt.toISOString() : null, NM_APROVADOR: i.nmAprovador, NM_AUTOR: i.nmAutor,
        SITE: i.site, CATEGORIA_PT: i.categoriaPt, CATEGORIA_EN: i.categoriaEn,
        STATUS_EN: i.statusEn, STATUS_PT: i.statusPt,
        ...(citaMotivo ? { DS_MOTIVO: i.motivo } : {}), _chave: chave,
      });
      despejar();
      return { recordset: [], rowsAffected: [1] };
    }

    // DS_MOTIVO da tabela de notificações: existe? (e de que tamanho)
    if (/AS TAM_MOTIVO FROM INFORMATION_SCHEMA\.COLUMNS/i.test(uma)) {
      if (i.tabela !== "KZN_TB_NOTIFICACAO") throw new Error("dublê: DS_MOTIVO conferida na tabela errada " + i.tabela);
      return { recordset: est.semDsMotivo ? [] : [{ TAM_MOTIVO: est.tamMotivo || 300 }] };
    }

    // ── Identidade ──
    if (/EH_ADMIN/i.test(uma)) return { recordset: [{ ID_USUARIO: 901, EH_ADMIN: 1, EH_APROVADOR: 1 }] };
    if (/WHERE CD_EMAIL = @email/i.test(uma)) return { recordset: [MDM[901]] };

    // ── Metadados ──
    if (/AS TAM FROM INFORMATION_SCHEMA/i.test(uma)) return { recordset: [{ TAM: 300 }] };
    if (/COLUMN_NAME IN \('DT_ATUALIZACAO', 'DT_CRIACAO'\)/i.test(uma)) return { recordset: [{ COLUMN_NAME: "DT_CRIACAO" }] };
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(uma)) return { recordset: [] }; // colunas opcionais ausentes

    // ── Catálogo de status ──
    if (/SELECT ID_STATUS, NM_STATUS FROM/i.test(uma) && /SG_ATIVO IN/i.test(uma)) return { recordset: CATALOGO_STATUS };
    if (/SELECT ID_STATUS, NM_STATUS, SG_ATIVO FROM/i.test(uma)) {
      return { recordset: CATALOGO_STATUS.filter((s) => s.ID_STATUS === i.id) };
    }

    // ── Decisão: situacaoDaDecisao ──
    if (/EH_APROVADOR = CASE/i.test(uma)) {
      const k = PVC.get(i.idKaizen);
      // forcarPendente: simula a CORRIDA — duas requisições passando
      // juntas pela checagem "ainda está pendente?".
      return { recordset: k ? [{ ID_STATUS: est.forcarPendente ? 3 : k.ID_STATUS, EH_APROVADOR: 1 }] : [] };
    }
    // ── Edição: podeEditarKaizen ──
    if (/PODE_EDITAR = /i.test(uma) && /STATUS_EDITAVEL = /i.test(uma)) {
      const k = PVC.get(i.idKaizen);
      if (!k) return { recordset: [] };
      const editavel = k.ID_STATUS === i.statusEdit1 || k.ID_STATUS === i.statusEdit2;
      return { recordset: [{ PODE_EDITAR: 1, STATUS_EDITAVEL: editavel ? 1 : 0, ID_STATUS: k.ID_STATUS, ORIGEM: "A" }] };
    }

    // ── dadosDoComunicado (o SELECT grande) ──
    if (/AS NM_AUTOR/i.test(uma) && /AS STATUS_EN/i.test(uma)) {
      const k = PVC.get(i.idKaizen);
      if (!k) return { recordset: [] };
      const a = MDM[k.ID_USUARIO_CADASTRO];
      return { recordset: [{
        ID_KAIZEN: k.ID_KAIZEN, NM_KAIZEN: k.NM_KAIZEN, DS_MOTIVO: k.DS_MOTIVO, ID_STATUS: k.ID_STATUS,
        DT_ATUALIZACAO: k.DT_CRIACAO,
        NM_AUTOR: a.NM_USUARIO, EMAIL_AUTOR: a.CD_EMAIL, NM_SITE: a.NM_SITE, NM_CIDADE: a.NM_CIDADE, NM_ESTADO: a.NM_ESTADO,
        NM_APROVADOR: APROVADOR.NM_USUARIO, EMAIL_APROVADOR: APROVADOR.CD_EMAIL, NM_ACAO: a.NM_USUARIO,
        CATEGORIA_PT: "Qualidade", CATEGORIA_EN: "Quality",
        STATUS_PT: CATALOGO_STATUS.find((s) => s.ID_STATUS === k.ID_STATUS).NM_STATUS,
        STATUS_EN: STATUS_EN[k.ID_STATUS],
      }] };
    }
    if (/SELECT DISTINCT m\.CD_EMAIL FROM/i.test(uma)) return { recordset: [] };

    // ── Cadastro ──
    if (/SELECT TOP \(1\) ID_KAIZEN FROM/i.test(uma)) return { recordset: [] }; // nome livre
    if (/ID_TIPO_USUARIO = 1 AND SG_ATIVO = 'A'/i.test(uma)) return { recordset: [{ OK: 1 }] }; // ehValeAtivo
    if (/FROM \[ci\]\.\[kzn_aprovador\] a/i.test(uma) && /@id\b/.test(uma) && !/OUTER APPLY/i.test(uma)) {
      return { recordset: [{ ID_APROVADOR: 2 }] };
    }
    if (/SELECT ISNULL\(MAX\(ID_KAIZEN\), 0\) \+ 1 AS PROXIMO/i.test(uma)) {
      return { recordset: [{ PROXIMO: Math.max(0, ...PVC.keys()) + 1 }] };
    }
    if (/^INSERT INTO \[ci\]\.\[kzn_pedravisaoconsolidada\]/i.test(uma)) {
      relogio += 60000;
      PVC.set(i.idKaizen, { ID_KAIZEN: i.idKaizen, NM_KAIZEN: i.nmKaizen, ID_STATUS: i.idStatus ?? null,
        DS_MOTIVO: null, ID_USUARIO_CADASTRO: i.idUsuarioCadastro, ID_CATEGORIA: i.idCategoria, DT_CRIACAO: new Date(relogio) });
      return { recordset: [], rowsAffected: [1] };
    }

    // ── UPDATE da decisão / edição ──
    if (/^UPDATE \[ci\]\.\[kzn_pedravisaoconsolidada\]/i.test(uma)) {
      const k = PVC.get(i.idKaizen);
      if (!k) return { recordset: [], rowsAffected: [0] };
      // congelarRelogio: a segunda gravação da corrida relê o MESMO
      // carimbo (as duas caem no mesmo instante).
      if (!est.congelarRelogio) relogio += 60000;
      k.ID_STATUS = i.idStatus;
      if (i.motivo !== undefined) k.DS_MOTIVO = i.motivo;
      else if (/DS_MOTIVO = NULL/i.test(uma)) k.DS_MOTIVO = null; // aprovação sem comentário limpa
      if (i.nmKaizen !== undefined) k.NM_KAIZEN = i.nmKaizen;
      k.DT_CRIACAO = new Date(relogio);
      return { recordset: [], rowsAffected: [1] };
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
};
