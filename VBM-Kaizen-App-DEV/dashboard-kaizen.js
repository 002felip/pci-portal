/**
 * VBM Kaizen — API do DASHBOARD (dashboard.html).
 *
 * Três rotas, todas montadas no apiRouter do server.js por
 * registrarRotasDashboard():
 *
 *   GET  /api/dashboard/dados      fatos de TODOS os Kaizens (atual +
 *                                  histórico), compactados, para a tela
 *                                  filtrar e agregar no navegador
 *   GET  /api/dashboard/detalhes   título e equipe de cada Kaizen — só
 *                                  quando a aba Base de Dados é aberta
 *   POST /api/dashboard/exportar   Excel dos Kaizens que a tela está
 *                                  mostrando (Base de Dados ou
 *                                  Detalhamento por líder)
 *
 * POR QUE O NAVEGADOR AGREGA, E NÃO O SQL
 *   O dashboard tem 12 filtros em cascata (cada combo mostra quantos
 *   Kaizens sobram com os OUTROS filtros aplicados) e quatro páginas de
 *   gráficos. Agregar no banco seria uma ida ao Azure SQL por gráfico e
 *   por combo a cada clique — e do Databricks Apps até lá cada ida paga
 *   a latência da rede (ver o Server-Timing em server.js). Aqui é UMA
 *   consulta (UNION ALL atual + histórico), guardada em cache por alguns
 *   minutos e compartilhada por todos que abrem a tela. Os ~13 mil
 *   Kaizens viajam como inteiros (os textos repetidos vão num dicionário
 *   único), algo na casa de 150 KB depois do gzip.
 *
 * ORIGEM DOS DADOS
 *   • Kaizens ............ fonteBiblioteca(): a MESMA fonte da Biblioteca
 *                          (kzn_pedravisaoconsolidada UNION ALL
 *                          kzn_hist_pedravisaoconsolidada). Data = a
 *                          DT_REFERENCIA de lá (criação do Kaizen), então
 *                          ano e mês batem com o filtro da Biblioteca.
 *   • Hierarquia ......... a FOTOGRAFIA gravada por Kaizen:
 *                          kzn_kaizen_hierarquia (atual) e
 *                          kzn_hist_kaizen_hierarquia (histórico), níveis
 *                          N3..N8. Sem fotografia, cai na linha do líder
 *                          em kzn_mdm_hierarquia (desligável por
 *                          KAIZEN_DASHBOARD_HIERARQUIA_MDM=false).
 *   • Pessoas ............ líder e site do autor no MDM da origem
 *                          (kzn_mdm_hierarquia / kzn_hist_mdm_vbm_terc),
 *                          como na Biblioteca. Aprovador pela matrícula
 *                          (PESSOA_DO_APROVADOR), resolvido UMA vez por
 *                          aprovador, não por Kaizen.
 *
 * NÍVEIS DA HIERARQUIA (conferidos contra a planilha de exemplo de
 * kzn_kaizen_hierarquia):
 *   N1 Presidente · N2 CEO Base Metals · N3 COO/CFO/CTO · N4 Diretoria ·
 *   N5 Head · N6 Gerência Geral · N7 Gerência de Área · N8 Coord./Sup.
 *   N1 e N2 são iguais para todo mundo e não viram filtro.
 *   Os textos 'NULL', 'N.A', 'N/A' e vazio, que aparecem na carga, são
 *   tratados como "não preenchido" — mesmo balde do NULL de verdade.
 */
"use strict";

/** Nível do MDM -> chave usada pela tela. A ordem é a da estrutura. */
const NIVEIS = [
  { n: 3, chave: "coo" },
  { n: 4, chave: "dir" },
  { n: 5, chave: "head" },
  { n: 6, chave: "gg" },
  { n: 7, chave: "ga" },
  { n: 8, chave: "cs" },
];

/** Momentos do ciclo que a tela distingue (ver NOMES_DO_STATUS em server.js). */
const MOMENTOS = ["aprovado", "emAprovacao", "revisado", "alteracao", "reprovado"];

/** Valores que a carga grava no lugar de "sem valor". */
const VAZIOS = new Set(["", "NULL", "N.A", "N.A.", "N/A", "NA", "-", "--"]);

function textoLimpo(v) {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return VAZIOS.has(t.toUpperCase()) ? null : t;
}

/** "AAAAMMDD" (CONVERT estilo 112) -> inteiro; qualquer outra coisa -> 0. */
function dataInt(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 19000101 ? n : 0;
}

/** "1-20,25,40-41" -> [1..20, 25, 40, 41]. Recusa (null) qualquer coisa
 *  fora desse formato e listas acima do teto. */
function expandirFaixas(texto, teto) {
  if (texto == null || texto === "") return [];
  const ids = [];
  for (const parte of String(texto).split(",")) {
    const m = /^\s*(\d{1,9})(?:\s*-\s*(\d{1,9}))?\s*$/.exec(parte);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (b < a) return null;
    if (ids.length + (b - a + 1) > teto) return null;
    for (let i = a; i <= b; i++) ids.push(i);
  }
  return ids;
}

function registrarRotasDashboard(api, d) {
  const { sql, runQuery } = d;
  const T = d.tabelas;

  // Cache curto e compartilhado. Cinco minutos: o dashboard é leitura de
  // acompanhamento, e um Kaizen recém-aprovado aparecer alguns minutos
  // depois é aceitável — ir ao banco a cada abertura de tela não é.
  const TTL_MS = Number(process.env.KAIZEN_DASHBOARD_CACHE_MS) || 5 * 60 * 1000;
  // "Atualizar" na tela força a recarga, mas não mais que uma vez a cada
  // 20 s: vários cliques seguidos não viram várias consultas pesadas.
  const RECARGA_MINIMA_MS = 20 * 1000;
  const USAR_MDM_SEM_FOTO = String(process.env.KAIZEN_DASHBOARD_HIERARQUIA_MDM || "true").toLowerCase() !== "false";
  const TETO_EXPORTACAO = 100000;

  let fatos = null;        // { em, payload, linhas }
  let fatosEmCurso = null;
  let detalhes = null;     // { em, porChave: Map }
  let detalhesEmCurso = null;

  /* ── Colunas reais de uma tabela (cache por processo) ─────────────
     A fotografia da hierarquia histórica foi carregada por fora do app;
     nada garante que tenha os oito níveis com o mesmo nome. Uma coluna
     citada e inexistente derrubaria a consulta inteira — o mesmo
     incidente que o ID_DESPERDICIO já causou na Biblioteca. Então o
     nome é conferido e o que faltar vira NULL, com aviso no log. */
  const colunasCache = new Map();
  async function colunasDe(nomeTabela) {
    if (colunasCache.has(nomeTabela)) return colunasCache.get(nomeTabela);
    let cols = new Set();
    try {
      const r = await runQuery(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela`,
        [["esquema", sql.NVarChar(128), d.esquema], ["tabela", sql.NVarChar(128), nomeTabela]]
      );
      cols = new Set(r.recordset.map((x) => String(x.COLUMN_NAME).toUpperCase()));
    } catch (err) {
      console.error(`[dashboard] não foi possível ler as colunas de ${d.esquema}.${nomeTabela}: ${err.message}`);
    }
    if (!cols.size) {
      console.warn(`[dashboard] ${d.esquema}.${nomeTabela} não encontrada — a hierarquia dessa origem ` +
        (USAR_MDM_SEM_FOTO ? "virá só do MDM." : "ficará em branco."));
    } else {
      const faltam = NIVEIS.map((x) => `NM_HIERARQUIA_N${x.n}`).filter((c) => !cols.has(c));
      if (faltam.length) console.warn(`[dashboard] ${d.esquema}.${nomeTabela} sem ${faltam.join(", ")} — esses níveis saem em branco.`);
    }
    colunasCache.set(nomeTabela, cols);
    return cols;
  }

  /* ── Os fatos de UMA origem ("A" atual, "H" histórico) ──────────── */
  async function consultaFatos(origem) {
    const h = origem === "H";
    const tab = d.tabelasDaOrigem(origem);
    const pessoas = h ? T.mdmHist : T.mdm;
    const fonte = await d.fonteBiblioteca(origem);
    const cols = await colunasDe(d.nomeHierarquia[origem]);
    const temFoto = cols.has("ID_KAIZEN");
    const nivelFoto = (n) => (temFoto && cols.has(`NM_HIERARQUIA_N${n}`) ? `hk.NM_HIERARQUIA_N${n}` : null);

    const listaFoto = NIVEIS.map((x) => nivelFoto(x.n)).filter(Boolean)
      .map((c) => c.replace("hk.", "hz."));
    const ordemFoto = cols.has("DT_ATUALIZACAO") ? "ORDER BY hz.DT_ATUALIZACAO DESC" : "";
    const applyFoto = temFoto
      ? `OUTER APPLY (
           SELECT TOP (1) hz.ID_KAIZEN${listaFoto.length ? ", " + listaFoto.join(", ") : ""}
             FROM ${tab.hierarquia} hz
            WHERE hz.ID_KAIZEN = p.ID_KAIZEN
            ${ordemFoto}
         ) hk`
      : "";
    const applyMdm = USAR_MDM_SEM_FOTO
      ? `OUTER APPLY (
           SELECT TOP (1) m.ID_USUARIO, ${NIVEIS.map((x) => `m.NM_HIERARQUIA_N${x.n}`).join(", ")}
             FROM ${T.mdm} m
            WHERE m.ID_USUARIO = p.ID_USUARIO_LIDER
            ORDER BY m.ID_TIPO_USUARIO
         ) hm`
      : "";

    // Fotografia existe -> vale ela INTEIRA, inclusive os níveis vazios.
    // Misturar nível a nível (COALESCE) penduraria um Kaizen antigo, que
    // legitimamente não tinha N7, na gerência de área de HOJE do líder.
    const nivel = (n) => {
      const foto = nivelFoto(n) || "CAST(NULL AS NVARCHAR(200))";
      const mdm = `hm.NM_HIERARQUIA_N${n}`;
      if (temFoto && USAR_MDM_SEM_FOTO) return `CASE WHEN hk.ID_KAIZEN IS NOT NULL THEN ${foto} ELSE ${mdm} END`;
      if (temFoto) return foto;
      if (USAR_MDM_SEM_FOTO) return mdm;
      return "CAST(NULL AS NVARCHAR(200))";
    };
    const fonteHier = temFoto && USAR_MDM_SEM_FOTO
      ? "CASE WHEN hk.ID_KAIZEN IS NOT NULL THEN 'F' WHEN hm.ID_USUARIO IS NOT NULL THEN 'M' ELSE '' END"
      : temFoto ? "CASE WHEN hk.ID_KAIZEN IS NOT NULL THEN 'F' ELSE '' END"
      : USAR_MDM_SEM_FOTO ? "CASE WHEN hm.ID_USUARIO IS NOT NULL THEN 'M' ELSE '' END" : "''";

    return `
      SELECT p.ORIGEM, p.ID_KAIZEN, p.ID_STATUS, p.ID_CATEGORIA, p.ID_APROVADOR,
             DT = CONVERT(CHAR(8), p.DT_REFERENCIA, 112),
             NM_LIDER = lider.NM_USUARIO,
             NM_SITE = autor.NM_SITE,
             FONTE_HIER = ${fonteHier},
             ${NIVEIS.map((x) => `N${x.n} = ${nivel(x.n)}`).join(",\n             ")}
        FROM ${fonte} p
        OUTER APPLY (
          SELECT TOP (1) x.NM_USUARIO
            FROM ${pessoas} x
           WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
           ORDER BY x.ID_TIPO_USUARIO
        ) lider
        OUTER APPLY (
          SELECT TOP (1) y.NM_SITE
            FROM ${pessoas} y
           WHERE y.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
           ORDER BY y.ID_TIPO_USUARIO
        ) autor
        ${applyFoto}
        ${applyMdm}`;
  }

  /* Aprovador -> nome, UMA vez por aprovador (são dezenas), em vez de
     uma busca no MDM por Kaizen (são milhares). A regra de casamento é a
     do resto do sistema (PESSOA_DO_APROVADOR). No histórico a pessoa
     pode ter saído da empresa: procura no espelho histórico e, se não
     achar, no MDM atual. */
  function consultaAprovadores(origem) {
    const h = origem === "H";
    const tabAprovador = h ? T.aprovadorHist : T.aprovador;
    const pessoas = h ? T.mdmHist : T.mdm;
    const atual = h
      ? `OUTER APPLY (
           SELECT TOP (1) x.NM_USUARIO FROM ${T.mdm} x
            WHERE ${d.PESSOA_DO_APROVADOR("a")}
            ORDER BY ${d.ORDEM_PESSOA_DO_APROVADOR("a")}
         ) pa`
      : "";
    return runQuery(
      `SELECT a.ID_APROVADOR, NM_USUARIO = ${h ? "ISNULL(ph.NM_USUARIO, pa.NM_USUARIO)" : "ph.NM_USUARIO"}
         FROM ${tabAprovador} a
         OUTER APPLY (
           SELECT TOP (1) x.NM_USUARIO FROM ${pessoas} x
            WHERE ${d.PESSOA_DO_APROVADOR("a")}
            ORDER BY ${d.ORDEM_PESSOA_DO_APROVADOR("a")}
         ) ph
         ${atual}`
    );
  }

  async function momentosDoStatus() {
    const porId = {};
    for (const m of MOMENTOS) {
      try {
        const id = await d.idDoStatus(m);
        if (id != null && porId[id] == null) porId[id] = m;
      } catch (err) {
        console.warn(`[dashboard] status "${m}" não resolvido: ${err.message}`);
      }
    }
    return porId;
  }

  async function montarFatos() {
    const inicio = Date.now();
    const [fA, fH] = await Promise.all([consultaFatos("A"), consultaFatos("H")]);
    const [rFatos, rStatus, rCat, rApA, rApH, momentos] = await Promise.all([
      runQuery(`${fA}\n      UNION ALL\n${fH}`),
      runQuery(`SELECT ID_STATUS, ID_IDIOMA, NM_STATUS FROM ${T.status}`),
      runQuery(`SELECT ID_CATEGORIA, ID_IDIOMA, NM_CATEGORIA FROM ${T.categoria}`),
      consultaAprovadores("A"),
      consultaAprovadores("H"),
      momentosDoStatus(),
    ]);

    // Dicionário único de textos: nomes, sites e níveis se repetem
    // milhares de vezes; cada linha leva só o índice.
    const textos = [];
    const indice = new Map();
    const idx = (v) => {
      const t = textoLimpo(v);
      if (t == null) return -1;
      let i = indice.get(t);
      if (i === undefined) { i = textos.length; textos.push(t); indice.set(t, i); }
      return i;
    };
    const nomeAprovador = { A: new Map(), H: new Map() };
    rApA.recordset.forEach((r) => nomeAprovador.A.set(r.ID_APROVADOR, r.NM_USUARIO));
    rApH.recordset.forEach((r) => nomeAprovador.H.set(r.ID_APROVADOR, r.NM_USUARIO));

    const contagem = { A: 0, H: 0, foto: 0, mdm: 0, semHierarquia: 0 };
    const vistos = new Set();
    const linhas = [];
    for (const r of rFatos.recordset) {
      const o = r.ORIGEM === "H" ? "H" : "A";
      const chave = o + r.ID_KAIZEN;
      // Duas linhas para o mesmo Kaizen só existiriam com fotografia
      // duplicada; TOP (1) já impede, isto é só a rede de segurança.
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      contagem[o]++;
      if (r.FONTE_HIER === "F") contagem.foto++;
      else if (r.FONTE_HIER === "M") contagem.mdm++;
      else contagem.semHierarquia++;
      linhas.push([
        o === "H" ? 1 : 0,
        r.ID_KAIZEN,
        dataInt(r.DT),
        r.ID_STATUS == null ? -1 : r.ID_STATUS,
        r.ID_CATEGORIA == null ? -1 : r.ID_CATEGORIA,
        idx(r.NM_LIDER),
        idx(r.ID_APROVADOR == null ? null : nomeAprovador[o].get(r.ID_APROVADOR)),
        idx(r.NM_SITE),
        ...NIVEIS.map((x) => idx(r[`N${x.n}`])),
      ]);
    }

    const status = {};
    rStatus.recordset.forEach((r) => {
      const s = status[r.ID_STATUS] || (status[r.ID_STATUS] = { id: r.ID_STATUS, pt: null, en: null, momento: momentos[r.ID_STATUS] || null });
      if (r.ID_IDIOMA === d.ID_IDIOMA_EN) s.en = r.NM_STATUS; else if (r.ID_IDIOMA === d.ID_IDIOMA_PT) s.pt = r.NM_STATUS;
    });
    const categorias = {};
    rCat.recordset.forEach((r) => {
      const c = categorias[r.ID_CATEGORIA] || (categorias[r.ID_CATEGORIA] = { id: r.ID_CATEGORIA, pt: null, en: null });
      if (r.ID_IDIOMA === d.ID_IDIOMA_EN) c.en = r.NM_CATEGORIA; else if (r.ID_IDIOMA === d.ID_IDIOMA_PT) c.pt = r.NM_CATEGORIA;
    });

    const payload = {
      geradoEm: new Date().toISOString(),
      validadeSegundos: Math.round(TTL_MS / 1000),
      colunas: ["origem", "id", "data", "status", "categoria", "lider", "aprovador", "site", ...NIVEIS.map((x) => x.chave)],
      niveis: NIVEIS.map((x) => ({ chave: x.chave, nivel: x.n })),
      status: Object.values(status).sort((a, b) => a.id - b.id),
      categorias: Object.values(categorias).sort((a, b) => a.id - b.id),
      textos,
      linhas,
      origem: {
        atual: contagem.A,
        historico: contagem.H,
        hierarquia: { fotografia: contagem.foto, mdm: contagem.mdm, semHierarquia: contagem.semHierarquia, mdmSemFoto: USAR_MDM_SEM_FOTO },
      },
    };
    console.log(`[dashboard] base montada: ${linhas.length} Kaizens (atual ${contagem.A}, histórico ${contagem.H}; ` +
      `hierarquia: fotografia ${contagem.foto}, MDM ${contagem.mdm}, sem ${contagem.semHierarquia}) em ${Date.now() - inicio} ms.`);
    return { em: Date.now(), payload, linhas, textos };
  }

  async function obterFatos(forcar) {
    const agora = Date.now();
    const valido = fatos && agora - fatos.em < TTL_MS;
    const podeForcar = !fatos || agora - fatos.em > RECARGA_MINIMA_MS;
    if (valido && !(forcar && podeForcar)) return fatos;
    if (!fatosEmCurso) {
      fatosEmCurso = montarFatos()
        .then((f) => { fatos = f; return f; })
        .finally(() => { fatosEmCurso = null; });
    }
    return fatosEmCurso;
  }

  /* ── Título e equipe (aba Base de Dados e exportação) ───────────── */
  function consultaDetalhes(origem) {
    const h = origem === "H";
    const tab = d.tabelasDaOrigem(origem);
    const pessoas = h ? T.mdmHist : T.mdm;
    // Pessoa por OUTER APPLY TOP (1), não LEFT JOIN: a PK do MDM atual é
    // composta e o mesmo ID_USUARIO aparece em mais de uma linha — um
    // JOIN repetiria o nome do membro na lista.
    const membros = (externo) => `(
          SELECT STRING_AGG(CAST(pm.NM_USUARIO AS NVARCHAR(MAX)), ', ')
            FROM ${tab.membros} me
            OUTER APPLY (
              SELECT TOP (1) x.NM_USUARIO, x.ID_TIPO_USUARIO
                FROM ${pessoas} x
               WHERE x.ID_USUARIO = me.ID_USUARIO
               ORDER BY x.ID_TIPO_USUARIO
            ) pm
           WHERE me.ID_KAIZEN = p.ID_KAIZEN
             AND ISNULL(pm.ID_TIPO_USUARIO, 0) ${externo ? "=" : "<>"} @tipoTerceiro)`;
    return `
      SELECT ORIGEM = '${h ? "H" : "A"}', p.ID_KAIZEN, p.NM_KAIZEN,
             MEMBROS = ${membros(false)},
             EXTERNOS = ${membros(true)}
        FROM ${tab.pvc} p`;
  }

  async function montarDetalhes() {
    const inicio = Date.now();
    const r = await runQuery(
      `${consultaDetalhes("A")}\n      UNION ALL\n${consultaDetalhes("H")}`,
      [["tipoTerceiro", sql.Int, d.ID_TIPO_USUARIO_TERCEIRO]]
    );
    const porChave = new Map();
    for (const x of r.recordset) {
      porChave.set((x.ORIGEM === "H" ? "H" : "A") + x.ID_KAIZEN, {
        titulo: textoLimpo(x.NM_KAIZEN) || "",
        membros: textoLimpo(x.MEMBROS) || "",
        externos: textoLimpo(x.EXTERNOS) || "",
      });
    }
    console.log(`[dashboard] detalhes montados: ${porChave.size} Kaizens em ${Date.now() - inicio} ms.`);
    return { em: Date.now(), porChave };
  }

  async function obterDetalhes(forcar) {
    const agora = Date.now();
    const valido = detalhes && agora - detalhes.em < TTL_MS;
    const podeForcar = !detalhes || agora - detalhes.em > RECARGA_MINIMA_MS;
    if (valido && !(forcar && podeForcar)) return detalhes;
    if (!detalhesEmCurso) {
      detalhesEmCurso = montarDetalhes()
        .then((x) => { detalhes = x; return x; })
        .finally(() => { detalhesEmCurso = null; });
    }
    return detalhesEmCurso;
  }

  /* ── Hierarquia por Kaizen para OUTRAS consultas (Biblioteca) ─────
     Devolve um OUTER APPLY que expõe <alias>.N3 … <alias>.N8 para a linha
     `p` de uma fonte com p.ORIGEM ('A'/'H'), p.ID_KAIZEN e
     p.ID_USUARIO_LIDER — a fonte unificada da Biblioteca, ou só um lado
     dela. Mesma regra do dashboard: a fotografia da origem do Kaizen
     vale inteira; sem fotografia, a linha do líder no MDM (se ligado).
     Cada ramo só contribui quando p.ORIGEM bate, então o mesmo texto
     serve para o UNION ALL e para um lado só. */
  async function applyHierarquia(alias) {
    const ramos = [];
    for (const origem of ["A", "H"]) {
      const cols = await colunasDe(d.nomeHierarquia[origem]);
      if (!cols.has("ID_KAIZEN")) continue;
      const tab = d.tabelasDaOrigem(origem);
      const niveis = NIVEIS.map((x) => (cols.has(`NM_HIERARQUIA_N${x.n}`)
        ? `N${x.n} = hz.NM_HIERARQUIA_N${x.n}` : `N${x.n} = CAST(NULL AS NVARCHAR(200))`)).join(", ");
      ramos.push(`SELECT PRI = 1, ORD = 0, ${niveis}
                    FROM ${tab.hierarquia} hz
                   WHERE p.ORIGEM = '${origem}' AND hz.ID_KAIZEN = p.ID_KAIZEN`);
    }
    if (USAR_MDM_SEM_FOTO) {
      ramos.push(`SELECT PRI = 2, ORD = m.ID_TIPO_USUARIO, ${NIVEIS.map((x) => `N${x.n} = m.NM_HIERARQUIA_N${x.n}`).join(", ")}
                    FROM ${T.mdm} m
                   WHERE m.ID_USUARIO = p.ID_USUARIO_LIDER`);
    }
    if (!ramos.length) {
      return `OUTER APPLY (SELECT ${NIVEIS.map((x) => `N${x.n} = CAST(NULL AS NVARCHAR(200))`).join(", ")}) ${alias}`;
    }
    return `OUTER APPLY (
         SELECT TOP (1) ${NIVEIS.map((x) => `hx.N${x.n}`).join(", ")}
           FROM (
             ${ramos.join("\n             UNION ALL\n             ")}
           ) hx
          ORDER BY hx.PRI, hx.ORD
       ) ${alias}`;
  }

  /* Drill-down da Biblioteca: os valores do PRÓXIMO nível abaixo do
     caminho escolhido (?n3=…&n4=…), com quantos Kaizens cada um tem.
     Sai da base do dashboard em cache — nenhuma consulta nova ao banco a
     cada clique. O caminho precisa ser contínuo a partir do N3. */
  api.get("/hierarquia/opcoes", async (req, res) => {
    try {
      const f = await obterFatos(false);
      const POS = 8; // a coluna do N3 nas linhas compactadas
      const caminho = [];
      for (const x of NIVEIS) {
        const v = textoLimpo(req.query[`n${x.n}`]);
        if (!v) break;
        caminho.push(v);
      }
      if (caminho.length >= NIVEIS.length) return res.json({ nivel: null, opcoes: [], total: 0 });
      const indice = new Map(f.textos.map((t, i) => [t, i]));
      const alvo = caminho.map((v) => (indice.has(v) ? indice.get(v) : -2));
      const cont = new Map();
      let total = 0, semValor = 0;
      for (const l of f.linhas) {
        let ok = true;
        for (let i = 0; i < alvo.length; i++) if (l[POS + i] !== alvo[i]) { ok = false; break; }
        if (!ok) continue;
        total++;
        const v = l[POS + alvo.length];
        if (v < 0) { semValor++; continue; }
        cont.set(v, (cont.get(v) || 0) + 1);
      }
      const nivel = NIVEIS[caminho.length];
      res.json({
        nivel: `n${nivel.n}`,
        chave: nivel.chave,
        total,
        semValor,
        opcoes: [...cont.entries()].sort((a, b) => b[1] - a[1] || f.textos[a[0]].localeCompare(f.textos[b[0]]))
          .map(([i, qtd]) => ({ valor: f.textos[i], qtd })),
      });
    } catch (err) {
      console.error("[hierarquia/opcoes] erro:", err.message);
      res.status(500).json(d.corpoErroSql("Erro ao consultar a hierarquia: ", err));
    }
  });

  /* ── Rotas ─────────────────────────────────────────────────────── */
  api.get("/dashboard/dados", async (req, res) => {
    try {
      const f = await obterFatos(req.query.atualizar === "1");
      res.json(f.payload);
    } catch (err) {
      console.error("[dashboard/dados] erro:", err.message);
      res.status(500).json(d.corpoErroSql("Erro ao montar o dashboard: ", err));
    }
  });

  api.get("/dashboard/detalhes", async (req, res) => {
    try {
      const x = await obterDetalhes(req.query.atualizar === "1");
      const linhas = [];
      x.porChave.forEach((v, k) => {
        linhas.push([k[0] === "H" ? 1 : 0, parseInt(k.slice(1), 10), v.titulo, v.membros, v.externos]);
      });
      res.json({ geradoEm: new Date(x.em).toISOString(), colunas: ["origem", "id", "titulo", "membros", "externos"], linhas });
    } catch (err) {
      console.error("[dashboard/detalhes] erro:", err.message);
      res.status(500).json(d.corpoErroSql("Erro ao consultar os detalhes: ", err));
    }
  });

  /* POST porque a seleção vai no CORPO, comprimida em faixas
     ("1000-1450,1452"). Cabe folgado no limite padrão do express.json
     (100 KB) mesmo com a base inteira selecionada. A tela manda as
     chaves exatas do que está mostrando: a planilha é o que a pessoa vê,
     sem uma segunda implementação dos filtros no servidor. */
  api.post("/dashboard/exportar", async (req, res) => {
    try {
      const corpo = req.body || {};
      const idIdioma = String(corpo.idioma || "").toLowerCase().startsWith("en") ? d.ID_IDIOMA_EN : d.ID_IDIOMA_PT;
      const en = idIdioma === d.ID_IDIOMA_EN;
      const aba = corpo.aba === "lideres" ? "lideres" : "base";
      const chaves = corpo.chaves || {};
      const idsA = expandirFaixas(chaves.A, TETO_EXPORTACAO);
      const idsH = expandirFaixas(chaves.H, TETO_EXPORTACAO);
      if (idsA === null || idsH === null || idsA.length + idsH.length > TETO_EXPORTACAO) {
        return res.status(400).json({ error: en ? "Invalid selection." : "Seleção inválida." });
      }
      const selecionadas = new Set([...idsA.map((i) => "A" + i), ...idsH.map((i) => "H" + i)]);

      const f = await obterFatos(false);
      const det = aba === "base" ? await obterDetalhes(false) : null;
      const txt = (i) => (i >= 0 ? f.textos[i] : "");
      const status = new Map(f.payload.status.map((s) => [s.id, s]));
      const cats = new Map(f.payload.categorias.map((c) => [c.id, c]));
      const rotulo = (m, id) => (m && (en ? m.en || m.pt : m.pt || m.en)) || (id >= 0 ? String(id) : "");
      const linhas = f.linhas.filter((l) => selecionadas.has((l[0] ? "H" : "A") + l[1]));

      const workbook = new d.ExcelJS.Workbook();
      const FONTE = "Poppins";
      let planilha;

      if (aba === "base") {
        planilha = workbook.addWorksheet(en ? "Kaizens" : "Kaizens");
        const C = (key, pt, enTxt, width) => ({ header: en ? enTxt : pt, key, width });
        planilha.columns = [
          C("ID_KAIZEN", "ID Kaizen", "Kaizen ID", 11),
          C("ROTULO", "Rótulo", "Label", 13),
          C("ORIGEM", "Origem", "Source", 12),
          C("DT_CRIACAO", "Data de cadastro", "Registration date", 15),
          C("NM_STATUS", "Status", "Status", 20),
          C("NM_CATEGORIA", "Categoria", "Category", 18),
          C("NM_SITE", "Site", "Site", 16),
          C("NM_LIDER", "Kaizen Líder", "Kaizen Leader", 26),
          C("NM_APROVADOR", "Aprovador", "Approver", 26),
          C("MEMBROS", "Membros VBM", "VBM members", 34),
          C("EXTERNOS", "Membros externos", "External members", 26),
          C("COO", "COO", "COO", 34),
          C("DIR", "Diretoria", "Directorate", 36),
          C("HEAD", "Head", "Head", 36),
          C("GG", "Gerência Geral", "General Management", 36),
          C("GA", "Gerência Área", "Area Management", 36),
          C("CS", "Coord/Sup", "Coord/Sup", 36),
          C("NM_KAIZEN", "Título", "Title", 50),
        ];
        linhas.sort((a, b) => b[2] - a[2] || b[1] - a[1]);
        for (const l of linhas) {
          const k = (l[0] ? "H" : "A") + l[1];
          const x = det.porChave.get(k) || {};
          const dt = l[2] ? new Date(Date.UTC(Math.floor(l[2] / 10000), Math.floor(l[2] / 100) % 100 - 1, l[2] % 100)) : null;
          planilha.addRow({
            ID_KAIZEN: l[1],
            ROTULO: d.rotuloIdKaizen(l[1], dt),
            ORIGEM: l[0] ? (en ? "History" : "Histórico") : (en ? "Current" : "Atual"),
            DT_CRIACAO: dt,
            NM_STATUS: rotulo(status.get(l[3]), l[3]),
            NM_CATEGORIA: rotulo(cats.get(l[4]), l[4]),
            NM_SITE: txt(l[7]),
            NM_LIDER: txt(l[5]),
            NM_APROVADOR: txt(l[6]),
            MEMBROS: x.membros || "",
            EXTERNOS: x.externos || "",
            COO: txt(l[8]), DIR: txt(l[9]), HEAD: txt(l[10]), GG: txt(l[11]), GA: txt(l[12]), CS: txt(l[13]),
            NM_KAIZEN: x.titulo || "",
          });
        }
        planilha.getColumn("DT_CRIACAO").numFmt = "dd/mm/yyyy";
      } else {
        // Detalhamento por líder: uma coluna por status que aparece na
        // seleção, na ordem do cadastro.
        planilha = workbook.addWorksheet(en ? "Leaders" : "Lideres");
        const porLider = new Map();
        const statusUsados = new Set();
        for (const l of linhas) {
          const nome = txt(l[5]) || (en ? "(Blank)" : "(Em branco)");
          let o = porLider.get(nome);
          if (!o) { o = { nome, total: 0, st: new Map() }; porLider.set(nome, o); }
          o.total++;
          o.st.set(l[3], (o.st.get(l[3]) || 0) + 1);
          statusUsados.add(l[3]);
        }
        const ordemStatus = [...statusUsados].sort((a, b) => a - b);
        const idAprovado = f.payload.status.find((s) => s.momento === "aprovado");
        planilha.columns = [
          { header: en ? "Kaizen Leader" : "Kaizen Líder", key: "NOME", width: 32 },
          { header: "Total", key: "TOTAL", width: 9 },
          ...ordemStatus.map((id) => ({ header: rotulo(status.get(id), id) || (en ? "No status" : "Sem status"), key: "S" + id, width: 16 })),
          { header: en ? "Approval %" : "% aprovação", key: "TAXA", width: 13 },
        ];
        [...porLider.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)).forEach((o) => {
          const linha = { NOME: o.nome, TOTAL: o.total };
          ordemStatus.forEach((id) => { linha["S" + id] = o.st.get(id) || 0; });
          linha.TAXA = idAprovado ? (o.st.get(idAprovado.id) || 0) / o.total : null;
          planilha.addRow(linha);
        });
        planilha.getColumn("TAXA").numFmt = "0%";
      }

      // Mesma identidade da exportação da Biblioteca: Poppins, cabeçalho
      // no azul do site, tudo centralizado.
      planilha.getRow(1).height = 30;
      planilha.getRow(1).eachCell((c) => {
        c.font = { name: FONTE, size: 10, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3CB5E5" } };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      for (let i = 2; i <= planilha.rowCount; i++) {
        planilha.getRow(i).eachCell({ includeEmpty: true }, (c) => {
          c.font = { name: FONTE, size: 9 };
          c.alignment = { horizontal: "center", vertical: "middle" };
        });
      }
      planilha.views = [{ state: "frozen", ySplit: 1 }];
      planilha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: planilha.columnCount } };

      const nome = `${aba === "base" ? "dashboard-kaizen-base" : "dashboard-kaizen-lideres"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
      await workbook.xlsx.write(res);
      res.end();
      console.log(`[dashboard/exportar] ${aba}: ${linhas.length} Kaizen(s) exportado(s).`);
    } catch (err) {
      console.error("[dashboard/exportar] erro:", err.message);
      if (!res.headersSent) res.status(500).json(d.corpoErroSql("Erro ao exportar: ", err));
    }
  });

  return { applyHierarquia, NIVEIS_HIERARQUIA: NIVEIS.map((x) => x.n) };
}

module.exports = { registrarRotasDashboard, _interno: { expandirFaixas, textoLimpo, dataInt } };
