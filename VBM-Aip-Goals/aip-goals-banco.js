/**
 * AIP Goals — leitura e gravação no Azure SQL (schema PM, database/001_pm_criar_tabelas.sql).
 *
 * Devolve os MESMOS formatos que as telas já usam (ciclo, cards, Goal Card, versões, Action Log, configuração),
 * para o router (aip-goals-api.js) não mudar de regra conforme a fonte.
 *
 * Dependências injetadas:
 *   runQuery(sql, params)      consulta no banco do AIP (AIPGOALS_AZURE_SQL_DATABASE)
 *   transacao(fn)              fn(q) com q(sql, params) dentro de uma transação; commit no fim, rollback no erro
 * Parâmetros sempre como { nome: [tipoMssql, valor] }: nada da requisição é concatenado na SQL.
 *
 * Pessoas: o AIP guarda só a matrícula; nome, e-mail, cargo, estado e cidade vêm do MDM (CI.KZN_MDM_HIERARQUIA, a
 * mesma tabela do Kaizen), no banco do AIP. É por ele também que o e-mail do login vira matrícula.
 */
const sql = require('mssql');

const TAG = '[aip-goals]';
const DIAS_PARADO = 3;
const PESO_TOTAL = 100;
const ETAPAS = ['desdobramento', 'proposta', 'calibracao', 'oficial'];
const COL_ETAPA = { desdobramento: 'DESDOBRAMENTO', proposta: 'PROPOSTA', calibracao: 'CALIBRACAO', oficial: 'OFICIAL' };
const ESTADO_DE = { RASCUNHO: 'rascunho', EM_APROVACAO: 'em_aprovacao', EM_REVISAO: 'em_revisao', APROVADO: 'aprovado' };
const GRUPO_DE = { CONTRIBUIDOR: 'contribuidor', APROVACAO: 'aprovacao', ADMIN: 'admin' };
const GRUPO_PARA = { contribuidor: 'CONTRIBUIDOR', aprovacao: 'APROVACAO', admin: 'ADMIN' };
const PAPEL_DE = { CONTRIBUIDOR: 'contribuidor', APROVACAO: 'aprovador', ADMIN: 'admin' };
const TITULO_RESULTADO = "COO's Scorecard Result";
const TTL = 10 * 60 * 1000;

const P = {
  int: (v) => [sql.Int, v == null ? null : Number(v)],
  sm: (v) => [sql.SmallInt, v == null ? null : Number(v)],
  dec: (v) => [sql.Decimal(6, 2), v == null ? null : Number(v)],
  vc: (v, n = 20) => [sql.VarChar(n), v == null ? null : String(v)],
  nv: (v, n = 4000) => [sql.NVarChar(n), v == null ? null : String(v)],
  max: (v) => [sql.NVarChar(sql.MAX), v == null ? null : String(v)],
  dt: (v) => [sql.Date, v == null ? null : v],
};
const json = (t, padrao = null) => { if (t == null || t === '') return padrao; try { return JSON.parse(t); } catch (e) { return padrao; } };
const pad2 = (n) => String(n).padStart(2, '0');
const isoData = (d) => (d instanceof Date ? `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` : d ? String(d).slice(0, 10) : null);
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
// Matrícula: numérica sem zeros à esquerda ('01181222' = '1181222'); com letra, em maiúsculas (como no Kaizen)
const chaveMat = (m) => { const t = String(m == null ? '' : m).trim(); return /^\d+$/.test(t) ? String(BigInt(t)) : t.toUpperCase(); };
// Igualdade de matrícula no SQL sem erro de conversão (TRY_CAST) e ignorando zeros à esquerda
const MAT_IGUAL = (a, b) => `(TRY_CAST(${a} AS BIGINT) = TRY_CAST(${b} AS BIGINT) OR CAST(${a} AS VARCHAR(30)) = CAST(${b} AS VARCHAR(30)))`;

function criarFonteBanco({ runQuery, transacao, env = process.env } = {}) {
  if (typeof runQuery !== 'function' || typeof transacao !== 'function') throw new Error('criarFonteBanco: runQuery e transacao são obrigatórios');
  // Unidades organizacionais (D-40): PM.UNIDADE_ORGANIZACIONAL no lugar da IBP.SITES. A tabela derivada mantém os nomes que as
  // consultas usam (ID_SITE, NM_SITE e NM_PAIS = escopo de atuação); BU = unidade de nível 4.
  const NIVEL_BU = 4;
  const SITES = `(SELECT ID_UNIDADE_ORGANIZACIONAL AS ID_SITE, NM_UNIDADE_ORGANIZACIONAL AS NM_SITE, NM_ESCOPO_ATUACAO AS NM_PAIS,
    NO_NIVEL_HIERARQUIA, ID_UNIDADE_PAI, NM_AREA, NM_RESPONSAVEL_AREA FROM PM.UNIDADE_ORGANIZACIONAL)`;
  // Card que prende a BU no ciclo (contagem "Cards submetidos" e trava do Excluir): já submetido, de meta ativa e com peso
  // nesta BU. Card de meta removida, sem peso no site ou da meta nº 0 (resultado do COO, pontos herdados) não prende.
  const CARD_AMARRADO = `EXISTS (SELECT 1 FROM PM.AIP_GOAL_CARD_VERSAO v WHERE v.ID_GOAL_CARD = gc.ID_GOAL_CARD) AND m.SG_ATIVA = 'S'
    AND EXISTS (SELECT 1 FROM PM.AIP_META_PESO mp WHERE mp.ID_META = gc.ID_META AND mp.ID_SITE = gc.ID_SITE AND mp.VL_PESO > 0)`;
  const chaveSite = (t) => semAcento(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const NOME_SITE = (a) => `${a}.NM_SITE`;
  const FUSO = env.AIPGOALS_FUSO || 'America/Sao_Paulo';
  const fmtHora = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  // DATETIME2 do Azure SQL é UTC (SYSDATETIME): mostra no fuso da operação
  const isoHora = (d) => (d instanceof Date ? fmtHora.format(d).replace(' ', 'T') : d ? String(d) : null);
  const isoDia = (d) => (d instanceof Date ? isoHora(d).slice(0, 10) : isoData(d));

  // ── Pessoas (MDM: CI.KZN_MDM_HIERARQUIA, a mesma tabela do Kaizen, no banco do AIP) ──
  const MDM = String(env.AIPGOALS_MDM_TABELA || 'CI.KZN_MDM_HIERARQUIA');
  if (MDM.split('.').length !== 2 || !MDM.split('.').every((x) => IDENT.test(x))) throw new Error(`AIPGOALS_MDM_TABELA inválida: ${MDM}`);
  // Nome: NM_USUARIO; vazio, sai do e-mail (nome.sobrenome@vale.com → Nome Sobrenome), como no Kaizen
  const SEL_PESSOA = `LTRIM(RTRIM(CAST(CD_MATRICULA AS VARCHAR(20)))) AS MATRICULA, NM_USUARIO AS NOME, CD_EMAIL AS EMAIL, NM_POSICAO AS CARGO, NM_ESTADO AS ESTADO, NM_CIDADE AS CIDADE`;
  const nomeDoEmail = (e) => String(e || '').split('@')[0].split(/[._]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const pessoaDe = (l) => ({ matricula: l.MATRICULA, nome: (l.NOME && String(l.NOME).trim()) || nomeDoEmail(l.EMAIL) || l.MATRICULA,
    email: l.EMAIL ? String(l.EMAIL).trim().toLowerCase() : '', cargo: l.CARGO ? String(l.CARGO).trim() : '', estado: l.ESTADO ? String(l.ESTADO).trim() : '', cidade: l.CIDADE ? String(l.CIDADE).trim() : '' });
  const cachePessoa = new Map(); // matrícula → { p, em }
  const cacheEmail = new Map();  // e-mail → { p, em }

  async function usuarioPorEmail(email) {
    const e = cacheEmail.get(email);
    if (e && Date.now() - e.em < TTL) return e.p;
    // Ativos primeiro; entre os tipos, o de menor ID (Vale antes de terceiro), como no Kaizen
    const r = await runQuery(`SELECT TOP (1) ${SEL_PESSOA} FROM ${MDM} WHERE CD_EMAIL = @email AND CD_MATRICULA IS NOT NULL
      ORDER BY CASE WHEN SG_ATIVO = 'A' THEN 0 ELSE 1 END, ID_TIPO_USUARIO`, { email: [sql.NVarChar(255), email] });
    const p = r.recordset[0] ? pessoaDe(r.recordset[0]) : null;
    if (p) { cacheEmail.set(email, { p, em: Date.now() }); cachePessoa.set(chaveMat(p.matricula), { p, em: Date.now() }); }
    return p;
  }
  async function pessoas(matriculas) {
    const mapa = new Map();
    const faltam = [...new Set(matriculas.filter(Boolean).map(chaveMat))].filter((m) => {
      const x = cachePessoa.get(m);
      if (x && Date.now() - x.em < TTL) { mapa.set(m, x.p); return false; }
      return true;
    });
    for (let i = 0; i < faltam.length; i += 400) {
      const parte = faltam.slice(i, i + 400), params = {};
      const num = parte.filter((m) => /^\d+$/.test(m)), txt = parte.filter((m) => !/^\d+$/.test(m));
      num.forEach((m, k) => { params['n' + k] = [sql.BigInt, m]; });
      txt.forEach((m, k) => { params['t' + k] = P.vc(m, 30); });
      const cond = [num.length ? `TRY_CAST(CD_MATRICULA AS BIGINT) IN (${num.map((m, k) => '@n' + k).join(', ')})` : null,
        txt.length ? `UPPER(LTRIM(RTRIM(CAST(CD_MATRICULA AS VARCHAR(30))))) IN (${txt.map((m, k) => '@t' + k).join(', ')})` : null].filter(Boolean).join(' OR ');
      try {
        const r = await runQuery(`SELECT ${SEL_PESSOA} FROM ${MDM} WHERE ${cond}
          ORDER BY CASE WHEN SG_ATIVO = 'A' THEN 1 ELSE 0 END, ID_TIPO_USUARIO DESC`, params);
        // Ordem crescente de preferência: a última linha de cada matrícula (ativa, menor tipo) é a que fica
        r.recordset.forEach((l) => { const p = pessoaDe(l), k = chaveMat(p.matricula); mapa.set(k, p); cachePessoa.set(k, { p, em: Date.now() }); });
      } catch (err) {
        console.error(`${TAG} nomes do MDM (${MDM}):`, err.message);
      }
    }
    return mapa;
  }
  const nomeDe = (mapa, m) => (m ? ((mapa.get(chaveMat(m)) || {}).nome || String(m)) : null);
  // Busca para o autopreenchimento (Novo usuário, diretor da BU): nome (começo de qualquer palavra), e-mail ou matrícula
  // Hierarquia do MDM para o cadastro de unidades (D-41): valores distintos de NM_HIERARQUIA_N<nível> (1 a 8), no formato
  // "<área> - <nome>" (ex.: "DIR, SOSSEGO OPS - VINICIUS MOREIRA ASSIS"): a área é o que vem antes do último " - ", o nome depois
  async function hierarquiaMdm(nivel, termo) {
    const n = Number(nivel);
    if (!Number.isInteger(n) || n < 1 || n > 8) return [];
    const col = `NM_HIERARQUIA_N${n}`, t = String(termo || '').trim().replace(/[%_[\]]/g, '');
    const r = await runQuery(`SELECT DISTINCT TOP (60) LTRIM(RTRIM(${col})) AS T FROM ${MDM}
      WHERE ${col} IS NOT NULL AND UPPER(LTRIM(RTRIM(${col}))) NOT IN ('', 'NULL', 'N.A', 'N/A', 'NA')${t ? ` AND ${col} LIKE @q` : ''}
      ORDER BY T`, t ? { q: [sql.NVarChar(255), '%' + t + '%'] } : {});
    return r.recordset.map((l) => {
      const texto = String(l.T), k = texto.lastIndexOf(' - ');
      return { texto, area: k > 0 ? texto.slice(0, k).trim() : '', responsavel: k > 0 ? texto.slice(k + 3).trim() : texto };
    });
  }
  async function buscarPessoas(termo) {
    const t = String(termo || '').trim().replace(/[%_[\]]/g, '');
    if (t.length < 2) return [];
    const r = await runQuery(`SELECT TOP (20) ${SEL_PESSOA} FROM ${MDM}
      WHERE SG_ATIVO = 'A' AND CD_MATRICULA IS NOT NULL
        AND (NM_USUARIO LIKE @ini OR NM_USUARIO LIKE @palavra OR CD_EMAIL LIKE @ini OR CAST(CD_MATRICULA AS VARCHAR(20)) LIKE @ini)
      ORDER BY CASE WHEN NM_USUARIO LIKE @ini THEN 0 ELSE 1 END, NM_USUARIO`,
    { ini: [sql.NVarChar(255), t + '%'], palavra: [sql.NVarChar(255), '% ' + t + '%'] });
    const vistos = new Set();
    return r.recordset.map(pessoaDe).filter((p) => !vistos.has(p.matricula) && vistos.add(p.matricula));
  }


  // ── Ciclo e sites ──
  async function cicloAtualLinha(q = runQuery) {
    // O aberto; sem aberto, o mais recente (a Administração precisa dele para reabrir ou abrir o próximo)
    const r = await q("SELECT TOP (1) * FROM PM.AIP_CICLO ORDER BY CASE WHEN SG_STATUS = 'S' THEN 0 ELSE 1 END, NO_ANO DESC");
    return r.recordset[0] || null;
  }
  async function sitesDoCiclo(idCiclo, q = runQuery) {
    const r = await q(`SELECT cs.ID_SITE, ${NOME_SITE('s')} AS NM_SITE, s.NM_PAIS, s.NO_NIVEL_HIERARQUIA, cs.SG_ATIVA, cs.NM_AREA, cs.NM_RESPONSAVEL_AREA, cs.DS_EXCECAO, cs.SG_EXCECAO_VER
      FROM PM.AIP_CICLO_SITE cs JOIN ${SITES} s ON s.ID_SITE = cs.ID_SITE
      WHERE cs.ID_CICLO = @ciclo ORDER BY s.NO_NIVEL_HIERARQUIA, s.NM_PAIS, s.NM_SITE`, { ciclo: P.int(idCiclo) });
    return r.recordset.map((l) => ({ id: l.ID_SITE, sigla: String(l.NM_SITE || l.ID_SITE).trim(), pais: String(l.NM_PAIS || '').trim(), nivel: Number(l.NO_NIVEL_HIERARQUIA) || NIVEL_BU, ativa: l.SG_ATIVA === 'S',
      area: l.NM_AREA || '', responsavel: l.NM_RESPONSAVEL_AREA || '', excecao: l.DS_EXCECAO || '', ver: l.SG_EXCECAO_VER === 'S' }));
  }
  function etapasDe(c) {
    return ETAPAS.map((id) => ({ id, inicio: isoData(c['DT_INI_' + COL_ETAPA[id]]), fim: isoData(c['DT_FIM_' + COL_ETAPA[id]]) }));
  }
  function cicloObj(c, sites, hoje) {
    const etapas = etapasDe(c);
    const h = isoData(new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())));
    const atual = etapas.filter((e) => e.inicio && e.inicio <= h).pop();
    return { id: `AIP-${c.NO_ANO}`, idCiclo: c.ID_CICLO, nome: c.NM_CICLO, ano: c.NO_ANO, aberto: c.SG_STATUS === 'S',
      // Unidades no ciclo com Goal Card (D-44): BUs e, quando no desdobramento, CEO, COO e níveis abaixo da BU
      bus: sites.filter((s) => s.ativa).map((s) => ({ sigla: s.sigla, pais: s.pais, nivel: s.nivel })),
      etapaAtual: (atual || etapas[0]).id, etapas };
  }
  async function cicloCompleto(hoje) {
    const c = await cicloAtualLinha();
    if (!c) return null;
    const sites = await sitesDoCiclo(c.ID_CICLO);
    return { linha: c, sites, ciclo: cicloObj(c, sites, hoje) };
  }

  // ── Contexto do usuário: matrícula, nome e papéis no ciclo atual ──
  async function contexto(email) {
    const pessoa = await usuarioPorEmail(email);
    if (!pessoa) return { papeis: [], quem: null, nome: email };
    const c = await cicloAtualLinha();
    if (!c) return { papeis: [], quem: pessoa.matricula, nome: pessoa.nome };
    const r = await runQuery(`SELECT p.TP_GRUPO, ${NOME_SITE('s')} AS NM_SITE FROM PM.AIP_PAPEL p LEFT JOIN ${SITES} s ON s.ID_SITE = p.ID_SITE
      WHERE p.ID_CICLO = @ciclo AND ${MAT_IGUAL('p.CD_MATRICULA', '@mat')} AND p.SG_ATIVO = 'S'`, { ciclo: P.int(c.ID_CICLO), mat: P.vc(pessoa.matricula, 30) });
    const papeis = r.recordset.map((l) => ({ papel: PAPEL_DE[l.TP_GRUPO], bu: l.TP_GRUPO === 'CONTRIBUIDOR' ? String(l.NM_SITE || '').trim() : null, grupo: GRUPO_DE[l.TP_GRUPO] }));
    return { papeis, quem: pessoa.matricula, nome: pessoa.nome, idCiclo: c.ID_CICLO };
  }

  // ── Goal Cards do ciclo (T02, T03, T13, T14) ──
  const SQL_CARDS = `SELECT gc.ID_GOAL_CARD, gc.CD_GOAL_CARD, gc.TP_ESTADO, gc.CD_MATRICULA, gc.DT_ATUALIZACAO, gc.ID_SITE,
      m.NO_META, m.NM_TITULO, m.TP_META, m.TP_ORIENTACAO, ${NOME_SITE('s')} AS NM_SITE, s.NM_PAIS,
      CASE WHEN m.CD_NIVEL IN ('CEO', 'COO') OR (m.NO_META = 0 AND m.CD_NIVEL <> 'BU') THEN m.VL_PESO WHEN m.NO_META = 0 THEN c.QTDE_PONTOS_HERDADOS_BU ELSE mp.VL_PESO END AS VL_PESO,
      v.NO_VERSAO, v.DT_VERSAO, v.CD_MATRICULA_AUTOR, v.DT_DECISAO
    FROM PM.AIP_GOAL_CARD gc
    JOIN PM.AIP_META m ON m.ID_META = gc.ID_META AND m.SG_ATIVA = 'S'
    JOIN PM.AIP_CICLO c ON c.ID_CICLO = m.ID_CICLO
    JOIN PM.AIP_CICLO_SITE cs ON cs.ID_CICLO = c.ID_CICLO AND cs.ID_SITE = gc.ID_SITE AND cs.SG_ATIVA = 'S'
    JOIN ${SITES} s ON s.ID_SITE = gc.ID_SITE
    LEFT JOIN PM.AIP_META_PESO mp ON mp.ID_META = m.ID_META AND mp.ID_SITE = gc.ID_SITE
    OUTER APPLY (SELECT TOP (1) x.NO_VERSAO, x.DT_VERSAO, x.CD_MATRICULA_AUTOR, x.DT_DECISAO FROM PM.AIP_GOAL_CARD_VERSAO x
                 WHERE x.ID_GOAL_CARD = gc.ID_GOAL_CARD ORDER BY x.NO_VERSAO DESC) v
    WHERE c.ID_CICLO = @ciclo AND (CASE WHEN m.CD_NIVEL IN ('CEO', 'COO') OR (m.NO_META = 0 AND m.CD_NIVEL <> 'BU') THEN m.VL_PESO WHEN m.NO_META = 0 THEN c.QTDE_PONTOS_HERDADOS_BU ELSE mp.VL_PESO END) > 0`;
  function desdeDe(l) {
    const e = l.TP_ESTADO;
    if (e === 'EM_APROVACAO' && l.DT_VERSAO) return isoDia(l.DT_VERSAO);
    if ((e === 'EM_REVISAO' || e === 'APROVADO') && l.DT_DECISAO) return isoDia(l.DT_DECISAO);
    return isoDia(l.DT_ATUALIZACAO);
  }
  function cardDe(l, nomes) {
    const estado = ESTADO_DE[l.TP_ESTADO];
    return { card: l.CD_GOAL_CARD, id: l.ID_GOAL_CARD, bu: { sigla: String(l.NM_SITE).trim(), pais: String(l.NM_PAIS || '').trim() },
      meta: { numero: l.NO_META, titulo: l.NO_META === 0 ? (l.NM_TITULO || TITULO_RESULTADO) : l.NM_TITULO, tipo: String(l.TP_META).toLowerCase(), peso: Number(l.VL_PESO) || 0, ...(l.NO_META === 0 ? { resultado: true } : {}) },
      estado, nivel: estado === 'em_aprovacao' ? { atual: 1, total: 1, nome: 'P&CI/COO' } : null,
      versao: l.NO_VERSAO || null, desde: desdeDe(l), contribuidor: nomeDe(nomes, l.CD_MATRICULA_AUTOR || null),
      editores: l.CD_MATRICULA_AUTOR ? [l.CD_MATRICULA_AUTOR] : [] }; // RN-12 na fila de aprovação
  }
  async function painel(hoje) {
    const cc = await cicloCompleto(hoje);
    if (!cc) return null;
    const r = await runQuery(SQL_CARDS + ' ORDER BY s.NM_SITE, m.NO_META', { ciclo: P.int(cc.linha.ID_CICLO) });
    const nomes = await pessoas(r.recordset.map((l) => l.CD_MATRICULA_AUTOR));
    return { ciclo: cc.ciclo, parametros: { diasParado: DIAS_PARADO, pesoTotal: PESO_TOTAL }, cards: r.recordset.map((l) => cardDe(l, nomes)) };
  }

  // ── Metas do ciclo ──
  async function metasDoCiclo(idCiclo, q = runQuery) {
    const r = await q(`SELECT m.ID_META, m.CD_NIVEL, m.NO_META, m.NM_TITULO, m.TP_META, m.TP_ORIENTACAO, m.VL_PESO, m.SG_ATIVA, m.ID_META_ORIGEM,
        o.NO_META AS NO_ORIGEM, o.CD_NIVEL AS NIVEL_ORIGEM
      FROM PM.AIP_META m LEFT JOIN PM.AIP_META o ON o.ID_META = m.ID_META_ORIGEM
      WHERE m.ID_CICLO = @ciclo ORDER BY m.CD_NIVEL, m.NO_META`, { ciclo: P.int(idCiclo) });
    const pr = await q(`SELECT mp.ID_META, mp.ID_SITE, mp.VL_PESO FROM PM.AIP_META_PESO mp JOIN PM.AIP_META m ON m.ID_META = mp.ID_META WHERE m.ID_CICLO = @ciclo`, { ciclo: P.int(idCiclo) });
    return { metas: r.recordset, pesos: pr.recordset };
  }
  const codigoOrigem = (ano, no) => `${ano}_${pad2(no)}`;

  async function desdobramento(hoje) {
    const cc = await cicloCompleto(hoje);
    if (!cc) return null;
    const c = cc.linha, sigla = new Map(cc.sites.map((s) => [s.id, s.sigla]));
    const { metas, pesos } = await metasDoCiclo(c.ID_CICLO);
    const ativas = metas.filter((m) => m.SG_ATIVA === 'S');
    const bu = ativas.filter((m) => m.CD_NIVEL === 'BU' && m.NO_META > 0);
    const metasBu = bu.map((m) => ({ numero: m.NO_META, titulo: m.NM_TITULO, tipo: m.TP_META.toLowerCase(), nova: false,
      origem: m.NIVEL_ORIGEM === 'COO' ? codigoOrigem(c.NO_ANO, m.NO_ORIGEM) : null,
      pesos: Object.fromEntries(pesos.filter((p) => p.ID_META === m.ID_META && sigla.has(p.ID_SITE)).map((p) => [sigla.get(p.ID_SITE), Number(p.VL_PESO)])) }));
    const scorecardCoo = [{ id: codigoOrigem(c.NO_ANO, 1), titulo: "CEO's Scorecard Result", peso: c.QTDE_PONTOS_HERDADOS_COO, resultado: true, compartilhada: [], metasBu: [] }]
      .concat(ativas.filter((m) => m.CD_NIVEL === 'COO' && m.NO_META > 0).map((m) => ({ id: codigoOrigem(c.NO_ANO, m.NO_META), titulo: m.NM_TITULO, peso: Number(m.VL_PESO) || 0, compartilhada: [],
        metasBu: bu.filter((b) => b.ID_META_ORIGEM === m.ID_META).map((b) => b.NO_META) })));
    return { ciclo: cc.ciclo, parametros: { pesoTotal: PESO_TOTAL, pesoResultadoCoo: c.QTDE_PONTOS_HERDADOS_BU }, scorecardCoo, metasBu };
  }

  // ── Goal Card (T04), Versões (T06) ──
  const secoesVazias = () => ({ objective: '', formula: '', unit: '', ruler: { min: '', meta: '', exc: '' }, area: { area: '', responsavel: '' }, evidence: '', exceptions: { padrao: '', bu: '' } });
  function mesclarSecoes(base, s) {
    const x = s || {};
    return { ...base, ...x, ruler: { ...base.ruler, ...(x.ruler || {}) }, area: { ...base.area, ...(x.area || {}) }, exceptions: { ...base.exceptions, ...(x.exceptions || {}) } };
  }
  async function lerCard(codigo, hoje) {
    const cc = await cicloCompleto(hoje);
    if (!cc) return null;
    const r = await runQuery(`SELECT gc.ID_GOAL_CARD, gc.CD_GOAL_CARD, gc.TP_ESTADO, gc.DS_RASCUNHO, gc.CD_MATRICULA, gc.DT_ATUALIZACAO, gc.ID_SITE, gc.NO_VERSAO_OFICIAL,
        m.ID_META, m.NO_META, m.NM_TITULO, m.TP_META, m.TP_ORIENTACAO, ${NOME_SITE('s')} AS NM_SITE, s.NM_PAIS, cs.NM_AREA, cs.NM_RESPONSAVEL_AREA, cs.DS_EXCECAO, cs.SG_EXCECAO_VER,
        CASE WHEN m.CD_NIVEL IN ('CEO', 'COO') OR (m.NO_META = 0 AND m.CD_NIVEL <> 'BU') THEN m.VL_PESO WHEN m.NO_META = 0 THEN c.QTDE_PONTOS_HERDADOS_BU ELSE mp.VL_PESO END AS VL_PESO
      FROM PM.AIP_GOAL_CARD gc
      JOIN PM.AIP_META m ON m.ID_META = gc.ID_META
      JOIN PM.AIP_CICLO c ON c.ID_CICLO = m.ID_CICLO
      JOIN ${SITES} s ON s.ID_SITE = gc.ID_SITE
      LEFT JOIN PM.AIP_CICLO_SITE cs ON cs.ID_CICLO = c.ID_CICLO AND cs.ID_SITE = gc.ID_SITE
      LEFT JOIN PM.AIP_META_PESO mp ON mp.ID_META = m.ID_META AND mp.ID_SITE = gc.ID_SITE
      WHERE c.ID_CICLO = @ciclo AND gc.CD_GOAL_CARD = @cd`, { ciclo: P.int(cc.linha.ID_CICLO), cd: P.vc(codigo) });
    const l = r.recordset[0];
    if (!l) return null;
    const vr = await runQuery('SELECT * FROM PM.AIP_GOAL_CARD_VERSAO WHERE ID_GOAL_CARD = @id ORDER BY NO_VERSAO', { id: P.int(l.ID_GOAL_CARD) });
    const ev = await runQuery(`SELECT ID_EVENTO, DT_EVENTO, CD_MATRICULA, TP_GRUPO, CD_SECAO, DS_COMENTARIO, ID_EVENTO_PAI FROM PM.AIP_EVENTO_LOG
      WHERE ID_GOAL_CARD = @id AND TP_EVENTO = 'COMENTARIO' ORDER BY DT_EVENTO, ID_EVENTO`, { id: P.int(l.ID_GOAL_CARD) });
    const versoes = vr.recordset;
    const nomes = await pessoas([l.CD_MATRICULA].concat(versoes.map((v) => v.CD_MATRICULA_AUTOR), versoes.map((v) => v.CD_MATRICULA_DECISAO), ev.recordset.map((e) => e.CD_MATRICULA)));
    return { cc, l, versoes, eventos: ev.recordset, nomes };
  }
  function montarCard(x) {
    const { cc, l, versoes, eventos, nomes } = x;
    const estado = ESTADO_DE[l.TP_ESTADO];
    const ultima = versoes[versoes.length - 1] || null;
    const fixas = { area: { area: l.NM_AREA || '', responsavel: l.NM_RESPONSAVEL_AREA || '' }, padrao: l.SG_EXCECAO_VER === 'S' ? (l.DS_EXCECAO || '') : '' };
    const fixar = (s) => ({ ...s, area: fixas.area, exceptions: { ...s.exceptions, padrao: fixas.padrao } });
    const base = secoesVazias();
    const secoes = fixar(mesclarSecoes(base, json(l.DS_RASCUNHO) || (ultima ? json(ultima.DS_CAMPOS) : null)));
    const revisao = ultima ? json(ultima.DS_REVISAO_SECOES, {}) : {};
    const ajustar = estado === 'em_revisao' ? Object.keys((revisao && revisao.revisao) || {}).filter((k) => revisao.revisao[k] === 'ajustar') : [];
    let alteradasDesde = null;
    if (versoes.length > 1 && estado !== 'rascunho') {
      const a = json(versoes[versoes.length - 2].DS_CAMPOS, {}), b = json(ultima.DS_CAMPOS, {});
      alteradasDesde = { versao: versoes[versoes.length - 2].NO_VERSAO, secoes: Object.keys(base).filter((k) => JSON.stringify(a[k] || null) !== JSON.stringify(b[k] || null)) };
    }
    const com = (e) => ({ id: `EV-${e.ID_EVENTO}`, secao: e.CD_SECAO, autor: nomeDe(nomes, e.CD_MATRICULA), papel: PAPEL_DE[e.TP_GRUPO] || 'contribuidor', quando: isoDia(e.DT_EVENTO), texto: e.DS_COMENTARIO });
    const comentarios = eventos.filter((e) => !e.ID_EVENTO_PAI).map((e) => ({ ...com(e), respostas: eventos.filter((f) => f.ID_EVENTO_PAI === e.ID_EVENTO).map(com) }));
    const editores = [...new Set(versoes.map((v) => v.CD_MATRICULA_AUTOR).concat(l.DS_RASCUNHO ? [l.CD_MATRICULA] : []))];
    const desde = desdeDe({ TP_ESTADO: l.TP_ESTADO, DT_VERSAO: ultima && ultima.DT_VERSAO, DT_DECISAO: ultima && ultima.DT_DECISAO, DT_ATUALIZACAO: l.DT_ATUALIZACAO });
    return {
      ciclo: cc.ciclo, card: l.CD_GOAL_CARD, id: l.ID_GOAL_CARD, idCiclo: cc.linha.ID_CICLO, cicloAberto: cc.linha.SG_STATUS === 'S',
      bu: { sigla: String(l.NM_SITE).trim(), pais: String(l.NM_PAIS || '').trim() },
      meta: { numero: l.NO_META, titulo: l.NO_META === 0 ? (l.NM_TITULO || TITULO_RESULTADO) : l.NM_TITULO, tipo: String(l.TP_META).toLowerCase(), peso: Number(l.VL_PESO) || 0, polaridade: String(l.TP_ORIENTACAO).toLowerCase() },
      estado, versao: ultima ? ultima.NO_VERSAO : null, desde,
      submetidoPor: estado === 'rascunho' || !ultima ? null : nomeDe(nomes, ultima.CD_MATRICULA_AUTOR),
      editores, secoes, ajustar, alteradasDesde, comentarios,
      _versoes: versoes, _nomes: nomes,
    };
  }
  async function goalCard(codigo, hoje) {
    const x = await lerCard(codigo, hoje);
    return x ? montarCard(x) : null;
  }
  async function versoes(codigo, hoje) {
    const gc = await goalCard(codigo, hoje);
    if (!gc) return null;
    const nomes = gc._nomes;
    const base = { ciclo: gc.ciclo, card: gc.card, bu: gc.bu, meta: gc.meta, estado: gc.estado, versaoAtual: gc.versao, contribuidor: gc.submetidoPor };
    const oficial = gc.estado === 'aprovado' ? gc.versao : null;
    const lista = gc._versoes.map((v) => {
      const rev = json(v.DS_REVISAO_SECOES, {}) || {};
      const marcadas = Object.keys(rev.revisao || {}).filter((k) => rev.revisao[k] === 'ajustar');
      return { versao: v.NO_VERSAO, quando: isoHora(v.DT_VERSAO), autor: nomeDe(nomes, v.CD_MATRICULA_AUTOR), motivo: String(v.TP_MOTIVO).toLowerCase(),
        secoes: mesclarSecoes(secoesVazias(), json(v.DS_CAMPOS, {})), oficial: v.NO_VERSAO === oficial,
        decisao: v.TP_DECISAO ? { tipo: v.TP_DECISAO === 'APROVADO' ? 'aprovar' : 'devolver', quem: nomeDe(nomes, v.CD_MATRICULA_DECISAO), quando: isoHora(v.DT_DECISAO), secoes: marcadas, comentario: v.DS_COMENTARIO_DECISAO || '' } : null };
    });
    return { ...base, versoes: lista.reverse(), oficial };
  }

  // ── Action Log (T07) ──
  async function actionLog(hoje) {
    const cc = await cicloCompleto(hoje);
    if (!cc) return null;
    const r = await runQuery(`SELECT TOP (5000) e.ID_EVENTO, e.TP_EVENTO, e.DT_EVENTO, e.CD_MATRICULA, e.TP_GRUPO, e.CD_SECAO, e.DS_COMENTARIO, e.DS_ANTES, e.DS_DEPOIS,
        gc.CD_GOAL_CARD, m.NO_META, m.NM_TITULO, ${NOME_SITE('s')} AS NM_SITE
      FROM PM.AIP_EVENTO_LOG e
      LEFT JOIN PM.AIP_GOAL_CARD gc ON gc.ID_GOAL_CARD = e.ID_GOAL_CARD
      LEFT JOIN PM.AIP_META m ON m.ID_META = gc.ID_META
      LEFT JOIN ${SITES} s ON s.ID_SITE = gc.ID_SITE
      WHERE e.ID_CICLO = @ciclo ORDER BY e.DT_EVENTO DESC, e.ID_EVENTO DESC`, { ciclo: P.int(cc.linha.ID_CICLO) });
    const nomes = await pessoas(r.recordset.map((e) => e.CD_MATRICULA));
    const tipo = (t) => (/^CICLO_/.test(t) ? 'configuracao' : String(t).toLowerCase());
    const eventos = r.recordset.map((e) => {
      const v = /v(\d+)/.exec(e.DS_COMENTARIO || '');
      return { id: `EV-${String(e.ID_EVENTO).padStart(4, '0')}`, tipo: tipo(e.TP_EVENTO), quando: isoHora(e.DT_EVENTO), quem: nomeDe(nomes, e.CD_MATRICULA),
        papel: e.TP_GRUPO ? PAPEL_DE[e.TP_GRUPO] : 'leitor', bu: e.NM_SITE ? String(e.NM_SITE).trim() : null,
        meta: e.NO_META != null ? { numero: e.NO_META, titulo: e.NO_META === 0 ? TITULO_RESULTADO : e.NM_TITULO } : null,
        card: e.CD_GOAL_CARD || null, secao: e.CD_SECAO || null, versao: e.TP_EVENTO === 'SUBMISSAO' && v ? Number(v[1]) : null,
        detalhe: e.DS_COMENTARIO || '', antes: e.DS_ANTES, depois: e.DS_DEPOIS,
        ...(e.TP_EVENTO === 'DECISAO' ? { decisao: e.DS_DEPOIS === 'Aprovado' ? 'aprovar' : 'devolver' } : {}) };
    });
    const { metas } = await metasDoCiclo(cc.linha.ID_CICLO);
    const metasBu = metas.filter((m) => m.CD_NIVEL === 'BU' && m.SG_ATIVA === 'S').map((m) => ({ numero: m.NO_META, titulo: m.NO_META === 0 ? TITULO_RESULTADO : m.NM_TITULO }));
    return { ciclo: cc.ciclo, eventos, bus: cc.ciclo.bus, metas: metasBu };
  }

  // ── Configuração (T11) ──
  async function configuracao(hoje) {
    const cc = await cicloCompleto(hoje);
    if (!cc) return null;
    const c = cc.linha;
    const [ciclosR, papeisR, subR, sitesR, mt] = [
      await runQuery('SELECT NO_ANO, NM_CICLO, SG_STATUS FROM PM.AIP_CICLO ORDER BY NO_ANO DESC'),
      await runQuery(`SELECT p.CD_MATRICULA, p.TP_GRUPO, ${NOME_SITE('s')} AS NM_SITE FROM PM.AIP_PAPEL p LEFT JOIN ${SITES} s ON s.ID_SITE = p.ID_SITE
        WHERE p.ID_CICLO = @ciclo AND p.SG_ATIVO = 'S' ORDER BY p.TP_GRUPO, p.CD_MATRICULA`, { ciclo: P.int(c.ID_CICLO) }),
      await runQuery(`SELECT gc.ID_SITE, COUNT(*) AS N FROM PM.AIP_GOAL_CARD gc JOIN PM.AIP_META m ON m.ID_META = gc.ID_META
        WHERE m.ID_CICLO = @ciclo AND ${CARD_AMARRADO} GROUP BY gc.ID_SITE`, { ciclo: P.int(c.ID_CICLO) }),
      await runQuery('SELECT * FROM PM.UNIDADE_ORGANIZACIONAL ORDER BY NO_NIVEL_HIERARQUIA, NM_ESCOPO_ATUACAO, NM_UNIDADE_ORGANIZACIONAL'),
      await metasDoCiclo(c.ID_CICLO),
    ];
    const sub = new Map(subR.recordset.map((x) => [x.ID_SITE, x.N]));
    const nomes = await pessoas(papeisR.recordset.map((p) => p.CD_MATRICULA));
    const noCiclo = new Map(cc.sites.map((s) => [s.id, s]));
    const un = (u) => ({ id: u.ID_UNIDADE_ORGANIZACIONAL, nome: String(u.NM_UNIDADE_ORGANIZACIONAL).trim(), nivel: u.NO_NIVEL_HIERARQUIA, pai: u.ID_UNIDADE_PAI,
      escopo: String(u.NM_ESCOPO_ATUACAO || '').trim(), area: u.NM_AREA || '', responsavel: u.NM_RESPONSAVEL_AREA || '' });
    const sigla = new Map(cc.sites.map((s) => [s.id, s.sigla]));
    const nomeUn = new Map(sitesR.recordset.map((u) => [u.ID_UNIDADE_ORGANIZACIONAL, String(u.NM_UNIDADE_ORGANIZACIONAL).trim()]));
    const ativas = mt.metas.filter((m) => m.SG_ATIVA === 'S');
    // Níveis abaixo da BU no desdobramento (D-43): os que têm metas ativas no ciclo; a meta 0 guarda os pontos herdados
    const niveisN = [...new Set(ativas.filter((m) => /^N[5-9]$/.test(m.CD_NIVEL)).map((m) => m.CD_NIVEL))].sort();
    const pol = (m) => String(m.TP_ORIENTACAO).toLowerCase();
    const metasNivel = {
      ceo: ativas.filter((m) => m.CD_NIVEL === 'CEO' && m.NO_META > 0).map((m) => ({ numero: m.NO_META, titulo: m.NM_TITULO, tipo: m.TP_META.toLowerCase(), polaridade: pol(m), pesos: { CEO: Number(m.VL_PESO) || 0 } })),
      coo: ativas.filter((m) => m.CD_NIVEL === 'COO' && m.NO_META > 0).map((m) => ({ numero: m.NO_META, titulo: m.NM_TITULO, tipo: m.TP_META.toLowerCase(), polaridade: pol(m), pesos: { COO: Number(m.VL_PESO) || 0 } })),
      bu: ativas.filter((m) => m.CD_NIVEL === 'BU' && m.NO_META > 0).map((m) => ({ numero: m.NO_META, titulo: m.NM_TITULO, tipo: m.TP_META.toLowerCase(), polaridade: pol(m),
        origem: m.NIVEL_ORIGEM === 'COO' ? codigoOrigem(c.NO_ANO, m.NO_ORIGEM) : null, nova: false,
        pesos: Object.fromEntries(mt.pesos.filter((p) => p.ID_META === m.ID_META && sigla.has(p.ID_SITE)).map((p) => [sigla.get(p.ID_SITE), Number(p.VL_PESO)])) })),
    };
    niveisN.forEach((nv) => {
      metasNivel[nv.toLowerCase()] = ativas.filter((m) => m.CD_NIVEL === nv && m.NO_META > 0).map((m) => ({ numero: m.NO_META, titulo: m.NM_TITULO, tipo: m.TP_META.toLowerCase(), polaridade: pol(m), nova: false,
        pesos: Object.fromEntries(mt.pesos.filter((p) => p.ID_META === m.ID_META && nomeUn.has(p.ID_SITE)).map((p) => [nomeUn.get(p.ID_SITE), Number(p.VL_PESO)])) }));
    });
    const membros = papeisR.recordset.map((p) => {
      const pe = nomes.get(chaveMat(p.CD_MATRICULA)) || { nome: String(p.CD_MATRICULA), email: '', cargo: '', estado: '', cidade: '' };
      return { nome: pe.nome, matricula: String(p.CD_MATRICULA).trim(), email: pe.email, cargo: pe.cargo, estado: pe.estado, cidade: pe.cidade, grupo: GRUPO_DE[p.TP_GRUPO], bu: p.TP_GRUPO === 'CONTRIBUIDOR' ? String(p.NM_SITE || '').trim() : null };
    });
    return {
      ciclo: { ...cc.ciclo, status: c.SG_STATUS === 'S' ? 'aberto' : 'fechado', textoPadraoExcecoes: '' },
      ciclos: ciclosR.recordset.map((x) => ({ ano: x.NO_ANO, nome: x.NM_CICLO, aberto: x.SG_STATUS === 'S' })),
      // BUs = unidades de nível 4, com a participação no ciclo (área e responsável do ciclo; fora dele, os padrões da unidade)
      bus: sitesR.recordset.filter((u) => u.NO_NIVEL_HIERARQUIA === NIVEL_BU).map((u) => { const b = un(u), c2 = noCiclo.get(b.id);
        return { ...b, sigla: b.nome, pais: b.escopo, ativa: !!(c2 && c2.ativa), area: c2 ? c2.area : b.area, responsavel: c2 ? c2.responsavel : b.responsavel, cardsSubmetidos: sub.get(b.id) || 0 }; }),
      // Estrutura: as demais unidades (Presidente, CEO, COO…)
      org: sitesR.recordset.filter((u) => u.NO_NIVEL_HIERARQUIA !== NIVEL_BU).map(un),
      membros, diretorio: [], // a busca de pessoas é por GET /pessoas?q= (MDM)
      excecoes: { bus: Object.fromEntries(cc.sites.map((s) => [s.sigla, { texto: s.excecao, ver: s.ver }])) },
      niveis: [
        { id: 'ceo', nome: 'CEO', total: PESO_TOTAL, herdado: 0, ativo: true, fixo: true },
        { id: 'coo', nome: 'COO', total: PESO_TOTAL, herdado: c.QTDE_PONTOS_HERDADOS_COO, ativo: true, fixo: true },
        { id: 'bu', nome: 'Business Unit', total: PESO_TOTAL, herdado: c.QTDE_PONTOS_HERDADOS_BU, ativo: true, fixo: true },
      ].concat(niveisN.map((nv) => { const m0 = ativas.find((m) => m.CD_NIVEL === nv && m.NO_META === 0);
        return { id: nv.toLowerCase(), nome: `Nível ${nv.slice(1)}`, total: PESO_TOTAL, herdado: m0 ? Number(m0.VL_PESO) || 0 : 0, ativo: true, fixo: false }; })),
      unidades: [{ id: 'CEO', nivel: 'ceo', nome: 'CEO VBM', pai: null }, { id: 'COO', nivel: 'coo', nome: 'COO VBM', pai: 'CEO' }],
      metasNivel,
      parametros: [
        { id: 'minComentario', valor: 10, unidade: 'caracteres', min: 1, max: 500 },
        { id: 'anexoMb', valor: 25, unidade: 'MB', min: 1, max: 100 },
      ],
      _idCiclo: c.ID_CICLO, _aberto: c.SG_STATUS === 'S',
    };
  }

  // ── Gravações ──
  async function evento(q, e) {
    const r = await q(`INSERT PM.AIP_EVENTO_LOG (ID_CICLO, TP_EVENTO, CD_MATRICULA, TP_GRUPO, ID_GOAL_CARD, CD_SECAO, DS_COMENTARIO, ID_EVENTO_PAI, DS_ANTES, DS_DEPOIS)
      VALUES (@ciclo, @tipo, @mat, @grupo, @card, @secao, @com, @pai, @antes, @depois); SELECT CAST(SCOPE_IDENTITY() AS INT) AS ID;`, {
      ciclo: P.int(e.ciclo), tipo: P.vc(e.tipo), mat: P.vc(e.quem), grupo: P.vc(e.grupo || null), card: P.int(e.card || null), secao: P.vc(e.secao || null),
      com: P.nv(e.comentario == null ? null : String(e.comentario).slice(0, 4000)), pai: P.int(e.pai || null), antes: P.max(e.antes == null ? null : e.antes), depois: P.max(e.depois == null ? null : e.depois) });
    return r.recordset[0].ID;
  }
  const grupoDoUsuario = (papeis) => (papeis.some((p) => p.papel === 'admin') ? 'ADMIN' : papeis.some((p) => p.papel === 'aprovador') ? 'APROVACAO' : papeis.some((p) => p.papel === 'contribuidor') ? 'CONTRIBUIDOR' : null);
  const conflito = (msg) => Object.assign(new Error(msg), { status: 409, codigo: 'ESTADO' });

  async function salvarRascunho(card, secoes, quem) {
    const r = await runQuery(`UPDATE PM.AIP_GOAL_CARD SET DS_RASCUNHO = @ds, CD_MATRICULA = @mat, DT_ATUALIZACAO = SYSDATETIME()
      WHERE ID_GOAL_CARD = @id AND TP_ESTADO IN ('RASCUNHO', 'EM_REVISAO')`, { ds: P.max(JSON.stringify(secoes)), mat: P.vc(quem), id: P.int(card.id) });
    if (!r.rowsAffected[0]) throw conflito('O card não está em edição.');
  }
  async function submeter(card, secoes, ctx) {
    return transacao(async (q) => {
      const v = await q('SELECT ISNULL(MAX(NO_VERSAO), 0) AS N FROM PM.AIP_GOAL_CARD_VERSAO WHERE ID_GOAL_CARD = @id', { id: P.int(card.id) });
      const n = v.recordset[0].N + 1;
      const motivo = card.estado === 'em_revisao' ? 'RESUBMISSAO' : n > 1 ? 'REABERTURA' : 'SUBMISSAO';
      const u = await q(`UPDATE PM.AIP_GOAL_CARD SET TP_ESTADO = 'EM_APROVACAO', NO_VERSAO_OFICIAL = NULL, DS_RASCUNHO = NULL, CD_MATRICULA = @mat, DT_ATUALIZACAO = SYSDATETIME()
        WHERE ID_GOAL_CARD = @id AND TP_ESTADO IN ('RASCUNHO', 'EM_REVISAO')`, { id: P.int(card.id), mat: P.vc(ctx.quem) });
      if (!u.rowsAffected[0]) throw conflito('O card não está em edição.');
      await q(`INSERT PM.AIP_GOAL_CARD_VERSAO (ID_GOAL_CARD, NO_VERSAO, TP_MOTIVO, DS_CAMPOS, CD_MATRICULA_AUTOR) VALUES (@id, @n, @motivo, @ds, @mat)`,
        { id: P.int(card.id), n: P.sm(n), motivo: P.vc(motivo), ds: P.max(JSON.stringify(secoes)), mat: P.vc(ctx.quem) });
      await evento(q, { ciclo: card.idCiclo, tipo: 'SUBMISSAO', quem: ctx.quem, grupo: grupoDoUsuario(ctx.papeis), card: card.id, comentario: n > 1 ? `resubmeteu como v${n}` : 'submeteu a v1' });
      return { estado: 'em_aprovacao', versao: n };
    });
  }
  async function reabrir(card, ctx) {
    return transacao(async (q) => {
      const u = await q(`UPDATE PM.AIP_GOAL_CARD SET TP_ESTADO = 'RASCUNHO', NO_VERSAO_OFICIAL = NULL, CD_MATRICULA = @mat, DT_ATUALIZACAO = SYSDATETIME()
        WHERE ID_GOAL_CARD = @id AND TP_ESTADO = 'APROVADO'`, { id: P.int(card.id), mat: P.vc(ctx.quem) });
      if (!u.rowsAffected[0]) throw conflito('Só um card aprovado pode ser reaberto.');
      await evento(q, { ciclo: card.idCiclo, tipo: 'REABERTURA', quem: ctx.quem, grupo: 'ADMIN', card: card.id, comentario: `reabriu o card aprovado (v${card.versao})`, antes: 'Aprovado', depois: 'Rascunho' });
      return { estado: 'rascunho' };
    });
  }
  async function decidir(card, corpo, ctx) {
    const aprovar = corpo.decisao === 'aprovar';
    const revisao = corpo.revisao || {}, ajustes = corpo.ajustes || {};
    const marcadas = Object.keys(revisao).filter((k) => revisao[k] === 'ajustar');
    return transacao(async (q) => {
      const v = await q('SELECT TOP (1) ID_VERSAO, NO_VERSAO FROM PM.AIP_GOAL_CARD_VERSAO WHERE ID_GOAL_CARD = @id ORDER BY NO_VERSAO DESC', { id: P.int(card.id) });
      const ver = v.recordset[0];
      if (!ver) throw conflito('O card não tem versão submetida.');
      const d = await q(`UPDATE PM.AIP_GOAL_CARD_VERSAO SET TP_DECISAO = @dec, DS_COMENTARIO_DECISAO = @com, DS_REVISAO_SECOES = @rev, DT_DECISAO = SYSDATETIME(), CD_MATRICULA_DECISAO = @mat
        WHERE ID_VERSAO = @idv AND TP_DECISAO IS NULL`, { dec: P.vc(aprovar ? 'APROVADO' : 'DEVOLVIDO'), com: P.nv(String(corpo.comentario || '').trim() || null),
        rev: P.max(JSON.stringify({ revisao, ajustes })), mat: P.vc(ctx.quem), idv: P.int(ver.ID_VERSAO) });
      if (!d.rowsAffected[0]) throw conflito('Esta versão já foi decidida.');
      const u = await q(`UPDATE PM.AIP_GOAL_CARD SET TP_ESTADO = @estado, NO_VERSAO_OFICIAL = @oficial, DT_ATUALIZACAO = SYSDATETIME()
        WHERE ID_GOAL_CARD = @id AND TP_ESTADO = 'EM_APROVACAO'`, { estado: P.vc(aprovar ? 'APROVADO' : 'EM_REVISAO'), oficial: P.sm(aprovar ? ver.NO_VERSAO : null), id: P.int(card.id) });
      if (!u.rowsAffected[0]) throw conflito('O card não está em aprovação.');
      const grupo = grupoDoUsuario(ctx.papeis);
      const idDec = await evento(q, { ciclo: card.idCiclo, tipo: 'DECISAO', quem: ctx.quem, grupo, card: card.id, secao: marcadas[0] || null,
        comentario: aprovar ? `aprovou a v${ver.NO_VERSAO}; versão oficial` : (String(corpo.comentario || '').trim() || `devolveu a v${ver.NO_VERSAO} para ajuste`),
        antes: 'Em aprovação', depois: aprovar ? 'Aprovado' : 'Devolvido para ajuste' });
      // O texto de cada item marcado para ajuste vira comentário da seção (a BU vê no Goal Card)
      for (const s of marcadas) {
        const t = String(ajustes[s] || '').trim();
        if (t) await evento(q, { ciclo: card.idCiclo, tipo: 'COMENTARIO', quem: ctx.quem, grupo, card: card.id, secao: s, comentario: t.slice(0, 4000), pai: null, antes: null, depois: `decisão EV-${idDec}` });
      }
      return { estado: aprovar ? 'aprovado' : 'em_revisao' };
    });
  }
  async function comentar(card, secao, texto, ctx) {
    const id = await transacao((q) => evento(q, { ciclo: card.idCiclo, tipo: 'COMENTARIO', quem: ctx.quem, grupo: grupoDoUsuario(ctx.papeis), card: card.id, secao, comentario: texto }));
    return { id: `EV-${id}`, secao, autor: ctx.nome, papel: 'aprovador', quando: isoDia(new Date()), texto, respostas: [] };
  }
  async function registrarNegado(ctx, detalhe) {
    if (!ctx || !ctx.quem || !ctx.idCiclo) return;
    await transacao((q) => evento(q, { ciclo: ctx.idCiclo, tipo: 'ACESSO_NEGADO', quem: ctx.quem, grupo: grupoDoUsuario(ctx.papeis), comentario: detalhe }));
  }

  // Código do Goal Card por site: GC-<3 letras>-<nº da meta>, único no ciclo
  function prefixos(nome) {
    const l = semAcento(nome).toUpperCase().replace(/[^A-Z]/g, '');
    const c = l.length >= 3 ? [l.slice(0, 3), l[0] + l[1] + l[l.length - 1], l[0] + l.slice(-2), l[0] + l[2] + l[l.length - 1]] : [(l + 'XX').slice(0, 2)];
    return [...new Set(c)];
  }
  // Cria os Goal Cards que faltam: um por site ativo × meta da BU com peso (e a meta nº 0, se houver pontos herdados)
  async function sincronizarCards(q, idCiclo, quem) {
    // Meta 0 ("resultado do nível acima") da BU e do COO; a do COO guarda em VL_PESO os pontos herdados do CEO (D-44)
    await q(`IF NOT EXISTS (SELECT 1 FROM PM.AIP_META WHERE ID_CICLO = @ciclo AND CD_NIVEL = 'BU' AND NO_META = 0)
      INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO) VALUES (@ciclo, 'BU', 0, @tit, 'FORMULA', 'MAIOR');
      IF EXISTS (SELECT 1 FROM PM.AIP_META WHERE ID_CICLO = @ciclo AND CD_NIVEL = 'COO' AND NO_META = 0)
        UPDATE m SET VL_PESO = c.QTDE_PONTOS_HERDADOS_COO, SG_ATIVA = 'S' FROM PM.AIP_META m JOIN PM.AIP_CICLO c ON c.ID_CICLO = m.ID_CICLO WHERE m.ID_CICLO = @ciclo AND m.CD_NIVEL = 'COO' AND m.NO_META = 0
      ELSE INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, VL_PESO)
        SELECT @ciclo, 'COO', 0, @titCoo, 'FORMULA', 'MAIOR', QTDE_PONTOS_HERDADOS_COO FROM PM.AIP_CICLO WHERE ID_CICLO = @ciclo`,
    { ciclo: P.int(idCiclo), tit: P.nv(TITULO_RESULTADO, 100), titCoo: P.nv("CEO's Scorecard Result", 100) });
    // Unidades fora das BUs (CEO, COO e níveis abaixo da BU com metas no ciclo) entram no ciclo para receber Goal Cards
    await q(`INSERT PM.AIP_CICLO_SITE (ID_CICLO, ID_SITE, SG_ATIVA, NM_AREA, NM_RESPONSAVEL_AREA)
      SELECT @ciclo, u.ID_UNIDADE_ORGANIZACIONAL, 'S', u.NM_AREA, u.NM_RESPONSAVEL_AREA FROM PM.UNIDADE_ORGANIZACIONAL u
      WHERE u.NO_NIVEL_HIERARQUIA <> ${NIVEL_BU} AND u.NO_NIVEL_HIERARQUIA > 1
        AND EXISTS (SELECT 1 FROM PM.AIP_META m WHERE m.ID_CICLO = @ciclo AND m.SG_ATIVA = 'S' AND m.CD_NIVEL = CASE u.NO_NIVEL_HIERARQUIA WHEN 2 THEN 'CEO' WHEN 3 THEN 'COO' ELSE 'N' + CAST(u.NO_NIVEL_HIERARQUIA AS VARCHAR(2)) END)
        AND NOT EXISTS (SELECT 1 FROM PM.AIP_CICLO_SITE cs WHERE cs.ID_CICLO = @ciclo AND cs.ID_SITE = u.ID_UNIDADE_ORGANIZACIONAL)`, { ciclo: P.int(idCiclo) });
    // Cards que faltam: meta × unidade do mesmo nível com peso (CEO/COO: peso da meta; BU e N5+: peso por unidade; meta 0: pontos herdados)
    const faltam = await q(`SELECT m.ID_META, m.NO_META, cs.ID_SITE, ${NOME_SITE('s')} AS NM_SITE
      FROM PM.AIP_META m
      JOIN PM.AIP_CICLO c ON c.ID_CICLO = m.ID_CICLO
      JOIN PM.AIP_CICLO_SITE cs ON cs.ID_CICLO = m.ID_CICLO AND cs.SG_ATIVA = 'S'
      JOIN ${SITES} s ON s.ID_SITE = cs.ID_SITE
        AND s.NO_NIVEL_HIERARQUIA = CASE m.CD_NIVEL WHEN 'CEO' THEN 2 WHEN 'COO' THEN 3 WHEN 'BU' THEN ${NIVEL_BU} ELSE CAST(SUBSTRING(m.CD_NIVEL, 2, 1) AS INT) END
      LEFT JOIN PM.AIP_META_PESO mp ON mp.ID_META = m.ID_META AND mp.ID_SITE = cs.ID_SITE
      WHERE m.ID_CICLO = @ciclo AND m.SG_ATIVA = 'S' AND (CASE WHEN m.CD_NIVEL IN ('CEO', 'COO') OR (m.NO_META = 0 AND m.CD_NIVEL <> 'BU') THEN m.VL_PESO WHEN m.NO_META = 0 THEN c.QTDE_PONTOS_HERDADOS_BU ELSE mp.VL_PESO END) > 0
        AND NOT EXISTS (SELECT 1 FROM PM.AIP_GOAL_CARD gc WHERE gc.ID_META = m.ID_META AND gc.ID_SITE = cs.ID_SITE)`, { ciclo: P.int(idCiclo) });
    if (!faltam.recordset.length) return 0;
    const usados = await q(`SELECT gc.CD_GOAL_CARD, gc.ID_SITE FROM PM.AIP_GOAL_CARD gc JOIN PM.AIP_META m ON m.ID_META = gc.ID_META WHERE m.ID_CICLO = @ciclo`, { ciclo: P.int(idCiclo) });
    // Prefixo de cada site: o que ele já usa no ciclo, senão o primeiro livre
    const prefSite = new Map(), donoPref = new Map();
    usados.recordset.forEach((u) => { const pf = u.CD_GOAL_CARD.split('-')[1]; prefSite.set(u.ID_SITE, pf); donoPref.set(pf, u.ID_SITE); });
    for (const f of faltam.recordset) {
      if (!prefSite.has(f.ID_SITE)) {
        const pf = prefixos(f.NM_SITE).find((x) => !donoPref.has(x));
        if (!pf) throw new Error(`sem código livre de Goal Card para o site ${f.NM_SITE}`);
        prefSite.set(f.ID_SITE, pf); donoPref.set(pf, f.ID_SITE);
      }
      await q(`INSERT PM.AIP_GOAL_CARD (CD_GOAL_CARD, ID_META, ID_SITE, CD_MATRICULA) VALUES (@cd, @meta, @site, @mat)`,
        { cd: P.vc(`GC-${prefSite.get(f.ID_SITE)}-${pad2(f.NO_META)}`), meta: P.int(f.ID_META), site: P.int(f.ID_SITE), mat: P.vc(quem) });
    }
    return faltam.recordset.length;
  }

  async function siteIdsPorNome(q, nomes) {
    const r = await q('SELECT ID_UNIDADE_ORGANIZACIONAL AS ID_SITE, NM_UNIDADE_ORGANIZACIONAL AS NM_SITE FROM PM.UNIDADE_ORGANIZACIONAL');
    const mapa = new Map();
    r.recordset.forEach((s) => { const k = chaveSite(s.NM_SITE); if (!mapa.has(k)) mapa.set(k, s.ID_SITE); });
    return (nomes || []).map((n) => mapa.get(chaveSite(n)) || null);
  }

  // Grava uma aba da Administração (já validada pelo router). Devolve { erros } quando algo não existe no banco.
  async function salvarConfiguracao(aba, d, ctx, base) {
    if (!base._aberto) throw conflito('O ciclo está fechado: reabra-o para alterar.');
    const idCiclo = base._idCiclo;
    return transacao(async (q) => {
      let detalhe = '';
      if (aba === 'ciclo') {
        const et = d.etapas.map((e, i) => ({ ini: e.inicio || d.etapas[i - 1].fim, fim: e.fim }));
        await q(`UPDATE PM.AIP_CICLO SET NO_ANO = @ano, NM_CICLO = @nome,
            DT_INI_DESDOBRAMENTO = @i0, DT_FIM_DESDOBRAMENTO = @f0, DT_INI_PROPOSTA = @i1, DT_FIM_PROPOSTA = @f1,
            DT_INI_CALIBRACAO = @i2, DT_FIM_CALIBRACAO = @f2, DT_INI_OFICIAL = @i3, DT_FIM_OFICIAL = @f3
          WHERE ID_CICLO = @ciclo`, { ano: P.sm(d.ano), nome: P.nv(String(d.nome).trim(), 100), ciclo: P.int(idCiclo),
          ...Object.fromEntries(et.flatMap((e, i) => [['i' + i, P.dt(e.ini)], ['f' + i, P.dt(e.fim)]])) });
        detalhe = 'alterou o nome e as datas do ciclo';
      }
      if (aba === 'parametros') {
        const nv = Object.fromEntries((d.niveis || []).map((n) => [n.id, Number(n.herdado) || 0]));
        await q('UPDATE PM.AIP_CICLO SET QTDE_PONTOS_HERDADOS_COO = @coo, QTDE_PONTOS_HERDADOS_BU = @bu WHERE ID_CICLO = @ciclo',
          { coo: P.sm(nv.coo != null ? nv.coo : base.niveis[1].herdado), bu: P.sm(nv.bu != null ? nv.bu : base.niveis[2].herdado), ciclo: P.int(idCiclo) });
        detalhe = `pontos herdados: COO ${nv.coo} · BU ${nv.bu}`;
      }
      if (aba === 'bus') {
        // Unidades organizacionais (D-40): estrutura (org) + BUs (nível 4). id = existente; chave = nova (o pai pode ser uma chave)
        const lista = (d.org || []).concat(d.bus || []);
        const existentes = (await q('SELECT ID_UNIDADE_ORGANIZACIONAL AS ID FROM PM.UNIDADE_ORGANIZACIONAL')).recordset.map((x) => Number(x.ID));
        const ficam = new Set(lista.filter((u) => u.id).map((u) => Number(u.id)));
        const sair = existentes.filter((id) => !ficam.has(id));
        // Excluir só unidade sem filhas que ficam e sem Goal Card submetido ou comentado; o resto (pesos, papéis, cards vazios) sai junto
        for (const id of sair) {
          const v = (await q(`SELECT
              (SELECT COUNT(*) FROM PM.UNIDADE_ORGANIZACIONAL f WHERE f.ID_UNIDADE_PAI = @id) AS FILHAS,
              (SELECT COUNT(*) FROM PM.AIP_GOAL_CARD gc WHERE gc.ID_SITE = @id AND (EXISTS (SELECT 1 FROM PM.AIP_GOAL_CARD_VERSAO v WHERE v.ID_GOAL_CARD = gc.ID_GOAL_CARD)
                 OR EXISTS (SELECT 1 FROM PM.AIP_EVENTO_LOG e WHERE e.ID_GOAL_CARD = gc.ID_GOAL_CARD))) AS CARDS`, { id: P.int(id) })).recordset[0];
          const filhasSaem = (await q('SELECT ID_UNIDADE_ORGANIZACIONAL AS ID FROM PM.UNIDADE_ORGANIZACIONAL WHERE ID_UNIDADE_PAI = @id', { id: P.int(id) })).recordset.every((x) => sair.includes(Number(x.ID)));
          if (v.CARDS || (v.FILHAS && !filhasSaem)) return { erros: [{ campo: 'bus', codigo: 'VINCULO', id }] };
        }
        // Grava em ordem de nível (o pai antes da filha); chave nova → id
        const idDe = new Map();
        const resolver = (p) => (p == null || p === '' ? null : typeof p === 'number' || /^\d+$/.test(String(p)) ? Number(p) : idDe.get(String(p)) || null);
        for (const u of lista.slice().sort((a, b) => Number(a.nivel) - Number(b.nivel))) {
          const prm = { nome: P.nv(String(u.sigla || u.nome).trim(), 100), nivel: P.sm(Number(u.nivel)), pai: P.int(resolver(u.pai)), area: P.nv(String(u.area || '').trim() || null, 100),
            resp: P.nv(String(u.responsavel || '').trim() || null, 150), escopo: P.nv(String(u.escopo || u.pais || '').trim(), 50), mat: P.vc(ctx.quem) };
          if (u.id) {
            await q(`UPDATE PM.UNIDADE_ORGANIZACIONAL SET NM_UNIDADE_ORGANIZACIONAL = @nome, NO_NIVEL_HIERARQUIA = @nivel, ID_UNIDADE_PAI = @pai, NM_AREA = @area,
                NM_RESPONSAVEL_AREA = @resp, NM_ESCOPO_ATUACAO = @escopo, CD_MATRICULA = @mat, DT_ATUALIZACAO = SYSDATETIME() WHERE ID_UNIDADE_ORGANIZACIONAL = @id`, { ...prm, id: P.int(u.id) });
            idDe.set(String(u.id), Number(u.id));
          } else {
            const r = await q(`INSERT PM.UNIDADE_ORGANIZACIONAL (NM_UNIDADE_ORGANIZACIONAL, NO_NIVEL_HIERARQUIA, ID_UNIDADE_PAI, NM_AREA, NM_RESPONSAVEL_AREA, NM_ESCOPO_ATUACAO, CD_MATRICULA)
              VALUES (@nome, @nivel, @pai, @area, @resp, @escopo, @mat); SELECT CAST(SCOPE_IDENTITY() AS INT) AS ID;`, prm);
            idDe.set(String(u.chave || u.nome), r.recordset[0].ID); u.id = r.recordset[0].ID;
          }
        }
        // Exclusões (filhas antes das mães): o que depende da unidade e não tem histórico sai junto
        for (const id of sair.slice().reverse()) {
          await q(`DELETE FROM PM.AIP_META_PESO WHERE ID_SITE = @id; DELETE FROM PM.AIP_PAPEL WHERE ID_SITE = @id;
            DELETE FROM PM.AIP_GOAL_CARD WHERE ID_SITE = @id; DELETE FROM PM.AIP_CICLO_SITE WHERE ID_SITE = @id;
            DELETE FROM PM.UNIDADE_ORGANIZACIONAL WHERE ID_UNIDADE_ORGANIZACIONAL = @id;`, { id: P.int(id) });
        }
        // Participação das BUs neste ciclo, com a área e o responsável do ciclo
        for (const b of d.bus || []) {
          const prm = { ciclo: P.int(idCiclo), site: P.int(b.id), ativa: P.vc(b.ativa ? 'S' : 'N', 1), area: P.nv(String(b.area || '').trim() || null, 100), resp: P.nv(String(b.responsavel || '').trim() || null, 150) };
          await q(`IF EXISTS (SELECT 1 FROM PM.AIP_CICLO_SITE WHERE ID_CICLO = @ciclo AND ID_SITE = @site)
              UPDATE PM.AIP_CICLO_SITE SET SG_ATIVA = @ativa, NM_AREA = @area, NM_RESPONSAVEL_AREA = @resp WHERE ID_CICLO = @ciclo AND ID_SITE = @site
            ELSE IF @ativa = 'S' INSERT PM.AIP_CICLO_SITE (ID_CICLO, ID_SITE, SG_ATIVA, NM_AREA, NM_RESPONSAVEL_AREA) VALUES (@ciclo, @site, @ativa, @area, @resp)`, prm);
        }
        detalhe = `${lista.length} unidade(s); ${(d.bus || []).filter((b) => b.ativa).length} BU(s) ativas no ciclo`;
      }
      if (aba === 'excecoes') {
        const siglas = Object.keys(d.bus || {}), ids = await siteIdsPorNome(q, siglas);
        for (let i = 0; i < siglas.length; i++) {
          if (!ids[i]) continue;
          const v = d.bus[siglas[i]];
          await q('UPDATE PM.AIP_CICLO_SITE SET DS_EXCECAO = @txt, SG_EXCECAO_VER = @ver WHERE ID_CICLO = @ciclo AND ID_SITE = @site',
            { txt: P.nv(String(v.texto || '').trim() || null), ver: P.vc(v.ver === false ? 'N' : 'S', 1), ciclo: P.int(idCiclo), site: P.int(ids[i]) });
        }
        detalhe = 'alterou as exceções e considerações dos sites';
      }
      if (aba === 'grupos') {
        const siglas = [...new Set(d.membros.filter((m) => m.bu).map((m) => m.bu))], ids = await siteIdsPorNome(q, siglas);
        const idDe = new Map(siglas.map((s, i) => [s, ids[i]]));
        const novos = d.membros.map((m) => ({ mat: String(m.matricula).trim(), grupo: GRUPO_PARA[m.grupo], site: m.grupo === 'contribuidor' ? idDe.get(m.bu) || null : null }));
        if (novos.some((m) => m.grupo === 'CONTRIBUIDOR' && !m.site)) return { erros: [{ campo: 'membros', codigo: 'BU' }] };
        const chave = (m) => `${m.mat}|${m.grupo}|${m.site || ''}`;
        const atuais = await q('SELECT ID_PAPEL, CD_MATRICULA, TP_GRUPO, ID_SITE, SG_ATIVO FROM PM.AIP_PAPEL WHERE ID_CICLO = @ciclo', { ciclo: P.int(idCiclo) });
        const existe = new Map(atuais.recordset.map((p) => [chave({ mat: String(p.CD_MATRICULA).trim(), grupo: p.TP_GRUPO, site: p.ID_SITE }), p]));
        const quero = new Set(novos.map(chave));
        let inc = 0, exc = 0;
        for (const m of novos) {
          const p = existe.get(chave(m));
          if (!p) { await q('INSERT PM.AIP_PAPEL (ID_CICLO, CD_MATRICULA, TP_GRUPO, ID_SITE) VALUES (@ciclo, @mat, @grupo, @site)', { ciclo: P.int(idCiclo), mat: P.vc(m.mat), grupo: P.vc(m.grupo), site: P.int(m.site) }); inc++; }
          else if (p.SG_ATIVO !== 'S') { await q("UPDATE PM.AIP_PAPEL SET SG_ATIVO = 'S', DT_ATUALIZACAO = SYSDATETIME() WHERE ID_PAPEL = @id", { id: P.int(p.ID_PAPEL) }); inc++; }
        }
        for (const [k, p] of existe) {
          if (p.SG_ATIVO === 'S' && !quero.has(k)) { await q("UPDATE PM.AIP_PAPEL SET SG_ATIVO = 'N', DT_ATUALIZACAO = SYSDATETIME() WHERE ID_PAPEL = @id", { id: P.int(p.ID_PAPEL) }); exc++; }
        }
        detalhe = `grupos: ${inc} inclusão(ões), ${exc} remoção(ões)`;
      }
      if (aba === 'metas') {
        // Unidades com peso por unidade: BUs e as dos níveis abaixo (N5+, D-43)
        const busMetas = (d.bus && d.bus.length ? d.bus : base.bus).map((b) => b.sigla).concat((d.org || base.org || []).map((u) => u.nome));
        const ids = await siteIdsPorNome(q, busMetas);
        const siteDe = new Map(busMetas.map((b, i) => [b, ids[i]]));
        const { metas } = await metasDoCiclo(idCiclo, q);
        const cooPorCodigo = new Map(metas.filter((m) => m.CD_NIVEL === 'COO' && m.NO_META > 0).map((m) => [codigoOrigem(base.ciclo.ano, m.NO_META), m.ID_META]));
        const niveisN = Object.keys(d.metasNivel || {}).filter((k) => /^n[5-9]$/.test(k));
        const porUnidade = (nv) => nv === 'bu' || /^n[5-9]$/.test(nv);
        for (const nivel of ['ceo', 'coo', 'bu'].concat(niveisN)) {
          const NV = nivel.toUpperCase(), lista = (d.metasNivel || {})[nivel] || [];
          const vistos = new Set();
          for (const m of lista) {
            const numero = Number(m.numero);
            if (!Number.isInteger(numero) || numero < 1 || numero > 999 || vistos.has(numero)) continue;
            vistos.add(numero);
            const peso = porUnidade(nivel) ? null : Number((m.pesos || {})[NV]) || 0;
            const atual = metas.find((x) => x.CD_NIVEL === NV && x.NO_META === numero);
            const origem = nivel === 'bu' ? (m.origem ? cooPorCodigo.get(m.origem) || null : atual ? atual.ID_META_ORIGEM : null) : null;
            const prm = { ciclo: P.int(idCiclo), nivel: P.vc(NV), no: P.sm(numero), tit: P.nv(String(m.titulo).trim().slice(0, 100), 100),
              tipo: P.vc(m.tipo === 'marcos' ? 'MARCOS' : 'FORMULA'), ori: P.vc(m.polaridade === 'menor' ? 'MENOR' : 'MAIOR'), peso: P.dec(peso), origem: P.int(origem) };
            let idMeta;
            if (atual) {
              await q(`UPDATE PM.AIP_META SET NM_TITULO = @tit, TP_META = @tipo, TP_ORIENTACAO = @ori, VL_PESO = @peso, ID_META_ORIGEM = @origem, SG_ATIVA = 'S'
                WHERE ID_CICLO = @ciclo AND CD_NIVEL = @nivel AND NO_META = @no`, prm);
              idMeta = atual.ID_META;
            } else {
              const r = await q(`INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, VL_PESO, ID_META_ORIGEM)
                VALUES (@ciclo, @nivel, @no, @tit, @tipo, @ori, @peso, @origem); SELECT CAST(SCOPE_IDENTITY() AS INT) AS ID;`, prm);
              idMeta = r.recordset[0].ID;
            }
            if (porUnidade(nivel)) {
              await q('DELETE FROM PM.AIP_META_PESO WHERE ID_META = @id', { id: P.int(idMeta) });
              for (const [sigla, v] of Object.entries(m.pesos || {})) {
                if (Number(v) > 0 && siteDe.get(sigla)) await q('INSERT PM.AIP_META_PESO (ID_META, ID_SITE, VL_PESO) VALUES (@id, @site, @peso)', { id: P.int(idMeta), site: P.int(siteDe.get(sigla)), peso: P.dec(v) });
              }
            }
          }
          // Metas que saíram da tela ficam inativas (o histórico e os Goal Cards continuam no banco)
          for (const x of metas.filter((x) => x.CD_NIVEL === NV && x.NO_META > 0 && x.SG_ATIVA === 'S' && !vistos.has(x.NO_META))) {
            await q("UPDATE PM.AIP_META SET SG_ATIVA = 'N' WHERE ID_META = @id", { id: P.int(x.ID_META) });
          }
          // Nível N5+: a meta 0 ("Resultado do nível acima") guarda os pontos herdados
          if (/^n[5-9]$/.test(nivel)) {
            const herd = Number(((d.niveis || []).find((n) => n.id === nivel) || {}).herdado) || 0;
            await q(`IF EXISTS (SELECT 1 FROM PM.AIP_META WHERE ID_CICLO = @ciclo AND CD_NIVEL = @nivel AND NO_META = 0)
                UPDATE PM.AIP_META SET VL_PESO = @peso, SG_ATIVA = 'S' WHERE ID_CICLO = @ciclo AND CD_NIVEL = @nivel AND NO_META = 0
              ELSE INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, VL_PESO) VALUES (@ciclo, @nivel, 0, @tit, 'FORMULA', 'MAIOR', @peso)`,
            { ciclo: P.int(idCiclo), nivel: P.vc(NV), peso: P.dec(herd), tit: P.nv(NV === 'N5' ? 'BU Result' : `Level ${Number(NV.slice(1)) - 1} Result`, 100) });
          }
        }
        // Nível retirado do desdobramento (×): todas as metas dele ficam inativas (o histórico continua no banco)
        for (const nv of [...new Set(metas.filter((x) => /^N[5-9]$/.test(x.CD_NIVEL) && x.SG_ATIVA === 'S').map((x) => x.CD_NIVEL))].filter((nv) => !niveisN.includes(nv.toLowerCase()))) {
          await q("UPDATE PM.AIP_META SET SG_ATIVA = 'N' WHERE ID_CICLO = @ciclo AND CD_NIVEL = @nivel", { ciclo: P.int(idCiclo), nivel: P.vc(nv) });
        }
        detalhe = 'alterou as metas e os pesos';
      }
      if (['bus', 'metas', 'parametros'].includes(aba)) await sincronizarCards(q, idCiclo, ctx.quem);
      await evento(q, { ciclo: idCiclo, tipo: 'CONFIGURACAO', quem: ctx.quem, grupo: 'ADMIN', secao: aba, comentario: detalhe });
      console.log(`${TAG} configuração gravada: aba ${aba}, ciclo ${idCiclo}, ${detalhe} (por ${ctx.quem})`);
      return { ok: true };
    });
  }

  // Fechar, reabrir ou abrir um novo ciclo no ano escolhido (cópia do atual: BUs, grupos, metas e pesos; datas no novo ano)
  async function acaoCiclo(acao, ano, ctx, etapas) {
    return transacao(async (q) => {
      const aberto = (await q("SELECT ID_CICLO FROM PM.AIP_CICLO WHERE SG_STATUS = 'S'")).recordset[0];
      if (acao === 'fechar') {
        const u = await q(`UPDATE PM.AIP_CICLO SET SG_STATUS = 'N', DT_FECHAMENTO = SYSDATETIME(), CD_MATRICULA_FECHAMENTO = @mat WHERE NO_ANO = @ano AND SG_STATUS = 'S';
          SELECT ID_CICLO FROM PM.AIP_CICLO WHERE NO_ANO = @ano;`, { mat: P.vc(ctx.quem), ano: P.sm(ano) });
        if (!u.rowsAffected[0]) throw conflito('Esse ciclo não está aberto.');
        await evento(q, { ciclo: u.recordset[0].ID_CICLO, tipo: 'CICLO_FECHADO', quem: ctx.quem, grupo: 'ADMIN', secao: 'ciclo', comentario: 'fechou o ciclo', antes: 'Aberto', depois: 'Fechado' });
        return { ok: true };
      }
      if (aberto) throw conflito('Já existe um ciclo aberto: feche-o antes.');
      if (acao === 'reabrir') {
        const u = await q(`UPDATE PM.AIP_CICLO SET SG_STATUS = 'S', DT_FECHAMENTO = NULL, CD_MATRICULA_FECHAMENTO = NULL WHERE NO_ANO = @ano AND SG_STATUS = 'N';
          SELECT ID_CICLO FROM PM.AIP_CICLO WHERE NO_ANO = @ano;`, { ano: P.sm(ano) });
        if (!u.rowsAffected[0]) throw conflito('Ciclo não encontrado.');
        await evento(q, { ciclo: u.recordset[0].ID_CICLO, tipo: 'CICLO_REABERTO', quem: ctx.quem, grupo: 'ADMIN', secao: 'ciclo', comentario: 'reabriu o ciclo', antes: 'Fechado', depois: 'Aberto' });
        return { ok: true };
      }
      // novo
      const atual = await cicloAtualLinha(q);
      if (!atual) throw conflito('Nenhum ciclo para copiar.');
      // Ano escolhido pelo administrador (maior que o atual, validado na API)
      const novoAno = Number.isInteger(ano) ? ano : atual.NO_ANO + 1;
      if ((await q('SELECT 1 AS X FROM PM.AIP_CICLO WHERE NO_ANO = @ano', { ano: P.sm(novoAno) })).recordset.length) throw conflito(`Já existe o ciclo AIP ${novoAno}.`);
      // Datas: em branco (o administrador escolhe na aba Ciclo, D-35); se vierem etapas, grava as escolhidas
      const dt = etapas && etapas.length === 4 ? Object.fromEntries(etapas.flatMap((e, i) => [['i' + i, P.dt(i === 0 ? e.inicio : etapas[i - 1].fim)], ['f' + i, P.dt(e.fim)]])) : null;
      const datas = dt
        ? ['@i0', '@f0', '@i1', '@f1', '@i2', '@f2', '@i3', '@f3']
        : Array(8).fill('NULL');
      // Sem datas: o banco precisa aceitar janelas em branco (database/001_pm_criar_tabelas.sql atual)
      if (!dt) {
        const nn = await q(`SELECT COUNT(*) AS N FROM sys.columns WHERE object_id = OBJECT_ID('PM.AIP_CICLO') AND is_nullable = 0
          AND name IN ('DT_INI_DESDOBRAMENTO', 'DT_FIM_DESDOBRAMENTO', 'DT_INI_PROPOSTA', 'DT_FIM_PROPOSTA', 'DT_INI_CALIBRACAO', 'DT_FIM_CALIBRACAO', 'DT_INI_OFICIAL', 'DT_FIM_OFICIAL')`);
        if (nn.recordset[0].N > 0) {
          console.error(`${TAG} novo ciclo: as datas de PM.AIP_CICLO ainda não aceitam NULL; recrie com database/000, 001 e 002`);
          throw conflito('O banco ainda não aceita ciclo com datas em branco. Recrie as tabelas com os scripts 000, 001 e 002 e tente de novo.');
        }
      }
      const r = await q(`INSERT PM.AIP_CICLO (NO_ANO, NM_CICLO, SG_STATUS, ID_CICLO_ORIGEM, CD_MATRICULA_CRIACAO,
          DT_INI_DESDOBRAMENTO, DT_FIM_DESDOBRAMENTO, DT_INI_PROPOSTA, DT_FIM_PROPOSTA, DT_INI_CALIBRACAO, DT_FIM_CALIBRACAO, DT_INI_OFICIAL, DT_FIM_OFICIAL,
          QTDE_PONTOS_HERDADOS_COO, QTDE_PONTOS_HERDADOS_BU)
        SELECT @ano, @nome, 'S', ID_CICLO, @mat,
          ${datas.join(', ')},
          QTDE_PONTOS_HERDADOS_COO, QTDE_PONTOS_HERDADOS_BU
        FROM PM.AIP_CICLO WHERE ID_CICLO = @origem; SELECT CAST(SCOPE_IDENTITY() AS INT) AS ID;`,
      { ano: P.sm(novoAno), ...(dt || {}), nome: P.nv(`AIP ${novoAno}`, 100), mat: P.vc(ctx.quem), origem: P.int(atual.ID_CICLO) });
      const novo = r.recordset[0].ID, prm = { novo: P.int(novo), origem: P.int(atual.ID_CICLO) };
      await q(`INSERT PM.AIP_CICLO_SITE (ID_CICLO, ID_SITE, SG_ATIVA, NM_AREA, NM_RESPONSAVEL_AREA, DS_EXCECAO, SG_EXCECAO_VER)
        SELECT @novo, ID_SITE, SG_ATIVA, NM_AREA, NM_RESPONSAVEL_AREA, DS_EXCECAO, SG_EXCECAO_VER FROM PM.AIP_CICLO_SITE WHERE ID_CICLO = @origem`, prm);
      await q(`INSERT PM.AIP_PAPEL (ID_CICLO, CD_MATRICULA, TP_GRUPO, ID_SITE)
        SELECT @novo, CD_MATRICULA, TP_GRUPO, ID_SITE FROM PM.AIP_PAPEL WHERE ID_CICLO = @origem AND SG_ATIVO = 'S'`, prm);
      await q(`INSERT PM.AIP_META (ID_CICLO, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, VL_PESO)
        SELECT @novo, CD_NIVEL, NO_META, NM_TITULO, TP_META, TP_ORIENTACAO, VL_PESO FROM PM.AIP_META WHERE ID_CICLO = @origem AND SG_ATIVA = 'S'`, prm);
      // Origem (meta do COO) refeita entre as metas do novo ciclo, pelo nível e número
      await q(`UPDATE n SET n.ID_META_ORIGEM = nn.ID_META
        FROM PM.AIP_META n
        JOIN PM.AIP_META a ON a.ID_CICLO = @origem AND a.CD_NIVEL = n.CD_NIVEL AND a.NO_META = n.NO_META
        JOIN PM.AIP_META ao ON ao.ID_META = a.ID_META_ORIGEM
        JOIN PM.AIP_META nn ON nn.ID_CICLO = @novo AND nn.CD_NIVEL = ao.CD_NIVEL AND nn.NO_META = ao.NO_META
        WHERE n.ID_CICLO = @novo`, prm);
      await q(`INSERT PM.AIP_META_PESO (ID_META, ID_SITE, VL_PESO)
        SELECT n.ID_META, mp.ID_SITE, mp.VL_PESO
        FROM PM.AIP_META_PESO mp
        JOIN PM.AIP_META a ON a.ID_META = mp.ID_META AND a.ID_CICLO = @origem
        JOIN PM.AIP_META n ON n.ID_CICLO = @novo AND n.CD_NIVEL = a.CD_NIVEL AND n.NO_META = a.NO_META`, prm);
      await sincronizarCards(q, novo, ctx.quem);
      await evento(q, { ciclo: novo, tipo: 'CICLO_ABERTO', quem: ctx.quem, grupo: 'ADMIN', secao: 'ciclo', comentario: `abriu o ciclo a partir do ${atual.NM_CICLO}`, antes: null, depois: 'Aberto' });
      return { ok: true, novoCiclo: { id: `AIP-${novoAno}`, nome: `AIP ${novoAno}`, ano: novoAno } };
    });
  }

  return {
    fonte: 'banco', exemplo: false,
    contexto, ciclo: async (hoje) => { const cc = await cicloCompleto(hoje); return cc ? cc.ciclo : null; },
    painel, desdobramento, goalCard, versoes, actionLog, configuracao,
    buscarPessoas, hierarquiaMdm, salvarRascunho, submeter, reabrir, decidir, comentar, registrarNegado, salvarConfiguracao, acaoCiclo,
    _sql: { SQL_CARDS }, // exposto para o teste de sintaxe
  };
}

module.exports = { criarFonteBanco };
