/**
 * VBM Kaizen — upload de arquivos para um Volume do Databricks.
 *
 * Usado por POST /api/kaizens/imagem (server.js) para gravar as fotos
 * de "Antes"/"Depois" da tela Novo Kaizen em:
 *   /Volumes/franquia_bmsa_insight/ci/kaizen/imgs/before/
 *   /Volumes/franquia_bmsa_insight/ci/kaizen/imgs/after/
 * (caminhos pedidos em Usuário - Novo Kaizen - Aprovação.txt).
 *
 * AUTENTICAÇÃO
 *   Este servidor roda DENTRO de um Databricks App. O runtime injeta
 *   automaticamente, como variáveis de ambiente, as credenciais do
 *   service principal do PRÓPRIO app:
 *
 *     DATABRICKS_HOST           endereço do workspace (https://...)
 *     DATABRICKS_CLIENT_ID      client_id do service principal do app
 *     DATABRICKS_CLIENT_SECRET  client_secret do service principal do app
 *
 *   Não é preciso (nem deve) declarar essas 3 no app.yaml: elas já
 *   existem no processo assim que o app sobe. Trocamos client_id +
 *   client_secret por um access token OAuth de curta duração via
 *   client_credentials (endpoint /oidc/v1/token) e cacheamos o token em
 *   memória até pouco antes de expirar — mesma ideia do pool de conexão
 *   do Azure SQL em server.js (reaproveitar em vez de renegociar a cada
 *   requisição).
 *
 *   Doc oficial (Files API): PUT /api/2.0/fs/files{file_path}
 *   https://docs.databricks.com/api/workspace/files/upload
 *
 * PERMISSÃO NECESSÁRIA
 *   O service principal do app precisa ter permissão de escrita
 *   (WRITE VOLUME) no volume franquia_bmsa_insight.ci.kaizen. Conceda
 *   isso em Catalog Explorer > (catálogo) > ci > kaizen > Permissions >
 *   Grant, adicionando o service principal do app (o mesmo nome que
 *   aparece em App > Authorization, na aba do Databricks Apps) — sem
 *   isso o upload falha com 403 mesmo com o token válido.
 */

const DATABRICKS_HOST = (process.env.DATABRICKS_HOST || "").replace(/\/+$/, "");
const CLIENT_ID = process.env.DATABRICKS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET || "";

// { token, expiresAt } — null até a 1ª chamada. Renovado sozinho quando
// falta menos de 30s para expirar (mesma folga de segurança de tokens
// curtos em geral: evita usar um token que expira no meio da chamada).
let tokenCache = null;

async function obterToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30000) {
    return tokenCache.token;
  }
  if (!DATABRICKS_HOST || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Credenciais do Databricks App ausentes (DATABRICKS_HOST / DATABRICKS_CLIENT_ID / " +
        "DATABRICKS_CLIENT_SECRET). Essas variáveis são injetadas automaticamente pelo runtime " +
        "dos Databricks Apps — se estiverem faltando, confira se o app tem um service principal " +
        "próprio associado (App > Authorization) e se foi reiniciado depois de configurado."
    );
  }

  const corpo = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "all-apis",
  });

  const resp = await fetch(`${DATABRICKS_HOST}/oidc/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corpo.toString(),
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`Falha ao obter token OAuth do Databricks (HTTP ${resp.status}): ${texto}`);
  }
  const dados = await resp.json();
  tokenCache = {
    token: dados.access_token,
    expiresAt: Date.now() + (dados.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

/**
 * Grava `buffer` no caminho de volume informado (ex.:
 * "/Volumes/franquia_bmsa_insight/ci/kaizen/imgs/before/123.png").
 * overwrite=true é ESSENCIAL aqui: o nome do arquivo é o ID do Kaizen
 * (ver nomeArquivoImagem em server.js), então trocar a foto de um Kaizen
 * grava por cima da anterior — é o comportamento desejado, um Kaizen tem
 * uma foto de "antes" e uma de "depois", não um histórico delas. Quem
 * separa as duas é a PASTA: imgs/before e imgs/after.
 *
 * Lança erro (com a mensagem crua da API do Databricks) em qualquer
 * falha; quem chama decide como traduzir isso pro usuário.
 */
async function enviarArquivoParaVolume(caminhoVolume, buffer, contentType) {
  const token = await obterToken();
  const url = `${DATABRICKS_HOST}/api/2.0/fs/files${caminhoVolume}?overwrite=true`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: buffer,
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`Falha ao gravar no volume (HTTP ${resp.status}): ${texto}`);
  }
}

/**
 * Lê `caminhoVolume` de volta (usado pra exibir as fotos de Antes/Depois
 * na Biblioteca — ver GET /api/kaizens/imagem em server.js). O caminho
 * do volume não é uma URL acessível pelo navegador; este servidor
 * busca os bytes com as mesmas credenciais do upload e repassa.
 */
async function baixarArquivoDoVolume(caminhoVolume) {
  const token = await obterToken();
  const url = `${DATABRICKS_HOST}/api/2.0/fs/files${caminhoVolume}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`Falha ao ler do volume (HTTP ${resp.status}): ${texto}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  return { buffer, contentType };
}

/**
 * Apaga `caminhoVolume`. Usado só para limpar o arquivo TEMPORÁRIO do
 * cadastro novo depois que ele é regravado com o nome definitivo (o ID
 * do Kaizen) — ver renomearImagemParaId em server.js.
 *
 * NÃO lança: se a limpeza falhar, o que fica é um arquivo órfão no
 * volume, e derrubar o cadastro por causa disso seria pior do que o
 * arquivo sobrando. Devolve true/false para quem chama registrar no log.
 */
async function removerArquivoDoVolume(caminhoVolume) {
  try {
    const token = await obterToken();
    const url = `${DATABRICKS_HOST}/api/2.0/fs/files${caminhoVolume}`;
    const resp = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    return resp.ok;
  } catch (err) {
    return false;
  }
}

module.exports = { enviarArquivoParaVolume, baixarArquivoDoVolume, removerArquivoDoVolume };
