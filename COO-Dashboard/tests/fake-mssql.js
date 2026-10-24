/* Dublê do pacote `mssql` (mesmo modelo dos testes do VBM Kaizen): nunca abre
   conexão de verdade. Reconhece cada consulta pelo texto do SQL e responde
   com dados fixos. Também GARANTE as regras de segurança: se algum valor
   vindo da requisição aparecer literal no texto da SQL (em vez de parâmetro),
   ou se o dashboard não vier por parâmetro, a consulta falha e o teste acusa. */
const tipo = (n) => ({ tipo: n });
const USUARIOS = {
  'membro@vale.com': { CD_MATRICULA: '01181222' },
  'semmatricula@vale.com': { CD_MATRICULA: '  ' },
};
const LITERAIS_PROIBIDOS = /@vale\.com|membro|semmatricula|DROP |;--|DASH\.ID_DASH\s*=\s*\d/i;

// Linhas no formato do script principal (database/coo_dashboard.sql)
function linhasGraficos() {
  const l = (dt, ordem, tipoTxt, valor) => ({ DT_REF: dt, ID_SISTEMA: 1, ID_SITE: 11, ID_OPERACAO: 1, ID_KPI: 1, NM_KPI: 'Mine Movement ', ID_ORDEM: 1, ORDEM_GRAFICO: ordem, Type: tipoTxt, Value: valor });
  return [
    l('2026-09-01T00:00:00.000Z', 0, 'Sep B', 2), l('2026-09-01T00:00:00.000Z', 1, 'Sep P', 9), l('2026-09-01T00:00:00.000Z', 2, 'Sep A', 2.4),
    l('2026-09-01T00:00:00.000Z', 3, 'Q3B', 6), l('2026-09-01T00:00:00.000Z', 4, 'Q3A', 6.5),
    l('2026-09-01T00:00:00.000Z', 6, '26B', 26), l('2026-09-01T00:00:00.000Z', 7, '26F', 28),
    l('2026-08-01T00:00:00.000Z', 0, 'Aug B', 99), l('2026-08-01T00:00:00.000Z', 2, 'Aug A', 99), // outro mês: não pode vazar
  ];
}

class Request {
  constructor() { this.inputs = {}; }
  input(nome, t, v) { this.inputs[nome] = v === undefined ? t : v; return this; }
  async query(q) {
    const uma = q.replace(/\s+/g, ' ');
    if (LITERAIS_PROIBIDOS.test(uma)) throw new Error('TESTE: valor literal na SQL (deveria ser parâmetro): ' + uma.slice(0, 160));
    if (/^SELECT 1 AS ok/i.test(uma.trim())) return { recordset: [{ ok: 1 }] };
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(uma) && /'USERS'/.test(uma)) return { recordset: [{ COLUMN_NAME: 'CD_EMAIL' }, { COLUMN_NAME: 'CD_MATRICULA' }, { COLUMN_NAME: 'NM_USUARIO' }] };
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(uma) && /'SITES'/.test(uma)) return { recordset: [{ COLUMN_NAME: 'ID_SITE' }, { COLUMN_NAME: 'NM_SITE' }, { COLUMN_NAME: 'NM_PAIS' }] };
    if (/FROM \[IBP\]\.\[USERS\]/i.test(uma)) {
      const u = USUARIOS[this.inputs.email];
      return { recordset: u ? [u] : [] };
    }
    if (/@ID_DASH/.test(uma) && this.inputs.ID_DASH !== 15) throw new Error('TESTE: ID_DASH esperado 15, recebido ' + this.inputs.ID_DASH);
    if (/FROM IBP\.SITES/i.test(uma)) {
      return { recordset: [
        { ID_SITE: 10, NM_SITE: 'Salobo', NM_PAIS: 'Brasil' },
        { ID_SITE: 11, NM_SITE: 'Sossego', NM_PAIS: 'Brasil' },
        { ID_SITE: 20, NM_SITE: 'Sudbury', NM_PAIS: 'Canadá' },
      ] };
    }
    if (/LOG_PEDRAVISAOCONSOLIDADA/i.test(uma)) {
      return { recordset: [
        { DT_REF: '2026-09-01T00:00:00.000Z', ID_SITE: 11, ID_KPI: 1, ID_ORDEM: 1, NM_KPIS_DASH: 'Mine Movement', VALIDATE: 0, DS_VALIDATE: 'Pending final updates', DT_ATUALIZACAO: null },
        { DT_REF: '2026-08-01T00:00:00.000Z', ID_SITE: 11, ID_KPI: 1, ID_ORDEM: 1, NM_KPIS_DASH: 'Mine Movement', VALIDATE: 1, DS_VALIDATE: '.', DT_ATUALIZACAO: '2026-09-05T10:00:00.000Z' },
      ] };
    }
    if (/IBP\.PEDRAVISAOTRIMESTRE/i.test(uma) && /IBP\.PEDRAVISAOANO/i.test(uma)) return { recordset: linhasGraficos() };
    throw new Error('TESTE: consulta não reconhecida pelo dublê: ' + uma.slice(0, 160));
  }
}
class ConnectionPool {
  on() { return this; }
  async connect() { return this; }
  async close() {}
  request() { return new Request(); }
}
module.exports = { ConnectionPool, Request, MAX: -1,
  Int: tipo('int'), BigInt: tipo('bigint'), Bit: tipo('bit'), Date: tipo('date'),
  NVarChar: (n) => tipo('nvarchar' + n), VarChar: (n) => tipo('varchar' + n) };
