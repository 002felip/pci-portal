/**
 * VBM Kaizen — upload de arquivos para o Azure Blob Storage.
 *
 * Substitui o Volume do Databricks como destino das fotos de
 * "Antes"/"Depois" da tela Novo Kaizen. Mesmo formato de módulo do
 * databricks-fs.js (enviar / baixar / remover), para que server.js
 * escolha um ou outro pelo caminho e nada mais precise mudar.
 *
 * CONFIGURAÇÃO (app.yaml)
 *   AZURE_STORAGE_ACCOUNT    URL da conta JÁ COM O CONTAINER, ex.:
 *                            https://ibpdatalake.blob.core.windows.net/vbmdatalake
 *   AZURE_STORAGE_CONTAINER  apesar do nome, é a PASTA dentro do
 *                            container, ex.: "05 - Kaizen". Não pode ser
 *                            um container de verdade: nome de container
 *                            no Azure não aceita espaço nem maiúscula.
 *   AZURE_STORAGE_SAS_TOKEN  SAS do container, com ou sem "?" na frente.
 *
 * AUTENTICAÇÃO
 *   O SAS já é a credencial: vai na querystring de cada chamada, não há
 *   token a negociar (é mais simples que o OAuth do databricks-fs.js).
 *   Por isso ele NUNCA pode chegar ao navegador — quem lê as imagens é
 *   o GET /api/kaizens/imagem, que busca os bytes aqui e repassa.
 *
 * PERMISSÕES DO SAS
 *   Gravar exige 'c' (create) e 'w' (write); ler exige 'r'; APAGAR exige
 *   'd' (delete). O SAS em uso hoje é sp=racw — sem o 'd'. A remoção
 *   abaixo é best-effort e devolve false nesse caso, deixando um arquivo
 *   órfão em vez de derrubar o cadastro. É ESSA falta que faz sobrar um
 *   TEMP_ ao lado de cada foto salva num cadastro novo. Para a limpeza
 *   funcionar, reemita o SAS com sp=racwd.
 *
 *   Doc oficial (Put Blob): https://learn.microsoft.com/rest/api/storageservices/put-blob
 */

const CONTA = (process.env.AZURE_STORAGE_ACCOUNT || "").replace(/\/+$/, "");
const PASTA = (process.env.AZURE_STORAGE_CONTAINER || "").replace(/^\/+|\/+$/g, "");
// O SAS pode vir com ou sem "?" — normaliza para juntar na URL sem
// duplicar o separador.
const SAS = (process.env.AZURE_STORAGE_SAS_TOKEN || "").replace(/^\?/, "");

/** A configuração do Blob está completa? server.js usa isto para decidir
 *  se o destino de gravação é o Blob ou o Volume do Databricks. */
function blobConfigurado() {
  return Boolean(CONTA && PASTA && SAS);
}

function exigirConfig() {
  if (blobConfigurado()) return;
  throw new Error(
    "Configuração do Azure Blob ausente (AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_CONTAINER / " +
      "AZURE_STORAGE_SAS_TOKEN). Declare as três no app.yaml — o SAS vindo de um Secret Scope, " +
      "nunca em texto puro — e reinicie o app."
  );
}

/** Monta a URL do blob a partir do caminho RELATIVO à pasta base.
 *
 *  Cada segmento é codificado separadamente: a pasta "05 - Kaizen" tem
 *  espaços, e mandar o espaço cru faz o Azure recusar com 403 por
 *  assinatura inválida. Codificar a string inteira de uma vez comeria as
 *  barras e transformaria o caminho em um nome de arquivo só. */
function urlDoBlob(caminhoRelativo) {
  const segmentos = String(caminhoRelativo)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${CONTA}/${encodeURIComponent(PASTA)}/${segmentos}?${SAS}`;
}

/** Grava `buffer` em `caminhoRelativo`
 *  (ex.: "01 - Imagens/01 - Antes/123.png").
 *
 *  O Put Blob sobrescreve por padrão, que é o comportamento desejado: o
 *  nome do arquivo é o ID do Kaizen, então trocar a foto grava por cima
 *  da anterior. Um Kaizen tem uma foto de cada, não um histórico.
 *
 *  x-ms-blob-type é obrigatório — sem ele o Azure devolve 400. Não
 *  mandamos Content-Length: o fetch do Node calcula a partir do buffer, e
 *  declarar à mão abre espaço para divergir do corpo real. */
async function enviarArquivoParaBlob(caminhoRelativo, buffer, contentType) {
  exigirConfig();
  const resp = await fetch(urlDoBlob(caminhoRelativo), {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": contentType || "application/octet-stream",
    },
    body: buffer,
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`Falha ao gravar no Blob (HTTP ${resp.status}): ${texto}`);
  }
}

/** Lê `caminhoRelativo` de volta. O caminho do blob não é uma URL que o
 *  navegador possa abrir (o SAS não sai daqui), então este servidor busca
 *  os bytes e repassa — ver GET /api/kaizens/imagem em server.js. */
async function baixarArquivoDoBlob(caminhoRelativo) {
  exigirConfig();
  const resp = await fetch(urlDoBlob(caminhoRelativo));
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`Falha ao ler do Blob (HTTP ${resp.status}): ${texto}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  return { buffer, contentType };
}

/** Apaga `caminhoRelativo`. Usado para limpar o arquivo TEMPORÁRIO do
 *  cadastro novo e a foto com a extensão antiga quando se troca PNG por
 *  JPG.
 *
 *  NÃO lança: o que se perde ao falhar é um arquivo órfão, e derrubar o
 *  cadastro por causa disso seria pior. Devolve true/false para quem
 *  chama registrar no log. 404 conta como sucesso — não há o que apagar.
 *
 *  O 403 ganha mensagem própria porque tem causa conhecida e conserto
 *  conhecido: o SAS em uso (sp=racw) não tem a permissão 'd'. */
async function removerArquivoDoBlob(caminhoRelativo) {
  try {
    exigirConfig();
    const resp = await fetch(urlDoBlob(caminhoRelativo), { method: "DELETE" });
    if (resp.status === 404) return true;
    if (resp.status === 403) {
      console.warn(
        `[blob] sem permissão para apagar "${caminhoRelativo}". O SAS precisa da permissão de ` +
          `delete (sp=...d) — reemita com sp=racwd. O arquivo fica órfão até lá.`
      );
      return false;
    }
    return resp.ok;
  } catch (err) {
    console.warn(`[blob] falha ao apagar "${caminhoRelativo}": ${err.message}`);
    return false;
  }
}

module.exports = {
  blobConfigurado,
  enviarArquivoParaBlob,
  baixarArquivoDoBlob,
  removerArquivoDoBlob,
};
