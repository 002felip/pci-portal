/**
 * Registro de notificações (KZN_TB_NOTIFICACAO) — ponta a ponta pela API.
 *
 * Sobe o próprio server.js com o dublê fake-mssql-notificacao.js (duas
 * vezes: ID_NOTIFICACAO sem identity, MAX+1; e com IDENTITY) e percorre
 * o ciclo de vida de um Kaizen pelas rotas de verdade:
 *
 *   cadastro → solicitar alteração → (repete: 409) → revisão →
 *   (repete: 409) → reprovação; outro Kaizen: aprovação → (repete: 409)
 *
 * Confere: uma linha por evento, com o TIPO certo, os dados relidos do
 * banco (título, autor, aprovador, site, categoria e status PT/EN) e o
 * carimbo da ação como DT_CRIACAO e o motivo gravado no Kaizen como
 * DS_MOTIVO (cortado no tamanho real da coluna, e ausente do comando
 * enquanto a coluna não existir); nenhuma linha quando a ação é
 * recusada; nenhuma linha duplicada na corrida (duas gravações do mesmo
 * evento); e que uma falha na tabela de notificações NÃO derruba a ação.
 *
 * Uso: node tests/teste-notificacoes.js   (não precisa de servidor no ar)
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const APP = path.join(__dirname, "..");
const PORTA = 4001;
const BASE = `http://localhost:${PORTA}/api`;
const H = { "X-Forwarded-Email": "cristian.alves@vale.com", "Content-Type": "application/json" };

let ok = 0, falhou = 0;
function confere(cond, msg, extra) {
  if (cond) { ok++; console.log("  OK  ", msg); }
  else { falhou++; console.log("  FALHA", msg, extra !== undefined ? JSON.stringify(extra) : ""); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "notif-"));
const ESTADO = path.join(tmp, "estado.json");
const LOG = path.join(tmp, "tabela.json");
const estado = (o) => fs.writeFileSync(ESTADO, JSON.stringify(o));
const estadoCom = (o) => estado({ ...BASE_ESTADO, ...o });
const tabela = () => { try { return JSON.parse(fs.readFileSync(LOG, "utf8")); } catch (e) { return []; } };

const CORPO = (titulo) => ({
  titulo, declaracao_problema: "Problema descrito", meta_objetivo: "Meta descrita",
  descricao_antes: "Antes", descricao_depois: "Depois", id_categoria: 1, id_replicacao: 1,
  id_usuario_aprovador: 902, data_conclusao: "2026-09-01", membros: [], ids_desperdicio: [],
});

async function chamar(metodo, rota, corpo) {
  const r = await fetch(BASE + rota, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

let BASE_ESTADO = {};
function subir(identity, extra) {
  try { fs.unlinkSync(LOG); } catch (e) {}
  BASE_ESTADO = { identity, ...(extra || {}) };
  estado(BASE_ESTADO);
  const env = { ...process.env, PORT: String(PORTA), FAKE_NOTIF_ESTADO: ESTADO, FAKE_NOTIF_LOG: LOG,
    AZURE_SQL_SERVER: "teste.database.windows.net", KAIZEN_AZURE_SQL_DATABASE: "TESTE", AZURE_SQL_PORT: "1433",
    AZURE_SQL_SCHEMA: "ci", AZURE_SQL_TABLE: "kzn_aprovador", AZURE_SQL_USER: "teste", AZURE_SQL_PASSWORD: "teste",
    AZURE_STORAGE_ACCOUNT: "https://exemplo.blob.core.windows.net/exemplo", AZURE_STORAGE_CONTAINER: "05 - Kaizen",
    AZURE_STORAGE_SAS_TOKEN: "sp=r&sig=exemplo", NOTIF_COLUNA_TTL_MS: "400" };
  const srv = spawn(process.execPath, ["-r", path.join(__dirname, "preload-notificacao.js"), "server.js"],
    { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
  srv.saida = "";
  srv.stdout.on("data", (d) => (srv.saida += d));
  srv.stderr.on("data", (d) => (srv.saida += d));
  return srv;
}
async function esperar() {
  for (let t = 0; t < 60; t++) {
    try { const r = await fetch(BASE + "/test", { headers: H }); if (r.status) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("servidor não subiu");
}

async function rodada(identity, extra) {
  const tam = (extra && extra.tamMotivo) || 300;
  console.log(`\n══ ID_NOTIFICACAO ${identity ? "IDENTITY" : "sem identity (MAX+1)"}; DS_MOTIVO com ${tam} caracteres`);
  const srv = subir(identity, extra);
  try {
    await esperar();

    // 1. Cadastro → "Aguardando aprovação"
    const cad = await chamar("POST", "/kaizens", CORPO("Kaizen das notificacoes"));
    confere(cad.status === 201, "cadastro respondeu 201", cad);
    const id = cad.json && cad.json.ID_KAIZEN;
    confere(Array.isArray(cad.json && cad.json.AVISOS), "cadastro continua devolvendo os AVISOS de e-mail");
    let t = tabela();
    confere(t.length === 1, "1 notificação após o cadastro", t.length);
    const n1 = t[0] || {};
    confere(n1.TIPO_NOTIFICACAO === "Aguardando aprovação", "tipo = Aguardando aprovação", n1.TIPO_NOTIFICACAO);
    confere(n1.ID_KAIZEN === id, "ID_KAIZEN do Kaizen criado", n1.ID_KAIZEN);
    confere(n1.TITULO_KAIZEN === "Kaizen das notificacoes", "TITULO_KAIZEN relido do banco", n1.TITULO_KAIZEN);
    confere(n1.NM_AUTOR === "Cristian Arlan Alves" && n1.EMAIL_AUTOR === "cristian.alves@vale.com", "autor: nome e e-mail", [n1.NM_AUTOR, n1.EMAIL_AUTOR]);
    confere(n1.NM_APROVADOR === "Ana Beatriz Morais Santos" && n1.EMAIL_APROVADOR === "ana.santos5@vale.com", "aprovador designado: nome e e-mail", [n1.NM_APROVADOR, n1.EMAIL_APROVADOR]);
    confere(n1.SITE === "CORPORATIVO", "SITE do autor", n1.SITE);
    confere(n1.CATEGORIA_PT === "Qualidade" && n1.CATEGORIA_EN === "Quality", "categoria PT/EN", [n1.CATEGORIA_PT, n1.CATEGORIA_EN]);
    confere(n1.STATUS_PT === "Aguardando aprovação" && n1.STATUS_EN === "Awaiting approval", "status PT/EN do que foi gravado", [n1.STATUS_PT, n1.STATUS_EN]);
    confere(typeof n1.DT_CRIACAO === "string" && n1.DT_CRIACAO.length > 0, "DT_CRIACAO = carimbo da ação", n1.DT_CRIACAO);
    confere("DS_MOTIVO" in n1 && n1.DS_MOTIVO === null, "DS_MOTIVO nulo no cadastro (ainda não há motivo)", n1.DS_MOTIVO);

    // 2. Solicitar alteração → "Solicitado alterações"; repetir → 409, nada novo
    const PEDIDO = "Ajustar a meta e anexar a foto do depois";
    const alt = await chamar("POST", `/kaizens/${id}/solicitar-alteracao`, { motivo: PEDIDO });
    confere(alt.status === 200, "solicitar alteração respondeu 200", alt);
    t = tabela();
    confere(t.length === 2 && t[1].TIPO_NOTIFICACAO === "Solicitado alterações", "tipo = Solicitado alterações", t.map((x) => x.TIPO_NOTIFICACAO));
    confere(t[1] && t[1].STATUS_PT === "Solicitado alterações", "status gravado na notificação acompanha a decisão", t[1] && t[1].STATUS_PT);
    confere(t[1] && t[1].DT_CRIACAO !== t[0].DT_CRIACAO, "carimbo novo para o evento novo");
    confere(t[1] && t[1].DS_MOTIVO === PEDIDO.slice(0, tam), `DS_MOTIVO = alterações pedidas${tam < PEDIDO.length ? ` (cortado em ${tam})` : ""}`, t[1] && t[1].DS_MOTIVO);
    const alt2 = await chamar("POST", `/kaizens/${id}/solicitar-alteracao`, { motivo: "de novo" });
    confere(alt2.status === 409, "repetir a decisão é recusado (409)", alt2.status);
    confere(tabela().length === 2, "decisão recusada não gera notificação", tabela().length);

    // 3. Revisão → "Revisado"; repetir → 409, nada novo
    const rev = await chamar("PUT", `/kaizens/${id}`, { ...CORPO("Kaizen das notificacoes v2"), ORIGEM: "A" });
    confere(rev.status === 200, "revisão respondeu 200", rev);
    t = tabela();
    confere(t.length === 3 && t[2].TIPO_NOTIFICACAO === "Revisado", "tipo = Revisado", t.map((x) => x.TIPO_NOTIFICACAO));
    confere(t[2] && t[2].TITULO_KAIZEN === "Kaizen das notificacoes v2", "título da notificação é o gravado na revisão", t[2] && t[2].TITULO_KAIZEN);
    confere(t[2] && t[2].DS_MOTIVO === PEDIDO.slice(0, tam), "DS_MOTIVO na revisão = o pedido que o autor atendeu", t[2] && t[2].DS_MOTIVO);
    const rev2 = await chamar("PUT", `/kaizens/${id}`, { ...CORPO("Kaizen das notificacoes v3"), ORIGEM: "A" });
    confere(rev2.status === 409, "revisar de novo é recusado (Revisado não é editável)", rev2.status);
    confere(tabela().length === 3, "revisão recusada não gera notificação", tabela().length);

    // 4. Reprovação → "Rejeitado"
    const rep = await chamar("POST", `/kaizens/${id}/reprovar`, { motivo: "Fora do escopo" });
    confere(rep.status === 200, "reprovar respondeu 200", rep);
    t = tabela();
    confere(t.length === 4 && t[3].TIPO_NOTIFICACAO === "Rejeitado", "tipo = Rejeitado", t.map((x) => x.TIPO_NOTIFICACAO));
    confere(t[3] && t[3].DS_MOTIVO === "Fora do escopo".slice(0, tam), "DS_MOTIVO = motivo da reprovação", t[3] && t[3].DS_MOTIVO);
    const repSemMotivo = await chamar("POST", `/kaizens/701/reprovar`, {});
    confere(repSemMotivo.status === 400 && tabela().length === 4, "reprovação inválida (sem motivo) não gera notificação", repSemMotivo.status);

    // 5. Outro Kaizen: aprovação → "Aprovado"; repetir → 409
    const apr = await chamar("POST", `/kaizens/701/aprovar`, {});
    confere(apr.status === 200, "aprovar respondeu 200", apr);
    t = tabela();
    confere(t.length === 5 && t[4].TIPO_NOTIFICACAO === "Aprovado" && t[4].ID_KAIZEN === 701, "tipo = Aprovado no Kaizen 701", t.map((x) => [x.ID_KAIZEN, x.TIPO_NOTIFICACAO]));
    confere(t[4] && t[4].STATUS_EN === "Approved", "STATUS_EN = Approved", t[4] && t[4].STATUS_EN);
    confere(t[4] && t[4].DS_MOTIVO === null, "aprovação sem comentário: DS_MOTIVO nulo", t[4] && t[4].DS_MOTIVO);
    const apr2 = await chamar("POST", `/kaizens/701/aprovar`, {});
    confere(apr2.status === 409 && tabela().length === 5, "aprovar de novo: 409 e nenhuma notificação", apr2.status);

    // 6. Corrida: duas gravações do MESMO evento (mesmo carimbo relido) —
    //    a segunda passa pela checagem da rota, mas o INSERT não duplica.
    estadoCom({ forcarPendente: true, congelarRelogio: true });
    const c1 = await chamar("POST", `/kaizens/701/aprovar`, {});
    const c2 = await chamar("POST", `/kaizens/701/aprovar`, {});
    confere(c1.status === 200 && c2.status === 200, "corrida: as duas requisições gravaram", [c1.status, c2.status]);
    // c1 regrava o 701 já aprovado com o MESMO carimbo do evento 5 → é o
    // mesmo evento: nenhuma linha nova.
    confere(tabela().length === 5, "corrida: o mesmo evento não entra duas vezes", tabela().length);
    confere(/deste evento já estava registrada/.test(srv.saida), "log diz que o evento já estava registrado");

    // 7. Tabela fora do ar: a ação continua dando certo.
    estadoCom({ falhar: true });
    const f = await chamar("POST", "/kaizens", CORPO("Kaizen com tabela fora do ar"));
    confere(f.status === 201, "cadastro dá certo mesmo com a tabela de notificações falhando", f.status);
    confere(tabela().length === 5, "nenhuma notificação gravada na falha", tabela().length);
    confere(/\[notificacao\] falha ao registrar "Aguardando aprovação"/.test(srv.saida), "falha registrada no log");
    estadoCom({});
  } finally {
    srv.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
  // Nenhum erro inesperado no servidor além do provocado no passo 7.
  const erros = srv.saida.split("\n").filter((l) => /\[notificacao\].*falha/.test(l));
  confere(erros.length === 1, "uma única falha de notificação no log (a provocada)", erros);
}

/* App no ar ANTES do ALTER TABLE: grava sem DS_MOTIVO; a coluna é
   criada com o app rodando e o evento seguinte já a preenche. */
async function rodadaColunaNova() {
  console.log("\n══ DS_MOTIVO criada com o app no ar");
  const srv = subir(false, { semDsMotivo: true });
  try {
    await esperar();
    const cad = await chamar("POST", "/kaizens", CORPO("Kaizen antes do ALTER"));
    confere(cad.status === 201, "cadastro sem a coluna: 201", cad.status);
    let t = tabela();
    confere(t.length === 1 && !("DS_MOTIVO" in t[0]), "notificação gravada SEM citar DS_MOTIVO", t[0]);
    confere(/DS_MOTIVO ainda não existe/.test(srv.saida), "log avisa que falta rodar o script");

    estadoCom({ semDsMotivo: false });          // ALTER TABLE rodou
    await new Promise((r) => setTimeout(r, 600)); // passa o TTL do "não existe"
    const apr = await chamar("POST", "/kaizens/701/aprovar", { motivo: "Ótimo trabalho, replicar em Salobo" });
    confere(apr.status === 200, "aprovação com comentário: 200", apr.status);
    t = tabela();
    confere(t.length === 2 && t[1].DS_MOTIVO === "Ótimo trabalho, replicar em Salobo",
      "sem reiniciar: a coluna nova já é preenchida (comentário da aprovação)", t[1]);
    confere(/DS_MOTIVO encontrada/.test(srv.saida), "log registra que a coluna passou a ser gravada");
  } finally {
    srv.kill();
    await new Promise((r) => setTimeout(r, 300));
  }
}

(async () => {
  try {
    await rodada(false);
    await rodada(true, { tamMotivo: 10 });
    await rodadaColunaNova();
  } catch (e) {
    falhou++; console.log("  FALHA", e.message);
  }
  console.log(`\n${ok} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})();
