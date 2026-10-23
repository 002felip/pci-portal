/**
 * VBM Kaizen — servidor Node/Express.
 *
 * Serve os HTML/CSS/JS estáticos do app (index, admin, aprovacao, etc.)
 * e expõe uma API REST para a tabela `kzn_aprovador`, usada hoje pela
 * aba "Aprovadores" de admin.html. Também expõe uma leitura (só GET)
 * de `kzn_categoria` + contagem em `kzn_pendenciaconsolidada`, usada
 * pelo card em destaque da aba "Categorias" (ver js/categorias.js).
 *
 * MODELO DE CONEXÃO (igual ao app.py de teste / app.yaml fornecidos):
 *   - Conexão DIRETA ao Azure SQL Database, sem passar pelo Databricks
 *     SQL Warehouse (diferente do padrão OAuth usado em outros apps
 *     deste workspace, como o "teste-conexao").
 *   - Credenciais fixas via variáveis de ambiente, injetadas pelo
 *     app.yaml (usuário/senha devem vir de um Secret Scope do
 *     Databricks — nunca em texto puro no app.yaml de produção).
 *   - Usamos o pacote `mssql` (equivalente Node do `pymssql` usado no
 *     protótipo Python): driver 100% JS (Tedious por baixo), instala
 *     só com "npm install", sem precisar de driver de sistema
 *     operacional — importante porque Databricks Apps não permite
 *     apt-get/sudo.
 */

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const sql = require("mssql");
const multer = require("multer");
const ExcelJS = require("exceljs");
const { enviarArquivoParaVolume, baixarArquivoDoVolume, removerArquivoDoVolume } = require("./databricks-fs");
const {
  blobConfigurado,
  enviarArquivoParaBlob,
  baixarArquivoDoBlob,
  removerArquivoDoBlob,
} = require("./azure-blob");
const { montarAviso } = require("./email-kaizen");

const app = express();

// Telas do Kaizen (gate de acesso + arquivos estáticos). Montado na raiz
// DESTA aplicação: rodando sozinho, fica em "/"; dentro do portal
// (<raiz>/server.js), o portal monta o app inteiro em /VBM-Kaizen-App.
const kaizenWeb = express.Router();

// Cabeçalhos de segurança básicos (clickjacking, MIME sniffing,
// referrer). Dois desligados de propósito:
//
//   contentSecurityPolicy — as telas são HTML com <script>/<style>
//   inline em todo lugar (sem nonce); o CSP padrão do helmet
//   bloquearia a aplicação inteira. Reativar exige antes reescrever
//   essas telas para script/style externos com nonce, mudança grande
//   demais para entrar aqui como correção pontual.
//
//   crossOriginOpenerPolicy — isolar o contexto de navegação (padrão
//   do helmet: 'same-origin') fez o Chromium headless atrasar a
//   pintura do glifo do ícone de fechar em kaizen-novo.html e
//   admin.html o bastante para a captura de tela do teste de
//   contraste (tests/teste-fechar.js) pegar o "X" ainda sem o glifo —
//   falha REAL e reprodutível, confirmada isolando cada opção do
//   helmet uma por vez contra a bateria de regressão, não só teórica.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));

// gzip em tudo que é texto (HTML/CSS/JS/JSON/SVG). Já estava no
// package.json mas nunca tinha sido ligado — o app servia os ~110 KB de
// admin.html e os ~65 KB de vbm-app.css crus. Com gzip esses caem para
// ~20 KB e ~12 KB (>80% menos). Só afeta o transporte: o conteúdo que
// chega ao navegador é byte a byte o mesmo.
app.use(compression());

app.use(express.json());

// ------------------------------------------------------------------
// Configuração (env vars injetadas pelo app.yaml)
// ------------------------------------------------------------------
const DB_SERVER = process.env.AZURE_SQL_SERVER || "";
// Banco desta aplicação no app.yaml compartilhado (KAIZEN_*); o nome
// genérico fica só como compatibilidade com app.yaml antigo.
const DB_NAME = process.env.KAIZEN_AZURE_SQL_DATABASE || process.env.AZURE_SQL_DATABASE || "";
const DB_USER = process.env.AZURE_SQL_USER || "";
const DB_PASSWORD = process.env.AZURE_SQL_PASSWORD || "";
const DB_PORT = parseInt(process.env.AZURE_SQL_PORT || "1433", 10);

// Identificadores (schema/tabela) só podem conter letras, números e
// underscore — nunca interpolados sem essa validação, mesmo vindo de
// env var de confiança (defesa em profundidade).
const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

function safeIdentifier(value, fallback) {
  const v = value || fallback;
  if (!IDENTIFIER_RE.test(v)) {
    throw new Error(`Identificador inválido: "${v}"`);
  }
  return v;
}

const DB_SCHEMA = safeIdentifier(process.env.AZURE_SQL_SCHEMA, "dbo");
const DB_TABLE = safeIdentifier(process.env.AZURE_SQL_TABLE, "kzn_aprovador");

// SG_ATIVO "ativo" muda com a base: BDIBPBMSA_PRD grava 'S'/'N' e
// BDIBPBMSA_DEV grava 'A'/'I' (mesma convenção do MDM). Toda LEITURA de
// "ativo" aceita as duas — senão, na DEV, cadastros, aprovadores e status
// voltam todos como inativos e o Novo Kaizen fica sem nenhuma opção.
const SG_ATIVO_SIM_SQL = "('S', 'A')";
const ehAtivo = (v) => ["S", "A"].includes(String(v || "").trim().toUpperCase());
const FULL_TABLE_NAME = `[${DB_SCHEMA}].[${DB_TABLE}]`;

// Data/hora de gravação no horário de Brasília.
//
// GETDATE() devolve o relógio do SERVIDOR, e o Azure SQL roda em UTC —
// por isso DT_ATUALIZACAO nascia 3 horas à frente. A conversão é feita
// pelo FUSO ('E. South America Standard Time' = São Paulo), não por um
// -3 fixo: se o horário de verão voltar, o cálculo continua certo
// sozinho. O CAST devolve DATETIME2, o tipo da coluna no DER.
//
// É expressão SQL, não parâmetro: entra direto no INSERT/UPDATE, no
// lugar exato onde antes estava GETDATE(). Os parênteses em volta do AT
// TIME ZONE são de propósito — deixam explícito que é ele que o CAST
// recebe, sem depender da precedência.
const AGORA_BRASILIA =
  "CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2)";

/** Contrapartida do AGORA_BRASILIA na SAÍDA da API.
 *
 * DATETIME2 não guarda fuso: o que está na coluna é o relógio de
 * Brasília, e mais nada. O driver (tedious, useUTC:true por padrão)
 * monta o Date tratando esse relógio como se fosse UTC — então os
 * componentes UTC do Date são exatamente o que está gravado.
 *
 * Se esse Date virar JSON sozinho, sai com "Z" no fim e o navegador
 * desconta o fuso dele de novo: 14:30 gravado aparecia 11:30 na tela.
 * Antes isso não incomodava porque a gravação estava 3h à frente e os
 * dois erros se cancelavam; com a gravação certa, o desconto ficaria
 * visível.
 *
 * Devolver "YYYY-MM-DDTHH:mm:ss" SEM o "Z" faz o navegador ler o mesmo
 * relógio como local — sem somar nem subtrair nada. Não depende do fuso
 * do servidor nem do aparelho de quem acessa. */
function relogioLocal(valor) {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return valor ?? null;
  return valor.toISOString().slice(0, 19);
}

/** Só a parte da DATA ("YYYY-MM-DD"), para as colunas do tipo DATE.
 *
 *  DT_CONCLUSAO é DATE no DER — não tem hora para mostrar. É o formato
 *  que o <input type="date"> entende, então serve direto para o
 *  formulário de edição. */
function somenteData(valor) {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return valor ?? null;
  return valor.toISOString().slice(0, 10);
}

/** Data de HOJE em Brasília, no formato "YYYY-MM-DD".
 *
 *  Não dá para usar `new Date().toISOString()`: o contêiner roda em UTC
 *  e, das 21h às 24h de Brasília, o UTC já está no dia seguinte — uma
 *  data informada "hoje" passaria a ser aceita como se fosse ontem. O
 *  fuso vem pelo nome ('America/Sao_Paulo'), então horário de verão, se
 *  voltar, é respeitado sozinho. 'en-CA' é o truque de sempre para
 *  receber a data já em ISO. */
function hojeEmBrasilia() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * Comparação de matrícula entre kzn_aprovador e kzn_mdm_hierarquia.
 *
 * As duas colunas se chamam CD_MATRICULA mas NÃO têm o mesmo tipo: uma é
 * numérica e a do MDM é texto — e o MDM guarda matrículas com letra
 * (ex.: 'FG002634'). Comparar direto faz o SQL Server converter o texto
 * para int e a consulta inteira morre com "Conversion failed when
 * converting the varchar value 'FG002634' to data type int", mesmo que a
 * linha com letra não tenha nada a ver com o aprovador procurado.
 *
 * Por isso a comparação nunca é direta:
 *   - TRY_CAST nos dois lados resolve o caso numérico e ignora zeros à
 *     esquerda ('000100' = 100). TRY_CAST devolve NULL em vez de estourar.
 *   - CAST para texto nos dois lados cobre a matrícula com letra.
 * Nenhum dos dois ramos pode lançar erro de conversão.
 */
const MATRICULA_IGUAL = (a, b) =>
  `(TRY_CAST(${a} AS BIGINT) = TRY_CAST(${b} AS BIGINT)` +
  ` OR CAST(${a} AS VARCHAR(30)) = CAST(${b} AS VARCHAR(30)))`;

/**
 * Casa uma linha de kzn_aprovador com a PESSOA dela em kzn_mdm_hierarquia.
 *
 * Nada a ver com o CANAL de envio: é sobre ACHAR O E-MAIL do aprovador.
 * Sem isto, o comunicado "aguardando sua aprovação" — que vai para uma
 * pessoa só — fica sem destinatário e não é enviado por caminho nenhum.
 *
 * O aprovador é o único papel sem uma coluna ID_USUARIO apontando para
 * ele. Dono do Kaizen e equipe vão diretos (ID_USUARIO_CADASTRO /
 * ID_USUARIO_LIDER / kzn_membros_equipe.ID_USUARIO). O aprovador sai de
 * kzn_aprovador.CD_MATRICULA — e essa coluna, na prática, guarda coisas
 * diferentes conforme a época da linha:
 *
 *   (a) um ID_USUARIO. É o caso do banco em produção: a linha
 *       ID_APROVADOR = 1 tem CD_MATRICULA = 181222, que é o ID_USUARIO
 *       da pessoa no MDM (cuja matrícula de verdade é '01181222').
 *       Comparar esse valor com MDM.CD_MATRICULA não acha ninguém.
 *   (b) uma matrícula de verdade, inclusive com letra ('FG002634').
 *   (c) nada (NULL ou vazio), nas linhas mais antigas — e aí quem
 *       identifica o aprovador é kzn_aprovador.ID_USUARIO.
 *
 * kzn_aprovador.ID_USUARIO NÃO serve de atalho geral: nas linhas novas
 * ele é QUEM CONCEDEU o direito, não quem aprova (ver POST /aprovadores).
 * Por isso o ramo (c) exige a matrícula vazia.
 *
 * Ordem de prioridade (ver ORDEM_PESSOA_DO_APROVADOR): matrícula, depois
 * ID_USUARIO na matrícula, depois a linha antiga. A ordem só decide
 * quando mais de um ramo acha alguém — aí o caminho oficial vence e nada
 * muda para quem grava matrícula de verdade.
 *
 * Sobrando NADA, fica sem destinatário de propósito: mandar "aprove este
 * Kaizen" para o concedente é pior do que não mandar.
 */
const PESSOA_DO_APROVADOR = (a) =>
  `(${MATRICULA_IGUAL("x.CD_MATRICULA", `${a}.CD_MATRICULA`)}
     OR x.ID_USUARIO = TRY_CAST(${a}.CD_MATRICULA AS BIGINT)
     OR (x.ID_USUARIO = ${a}.ID_USUARIO
         AND (${a}.CD_MATRICULA IS NULL OR LTRIM(RTRIM(CAST(${a}.CD_MATRICULA AS VARCHAR(30)))) = '')))`;

/** Prioridade dos três ramos do PESSOA_DO_APROVADOR, mais o desempate
 *  por ID_TIPO_USUARIO (a PK do MDM é composta, então a mesma pessoa
 *  aparece em mais de uma linha). Vai junto em todo OUTER APPLY. */
const ORDEM_PESSOA_DO_APROVADOR = (a) =>
  `CASE WHEN ${MATRICULA_IGUAL("x.CD_MATRICULA", `${a}.CD_MATRICULA`)} THEN 0
        WHEN x.ID_USUARIO = TRY_CAST(${a}.CD_MATRICULA AS BIGINT) THEN 1
        ELSE 2 END, x.ID_TIPO_USUARIO`;

/** NM_SITE de uma pessoa do MDM, pelo ID_USUARIO.
 *
 *  TOP (1) com ORDER BY ID_TIPO_USUARIO, e não um SELECT direto: a PK do
 *  MDM é composta (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO), então o
 *  mesmo ID_USUARIO aparece em mais de uma linha e um SELECT sem ordem
 *  devolveria o site de uma linha qualquer — mudando de resultado entre
 *  execuções. É o mesmo cuidado que os OUTER APPLY deste arquivo tomam.
 *
 *  Recebe o NOME do parâmetro (ex.: "@lider"), nunca um valor: o ID
 *  continua viajando como parâmetro tipado, fora do texto do comando. */
const SITE_DO_USUARIO = (param) =>
  `(SELECT TOP (1) s.NM_SITE FROM ${FULL_MDM_TABLE} s
     WHERE s.ID_USUARIO = ${param} ORDER BY s.ID_TIPO_USUARIO)`;

// Mesmo schema dos aprovadores; tabela própria, também sobrescrevível
// por env var caso o nome real divirja do padrão.
const DB_CATEGORIA_TABLE = safeIdentifier(process.env.AZURE_SQL_CATEGORIA_TABLE, "kzn_categoria");
const FULL_CATEGORIA_TABLE = `[${DB_SCHEMA}].[${DB_CATEGORIA_TABLE}]`;

const DB_PENDENCIA_TABLE = safeIdentifier(process.env.AZURE_SQL_PENDENCIA_TABLE, "kzn_pendenciaconsolidada");
const FULL_PENDENCIA_TABLE = `[${DB_SCHEMA}].[${DB_PENDENCIA_TABLE}]`;

// Cadastro de pessoas (nome/matrícula/e-mail dos aprovadores) — pelo
// DER é aqui que esses dados moram, não em kzn_aprovador.
const DB_MDM_TABLE = safeIdentifier(process.env.AZURE_SQL_MDM_TABLE, "kzn_mdm_hierarquia");
const FULL_MDM_TABLE = `[${DB_SCHEMA}].[${DB_MDM_TABLE}]`;

// Quem pode ABRIR o admin. Mesmo desenho de kzn_aprovador no DER
// (ID_ADMIN, ID_USUARIO, SG_ATIVO, DT_ATUALIZACAO) — o vínculo é por
// ID_USUARIO do MDM, e SG_ATIVO='S' é o que vale.
const DB_ADMIN_TABLE = safeIdentifier(process.env.AZURE_SQL_ADMIN_TABLE, "kzn_admin");
const FULL_ADMIN_TABLE = `[${DB_SCHEMA}].[${DB_ADMIN_TABLE}]`;

// ------------------------------------------------------------------
// Tela "Novo Kaizen" (kaizen-novo.html) — ver
// Usuário - Novo Kaizen - Aprovação.txt
// ------------------------------------------------------------------
// Tabela principal: 1 linha por Kaizen enviado. NM_KAIZEN passou de
// VARCHAR(30) para VARCHAR(100) — o DER antigo repetia o limite curto
// das tabelas de cadastro e 30 caracteres não davam para um título
// compreensível. A coluna precisa ser alargada no banco pelo script
// database/alterar_nm_kaizen_100.sql; até lá o servidor continua
// aceitando só o tamanho REAL da coluna (ver limiteNmKaizen abaixo).
const DB_PVC_TABLE = safeIdentifier(process.env.AZURE_SQL_PVC_TABLE, "kzn_pedravisaoconsolidada");
const FULL_PVC_TABLE = `[${DB_SCHEMA}].[${DB_PVC_TABLE}]`;

// Junção Kaizen <-> MDM (equipe): mesmo desenho para membro interno
// (Vale) e externo (terceiro) — os dois são apenas um ID_USUARIO do
// MDM; o que diferencia um terceiro é o ID_TIPO_USUARIO=2 na própria
// linha do MDM (ver ID_TIPO_USUARIO_TERCEIRO, já usado pela aba
// Usuários), não uma coluna separada aqui.
const DB_MEMBROS_TABLE = safeIdentifier(process.env.AZURE_SQL_MEMBROS_TABLE, "kzn_membros_equipe");
const FULL_MEMBROS_TABLE = `[${DB_SCHEMA}].[${DB_MEMBROS_TABLE}]`;

// FOTOGRAFIA da hierarquia do líder no momento em que o Kaizen foi
// gravado: 1 linha por Kaizen (ID_KAIZEN é a PK), com os 8 níveis
// copiados de kzn_mdm_hierarquia.
//
// Por que copiar em vez de só apontar para o MDM: a hierarquia muda
// (promoção, troca de gestor, reorganização). Um relatório que lesse o
// MDM de hoje mostraria o Kaizen do ano passado pendurado na estrutura
// atual. Aqui fica registrado a QUEM ele pertencia quando foi gravado.
// Por isso a cópia é refeita a cada gravação — criar e editar —, e não
// só no cadastro.
const DB_KAIZEN_HIER_TABLE = safeIdentifier(process.env.AZURE_SQL_KAIZEN_HIER_TABLE, "kzn_kaizen_hierarquia");
const FULL_KAIZEN_HIER_TABLE = `[${DB_SCHEMA}].[${DB_KAIZEN_HIER_TABLE}]`;

// kzn_moeda NÃO é bilíngue (sem ID_IDIOMA no DER) — por isso não passa
// por registrarCadastroBilingue() como as outras 6 tabelas de cadastro;
// ver GET /moedas abaixo, bem mais simples.
const DB_MOEDA_TABLE = safeIdentifier(process.env.AZURE_SQL_MOEDA_TABLE, "kzn_moeda");
const FULL_MOEDA_TABLE = `[${DB_SCHEMA}].[${DB_MOEDA_TABLE}]`;

// Reduções de desperdício: seleção MÚLTIPLA na tela. O DER original
// tinha uma FK única ID_DESPERDICIO na kzn_pedravisaoconsolidada, que
// não comporta múltipla escolha; a tabela de junção abaixo resolve, no
// mesmo padrão de kzn_resultado_kaizen, e é a ÚNICA fonte da lista.
//
// A coluna PVC.ID_DESPERDICIO não existe mais no banco. Enquanto ela
// existia, o INSERT ainda a citava gravando NULL — resquício inofensivo
// até ela ser removida, quando virou "Invalid column name
// 'ID_DESPERDICIO'" e derrubou o cadastro inteiro. Não citar coluna que
// não se usa: é o que evita que a próxima remoção quebre de novo.
const DB_KZ_DESPERDICIO_TABLE = safeIdentifier(process.env.AZURE_SQL_KZ_DESPERDICIO_TABLE, "kzn_kaizen_desperdicio");
const FULL_KZ_DESPERDICIO_TABLE = `[${DB_SCHEMA}].[${DB_KZ_DESPERDICIO_TABLE}]`;

// Log de gravações da tabela ATUAL — uma linha por operação (INSERT/
// UPDATE), com DT_OPERACAO. É a fonte confiável da ÚLTIMA atualização
// de um Kaizen (ver GET /kaizens/exportar): DT_ATUALIZACAO/DT_CRIACAO
// na própria kzn_pedravisaoconsolidada passou a registrar o CADASTRO
// (ver colunaAtualizacaoDe), não a última edição. Sem equivalente
// histórico — Kaizen do histórico é arquivo fechado, não recebe edição.
const DB_LOG_PVC_TABLE = safeIdentifier(process.env.AZURE_SQL_LOG_PVC_TABLE, "kzn_log_pedravisaoconsolidada");
const FULL_LOG_PVC_TABLE = `[${DB_SCHEMA}].[${DB_LOG_PVC_TABLE}]`;
// Detalhe de cada linha do log (FK_KZN_LOG_PVC_DETALHE_LOG, coluna
// ID_LOG) — confirmado pela mensagem de erro 547 ao excluir um Kaizen
// sem limpar aqui primeiro. Nunca referenciada em nenhuma rota antes.
const DB_LOG_PVC_DETALHE_TABLE = safeIdentifier(process.env.AZURE_SQL_LOG_PVC_DETALHE_TABLE, "kzn_log_pedravisaoconsolidada_detalhe");
const FULL_LOG_PVC_DETALHE_TABLE = `[${DB_SCHEMA}].[${DB_LOG_PVC_DETALHE_TABLE}]`;

// "Outros resultados": grava em kzn_resultados (item bilíngue novo,
// texto duplicado nos 2 idiomas — não há como auto-traduzir a
// descrição livre) + a junção kzn_resultado_kaizen, que já existe no
// DER original.
const DB_RESULTADOS_TABLE = safeIdentifier(process.env.AZURE_SQL_RESULTADOS_TABLE, "kzn_resultados");
const FULL_RESULTADOS_TABLE = `[${DB_SCHEMA}].[${DB_RESULTADOS_TABLE}]`;
const DB_RESULTADO_KAIZEN_TABLE = safeIdentifier(process.env.AZURE_SQL_RESULTADO_KAIZEN_TABLE, "kzn_resultado_kaizen");
const FULL_RESULTADO_KAIZEN_TABLE = `[${DB_SCHEMA}].[${DB_RESULTADO_KAIZEN_TABLE}]`;

/* ── Tabelas HISTÓRICAS ───────────────────────────────────────────
   Kaizens de anos anteriores, carregados em tabelas próprias com o
   MESMO desenho das atuais. A Biblioteca lê as duas (UNION ALL); a
   Aprovação não — histórico é Kaizen concluído, e pô-lo na fila faria
   o aprovador abrir a tela com milhares de itens para decidir de novo.

   A KZN_HIST_PEDRAVISAOCONSOLIDADA já nasceu com DS_COMPARA_META e
   DS_RESULTADO_ALCANCADO, e SEM o ID_DESPERDICIO que saiu da atual —
   ou seja, está no desenho novo. A atual pode ainda estar no antigo se
   database/adicionar_colunas_texto_pvc.sql não tiver rodado, e é por
   isso que o lado atual do UNION resolve o nome da coluna em tempo de
   execução (ver fonteBiblioteca). */
const DB_HIST_PVC_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_PVC_TABLE, "kzn_hist_pedravisaoconsolidada");
const FULL_HIST_PVC_TABLE = `[${DB_SCHEMA}].[${DB_HIST_PVC_TABLE}]`;
const DB_HIST_KZ_DESPERDICIO_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_KZ_DESPERDICIO_TABLE, "kzn_hist_kaizen_desperdicio");
const FULL_HIST_KZ_DESPERDICIO_TABLE = `[${DB_SCHEMA}].[${DB_HIST_KZ_DESPERDICIO_TABLE}]`;
const DB_HIST_MEMBROS_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_MEMBROS_TABLE, "kzn_hist_membros_equipe");
const FULL_HIST_MEMBROS_TABLE = `[${DB_SCHEMA}].[${DB_HIST_MEMBROS_TABLE}]`;
const DB_HIST_RESULTADO_KAIZEN_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_RESULTADO_KAIZEN_TABLE, "kzn_hist_resultado_kaizen");
const FULL_HIST_RESULTADO_KAIZEN_TABLE = `[${DB_SCHEMA}].[${DB_HIST_RESULTADO_KAIZEN_TABLE}]`;
const DB_HIST_KAIZEN_HIER_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_KAIZEN_HIER_TABLE, "kzn_hist_kaizen_hierarquia");
const FULL_HIST_KAIZEN_HIER_TABLE = `[${DB_SCHEMA}].[${DB_HIST_KAIZEN_HIER_TABLE}]`;
// kzn_hist_mdm_vbm_terc: espelho do MDM (ID_USUARIO, NM_USUARIO, NM_SITE,
// NM_ESTADO, NM_CIDADE, ID_TIPO_USUARIO, CD_MATRICULA, NM_POSICAO, ...)
// só para pessoas de Kaizens HISTÓRICOS — quem já não existe mais no MDM
// atual (kzn_mdm_hierarquia) não pode ser achado lá para um Kaizen de
// anos atrás. Schema confirmado por consulta direta (SSMS); PK é só
// ID_USUARIO (sem CD_MATRICULA/ID_TIPO_USUARIO compostos como no MDM
// atual), então não há ambiguidade de linha por pessoa aqui.
const DB_HIST_MDM_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_MDM_TABLE, "kzn_hist_mdm_vbm_terc");
const FULL_HIST_MDM_TABLE = `[${DB_SCHEMA}].[${DB_HIST_MDM_TABLE}]`;
// kzn_hist_aprovador: catálogo de aprovador dos Kaizens históricos — o
// ID_APROVADOR da PVC histórica só existe AQUI, não em kzn_aprovador
// (confirmado por consulta direta: ID 328 só na HIST). Mesmas colunas de
// kzn_aprovador (ID_APROVADOR, CD_MATRICULA, SG_ATIVO, ID_USUARIO,
// DT_ATUALIZACAO).
const DB_HIST_APROVADOR_TABLE = safeIdentifier(process.env.AZURE_SQL_HIST_APROVADOR_TABLE, "kzn_hist_aprovador");
const FULL_HIST_APROVADOR_TABLE = `[${DB_SCHEMA}].[${DB_HIST_APROVADOR_TABLE}]`;

/* ORIGEM de um Kaizen: "A" (tabelas atuais) ou "H" (históricas).
   Só estes dois valores são aceitos; qualquer outra coisa vira null e
   quem chamou decide o que fazer — na edição, é recusar. */
function origemValida(x) {
  const o = String(x == null ? "" : x).trim().toUpperCase();
  return o === "A" || o === "H" ? o : null;
}
/** As cinco tabelas de uma origem, para leitura e gravação irem sempre
 *  ao mesmo conjunto. É a única tabela de despacho por origem: não há
 *  outro ponto do código que escolha tabela histórica ou atual. */
function tabelasDaOrigem(origem) {
  const h = origem === "H";
  return {
    pvc: h ? FULL_HIST_PVC_TABLE : FULL_PVC_TABLE,
    membros: h ? FULL_HIST_MEMBROS_TABLE : FULL_MEMBROS_TABLE,
    desperdicio: h ? FULL_HIST_KZ_DESPERDICIO_TABLE : FULL_KZ_DESPERDICIO_TABLE,
    resultado: h ? FULL_HIST_RESULTADO_KAIZEN_TABLE : FULL_RESULTADO_KAIZEN_TABLE,
    hierarquia: h ? FULL_HIST_KAIZEN_HIER_TABLE : FULL_KAIZEN_HIER_TABLE,
  };
}

// Nomes de tabela usados só em JOINs de leitura (Biblioteca) — mesmas
// env vars/padrões já usados nos cadastros bilíngues acima (registrarCadastroBilingue).
const FULL_REPLICACAO_TABLE = tabelaCadastro("AZURE_SQL_REPLICACAO_TABLE", "kzn_replicacao");
const FULL_DESPERDICIO_TABLE = tabelaCadastro("AZURE_SQL_DESPERDICIO_TABLE", "kzn_desperdicio");
// kzn_status substituiu kzn_motivo_reprovacao, que saiu do DER: agora é
// o cadastro do CICLO DE VIDA do Kaizen (PVC.ID_STATUS aponta para cá) e
// a origem do rótulo mostrado nas telas.
const FULL_STATUS_TABLE = tabelaCadastro("AZURE_SQL_STATUS_TABLE", "kzn_status");

// kzn_categoria guarda 1 LINHA POR IDIOMA para a mesma categoria (mesmo
// ID_CATEGORIA, ID_IDIOMA diferente) — confirmado no DER
// (database/DER_VBM_Kaizen_CI.html) e pelo time: ID_IDIOMA=1 é Português,
// ID_IDIOMA=2 é Inglês (kzn_idioma).
const ID_IDIOMA_PT = 1;
const ID_IDIOMA_EN = 2;

// Traduz o idioma da tela (?idioma=pt-BR|en, o mesmo valor guardado em
// localStorage 'vdt-lang') para o ID_IDIOMA do banco. Qualquer valor
// desconhecido/ausente cai em português — nunca deixa a lista vazia
// por causa de um parâmetro estranho.
function idIdiomaDaRequisicao(req) {
  const bruto = String(req.query.idioma || "").trim().toLowerCase();
  if (bruto === "en" || bruto.startsWith("en-") || bruto === String(ID_IDIOMA_EN)) {
    return ID_IDIOMA_EN;
  }
  return ID_IDIOMA_PT;
}

// Helpers globais de parsing de querystring/body — usados pela
// Biblioteca (GET /kaizens) e por qualquer rota futura.
function intOuNuloGlobal(valor) {
  if (valor === "" || valor == null) return null;
  const n = parseInt(valor, 10);
  return Number.isInteger(n) ? n : null;
}
function textoOuNuloGlobal(valor) {
  if (valor == null) return null;
  const limpo = String(valor).trim();
  return limpo === "" ? null : limpo;
}

/* Mesma ideia de intOuNuloGlobal/textoOuNuloGlobal, para filtros de
 * MÚLTIPLA escolha: a Biblioteca manda a lista inteira num parâmetro só,
 * separado por vírgula (ex.: ?status=3,5,6) — é o formato que
 * `new URLSearchParams({status: [3,5,6]})` já produz sozinho no
 * navegador, então o front não precisa montar a string à mão nem repetir
 * o nome do parâmetro.
 *
 * Ausente, vazio ou só vírgula devolve [] — "nenhum filtro aplicado",
 * nunca "filtrar por nada" (que devolveria zero linhas). Duplicata e
 * espaço em volta são tolerados e descartados. */
function listaIntOuVaziaGlobal(valor) {
  if (valor == null || valor === "") return [];
  const vistos = new Set();
  const lista = [];
  for (const parte of String(valor).split(",")) {
    const n = parseInt(parte.trim(), 10);
    if (Number.isInteger(n) && !vistos.has(n)) { vistos.add(n); lista.push(n); }
  }
  return lista;
}
function listaTextoOuVaziaGlobal(valor) {
  if (valor == null || valor === "") return [];
  const vistos = new Set();
  const lista = [];
  for (const parte of String(valor).split(",")) {
    const limpo = parte.trim();
    if (limpo && !vistos.has(limpo)) { vistos.add(limpo); lista.push(limpo); }
  }
  return lista;
}

/** IN (...) com um parâmetro NOMEADO por valor — nunca o valor
 *  concatenado no texto do comando. `prefixo` dá nomes únicos
 *  (ex.: idStatus0, idStatus1…) para não colidir com outro filtro da
 *  mesma consulta. Lista vazia não empurra filtro nenhum. */
function filtroEmLista(filtros, params, coluna, prefixo, valores, tipoSql) {
  if (!valores.length) return;
  const nomes = valores.map((v, i) => {
    const nome = `${prefixo}${i}`;
    params.push([nome, tipoSql, v]);
    return `@${nome}`;
  });
  filtros.push(`${coluna} IN (${nomes.join(", ")})`);
}

function checkConfig() {
  const missing = [
    ["AZURE_SQL_SERVER", DB_SERVER],
    ["KAIZEN_AZURE_SQL_DATABASE", DB_NAME],
    ["AZURE_SQL_USER", DB_USER],
    ["AZURE_SQL_PASSWORD", DB_PASSWORD],
  ]
    .filter(([, val]) => !val)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error("Faltam variáveis de configuração: " + missing.join(", ") +
      " (usuário/senha vêm dos App resources 'db-user'/'db-password' via valueFrom no app.yaml)");
  }
}

// ------------------------------------------------------------------
// Conexão (pool reaproveitado — evita reabrir handshake TLS/login a
// cada requisição; mesmo raciocínio do app.py, que usa
// @st.cache_resource para cachear a conexão)
// ------------------------------------------------------------------
let poolPromise = null;

function createPool() {
  checkConfig();
  const config = {
    server: DB_SERVER,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    options: {
      encrypt: true, // obrigatório para Azure SQL
      trustServerCertificate: false,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  };
  return new sql.ConnectionPool(config).connect();
}

async function getPool() {
  if (!poolPromise) poolPromise = createPool();
  try {
    return await poolPromise;
  } catch (err) {
    poolPromise = null; // não cacheia promise quebrada
    throw err;
  }
}

/** Executa um request parametrizado; `params` é um array de
 * [nome, tipoSql, valor], nunca concatenado na string SQL. */
/* Quanto tempo ESTA requisição passou esperando o banco, e em quantas
   idas.

   Existe para responder uma pergunta que não se responde por palpite:
   a tela está lenta por causa do BANCO ou do resto? Com o total da
   requisição e o tempo de SQL lado a lado, a subtração dá o que foi
   gasto FORA do banco — aplicação, leitura de imagem no volume,
   serialização, rede do Databricks Apps até o navegador.

   AsyncLocalStorage, e não uma variável de módulo: o Node é de uma
   linha só, mas cada `await` intercala requisições. Com variável
   global, a requisição B assumiria o lugar enquanto A espera o banco, e
   o tempo de A seria somado no contador de B — o instrumento mediria
   errado justamente quando há concorrência, que é quando ele importa. */
const { AsyncLocalStorage } = require("node:async_hooks");
const medicaoRequisicao = new AsyncLocalStorage();

async function runQuery(query, params = []) {
  const pool = await getPool();
  const request = pool.request();
  params.forEach(([name, type, value]) => request.input(name, type, value));
  const alvo = medicaoRequisicao.getStore();
  try {
    if (!alvo) return await request.query(query);
    const inicio = process.hrtime.bigint();
    try {
      return await request.query(query);
    } finally {
      alvo.sqlMs += Number(process.hrtime.bigint() - inicio) / 1e6;
      alvo.sqlQtd += 1;
    }
  } catch (err) {
    // Prende o TEXTO do comando que falhou no próprio erro — é o que
    // permite a rota devolver, no diagnóstico, qual consulta exata foi
    // para o banco, sem precisar do log do servidor.
    err.sqlQuery = query;
    throw err;
  }
}

/** Corpo de erro para as rotas da Biblioteca/Aprovação: inclui o SQL
 *  que falhou (err.sqlQuery, preso por runQuery) quando ele existe —
 *  diagnóstico temporário para achar, sem log do servidor, exatamente
 *  qual comando ainda cita uma coluna que não existe mais na tabela. */
function corpoErroSql(mensagem, err) {
  const corpo = { error: mensagem + err.message };
  if (err.sqlQuery) corpo.sql = err.sqlQuery;
  return corpo;
}

// ------------------------------------------------------------------
// Estáticos
// ------------------------------------------------------------------
// ANTES: "no-store" em TUDO. Isso proíbe o navegador até de guardar
// uma cópia, então cada ida e volta entre index/admin/biblioteca/etc.
// rebaixava de novo os mesmos ~160 KB de CSS, ~154 KB de fontes e os
// fundos de 0,6–1,3 MB — era o principal motivo da navegação lenta
// entre as páginas.
//
// AGORA, por tipo de arquivo, sem perder atualização em deploy:
//
//   • arquivos com hash no nome (<hash>_nome.ext, ex.: as fontes em
//     assets/fonts, o favicon em assets/icons, as fotos em
//     assets/images e o Font Awesome em css/vendor) — o hash faz parte
//     do nome, então conteúdo novo = nome novo. Podem ir de cache
//     "para sempre" (immutable): zero requisição em navegações
//     seguintes. A regra olha só o nome do arquivo, não a pasta, para
//     continuar valendo depois da reorganização de diretórios.
//   • todo o resto (HTML, css/vbm-app.css, js/*.js, SVGs de fundo) —
//     "no-cache" + ETag: o navegador SEMPRE revalida (deploy continua
//     aparecendo na hora, igual a antes), mas quando nada mudou o
//     servidor responde 304 sem corpo. Um fundo de 1,3 MB vira uma
//     resposta de algumas centenas de bytes.
const UM_ANO_EM_SEGUNDOS = 60 * 60 * 24 * 365;
const ARQUIVO_COM_HASH_NO_NOME = /(?:^|[\\/])[0-9a-f]{8,}_[^\\/]+$/i;
// Arquivos que são conteúdo estático puro: mesmo sem versão na URL, não
// precisam de uma ida ao servidor por navegação.
const ATIVO_ESTATICO = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp4|webm)$/i;

// ------------------------------------------------------------------
// Controle de acesso (kzn_admin / kzn_aprovador / MDM)
// ------------------------------------------------------------------
// Páginas restritas e o critério de cada uma, sempre pelo CADASTRO no
// banco, pelo ID_USUARIO do MDM:
//
//   admin.html                             -> kzn_admin    (SG_ATIVO='S')
//   aprovacao.html                         -> kzn_aprovador (SG_ATIVO='S')
//   /, index.html, biblioteca.html,
//   kaizen-novo.html                       -> "membro": só precisa
//                                              EXISTIR no MDM (mesma
//                                              tabela, sem exigir papel).
//
// "Membro" não é KZN_KAIZEN_HIERARQUIA: aquela tabela é uma FOTOGRAFIA
// por KAIZEN (1 linha por ID_KAIZEN, os 8 níveis do líder no momento da
// gravação — ver FULL_KAIZEN_HIER_TABLE), não uma lista de usuários
// autorizados. Usá-la aqui bloquearia qualquer pessoa que ainda não
// tenha liderado um Kaizen, mesmo com acesso legítimo — trocaria um
// buraco de segurança por uma regressão funcional. kzn_mdm_hierarquia
// (via perfilDeAcesso) já é a tabela que o sistema usa para controle de
// acesso em toda a aplicação (admin/aprovador acima, e o gate da API
// logo abaixo) — é dela que "membro" também lê.
//
// A identidade vem do MESMO lugar que já grava o ID_USUARIO nos
// cadastros: o cabeçalho X-Forwarded-Email do proxy do Databricks Apps
// (ver idUsuarioLogado()/buscarMdmPorEmail() abaixo). Não é forjável
// por quem acessa a URL publicada, ao contrário de qualquer coisa que
// o navegador mande — por isso a decisão é SEMPRE do servidor, e o
// front-end só esconde os links (reforço visual, nunca a trava).
//
// DENY BY DEFAULT: sem cabeçalho, e-mail sem correspondência no MDM,
// tabela inacessível ou erro de consulta => acesso NEGADO. Nenhum
// desses cenários "abre" a página.
const PAGINAS_RESTRITAS = {
  "/admin.html": "admin",
  "/aprovacao.html": "aprovador",
  "/": "membro",
  "/index.html": "membro",
  "/biblioteca.html": "membro",
  "/kaizen-novo.html": "membro",
};

// Perfil do usuário da requisição, em UMA consulta (MDM + os dois
// vínculos de papel). Memorizado no próprio req: o gate da API e o
// GET /api/me da mesma requisição reusam o resultado em vez de
// consultar de novo.
/* Identidade guardada por E-MAIL, por pouco tempo.

   O cache por requisição (req._perfilAcesso) resolvia a repetição
   DENTRO de uma chamada; abrir a Biblioteca dispara oito chamadas de
   API, e cada uma repetia esta consulta do zero. Eram 12 das 22 idas ao
   banco de uma única abertura de tela gastas em "quem é você?", sempre
   com a mesma resposta. Contra um banco a alguns milissegundos de
   distância isso não aparecia; do Databricks Apps para o Azure SQL,
   cada ida paga a latência da rede, e elas somam.

   TTL curto de propósito: a resposta vem de kzn_admin e kzn_aprovador,
   que a Administração edita. Sessenta segundos é o mesmo prazo que o
   catálogo de status já usa — tirar o acesso de alguém passa a valer no
   minuto seguinte, não instantaneamente. Negativa NÃO entra no cache:
   quem acabou de ser cadastrado no MDM não fica um minuto barrado. */
const TTL_IDENTIDADE_MS = 60 * 1000;
const identidadeCache = new Map();

function identidadeLer(email) {
  const item = identidadeCache.get(email);
  if (!item) return null;
  if (item.expiraEm < Date.now()) { identidadeCache.delete(email); return null; }
  return item.perfil;
}
function identidadeGravar(email, perfil) {
  // Só o que foi RECONHECIDO. Guardar a negativa faria um cadastro novo
  // no MDM demorar a valer, e é justamente quando a pessoa está tentando
  // entrar pela primeira vez.
  if (!perfil || !perfil.idUsuario) return;
  identidadeCache.set(email, { perfil, expiraEm: Date.now() + TTL_IDENTIDADE_MS });
}

async function perfilDeAcesso(req) {
  if (req._perfilAcesso) return req._perfilAcesso;

  const negar = (motivo) => {
    if (motivo) console.warn(`[acesso] negado: ${motivo}`);
    req._perfilAcesso = { idUsuario: null, admin: false, aprovador: false };
    return req._perfilAcesso;
  };

  const email = req.get("X-Forwarded-Email");
  if (!email) return negar("requisição sem X-Forwarded-Email (fora do Databricks Apps?)");

  const guardado = identidadeLer(email);
  if (guardado) { req._perfilAcesso = guardado; return guardado; }

  try {
    const result = await runQuery(
      `SELECT TOP (1) m.ID_USUARIO,
              CASE WHEN EXISTS (SELECT 1 FROM ${FULL_ADMIN_TABLE} ad
                                 WHERE ad.ID_USUARIO = m.ID_USUARIO AND ad.SG_ATIVO IN ${SG_ATIVO_SIM_SQL})
                   THEN 1 ELSE 0 END AS EH_ADMIN,
              CASE WHEN EXISTS (SELECT 1 FROM ${FULL_TABLE_NAME} ap
                                 WHERE ap.ID_USUARIO = m.ID_USUARIO AND ap.SG_ATIVO IN ${SG_ATIVO_SIM_SQL})
                   THEN 1 ELSE 0 END AS EH_APROVADOR
       FROM ${FULL_MDM_TABLE} m
       -- Sem LOWER() na COLUNA: a função invalidava qualquer índice em
       -- CD_EMAIL e esta é a consulta mais executada do sistema (roda
       -- antes de toda requisição de API). As collations padrão do SQL
       -- Server são case-insensitive, então a comparação direta casa
       -- igual e passa a usar índice.
       WHERE m.CD_EMAIL = @email`,
      [["email", sql.NVarChar(255), email]]
    );
    const linha = result.recordset[0];
    if (!linha) return negar(`e-mail "${email}" sem correspondência em ${FULL_MDM_TABLE}.CD_EMAIL`);

    req._perfilAcesso = {
      idUsuario: linha.ID_USUARIO || null,
      admin: linha.EH_ADMIN === 1,
      aprovador: linha.EH_APROVADOR === 1,
    };
    identidadeGravar(email, req._perfilAcesso);
    return req._perfilAcesso;
  } catch (err) {
    // Falha de consulta NUNCA libera: erro é tratado como sem permissão.
    return negar(`falha ao verificar permissões de "${email}": ${err.message}`);
  }
}

// Página de bloqueio: autossuficiente de propósito (só a folha de
// estilo pública do app), para não carregar nenhum script, dado ou
// componente da página restrita — o usuário sem permissão não recebe
// nada além desta mensagem. "membro" é o caso geral (fora do MDM);
// admin/aprovador mantêm a mensagem de sempre, citando a tabela certa.
function paginaAcessoNegado(papel) {
  const titulo = "Acesso não autorizado";
  const mensagem = papel === "membro"
    ? "Seu usuário não possui acesso ao Sistema Kaizen. Caso necessite acesso, entre em contato com o administrador da aplicação."
    : `Seu usuário não está cadastrado em <strong>${papel === "admin" ? "KZN_ADMIN" : "KZN_APROVADOR"}</strong>. Procure um administrador do VBM Kaizen para solicitar acesso.`;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titulo} — VBM Kaizen</title>
<link rel="stylesheet" href="css/vbm-app.css">
<style>
  .acesso-negado { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1.5rem; }
  .acesso-negado .caixa { max-width:460px; text-align:center; background:var(--vbm-white);
    border:1px solid var(--vbm-border); border-radius:12px; padding:2.5rem 2rem; }
  .acesso-negado .marca { width:52px; height:52px; margin:0 auto 1.25rem; border-radius:50%;
    background:var(--vbm-blue-pale); color:var(--vbm-blue-dark); font-size:1.5rem; font-weight:700;
    display:flex; align-items:center; justify-content:center; }
  .acesso-negado h1 { font-size:1.15rem; color:var(--vbm-dark); margin:0 0 .5rem; }
  .acesso-negado p { font-size:.85rem; color:var(--vbm-mid); margin:0 0 .35rem; line-height:1.5; }
  .acesso-negado .acoes { display:flex; gap:.6rem; justify-content:center; margin-top:1.5rem; flex-wrap:wrap; }
</style></head>
<body><div class="acesso-negado"><div class="caixa">
  <div class="marca" aria-hidden="true">!</div>
  <h1>${titulo}</h1>
  <p>${mensagem}</p>
  <p><em>You are not authorized to view this page.</em></p>
  <div class="acoes">
    <button type="button" class="btn btn-outline" onclick="location.reload()">Atualizar</button>
    <a class="btn btn-primary" href="index.html">Voltar ao início</a>
  </div>
</div></div></body></html>`;
}

// Gate das PÁGINAS — antes do express.static, senão o HTML restrito
// seria entregue pelo servidor de estáticos sem passar por aqui.
// "membro" só exige EXISTIR no MDM (perfil.idUsuario); admin/aprovador
// exigem o papel específico. Log com usuário (e-mail do proxy, mesmo
// sem correspondência no MDM), página, motivo e data — sem dado
// sensível: nenhuma linha de log tem o corpo da resposta nem conteúdo
// da tela, só a decisão de acesso.
kaizenWeb.use(async (req, res, next) => {
  const papel = PAGINAS_RESTRITAS[req.path.toLowerCase()];
  if (!papel) return next();

  const perfil = await perfilDeAcesso(req);
  const liberado = papel === "membro" ? !!perfil.idUsuario : perfil[papel];
  if (liberado) return next();

  const email = req.get("X-Forwarded-Email") || "(sem cabeçalho X-Forwarded-Email)";
  const motivo = papel === "membro" ? "fora do MDM (kzn_mdm_hierarquia)" : `papel exigido: ${papel}`;
  console.warn(`[acesso] NEGADO usuario="${email}" pagina="${req.path}" motivo="${motivo}" em ${new Date().toISOString()}`);
  res.status(403).set("Cache-Control", "no-store").type("html").send(paginaAcessoNegado(papel));
});

// Arquivos que NUNCA devem ser baixáveis pelo navegador.
//
// express.static(__dirname) serve a PASTA DO PROJETO INTEIRA, e o
// projeto tem o código do servidor e a configuração no mesmo diretório
// das páginas. Sem este filtro, GET /app.yaml devolve o arquivo com a
// senha do Azure SQL e o SAS do Blob, em texto puro, para quem tiver a
// URL do app.
//
// Lista de negação por PADRÃO, não por nome: nome de arquivo envelhece
// em silêncio e um módulo novo do servidor nasceria baixável. A primeira
// regra é a que importa — QUALQUER .js solto na raiz. Todo script que a
// TELA usa vive em js/, então "raiz = servidor" é a regra certa aqui, e
// nada do que as páginas carregam casa com estes padrões.
const ARQUIVOS_DO_SERVIDOR = [
  /^\/[^/]+\.js$/i,
  /^\/app\.ya?ml$/i,
  /^\/package(-lock)?\.json$/i,
  /^\/\.env/i,
  /^\/node_modules\//i,
  /^\/database\//i,
  /^\/docs\//i,
];

kaizenWeb.use((req, res, next) => {
  if (!ARQUIVOS_DO_SERVIDOR.some((p) => p.test(req.path))) return next();
  console.warn(`[acesso] bloqueado o download de ${req.path} (arquivo do servidor)`);
  // 404, e não 403: para quem sonda, o arquivo simplesmente não existe.
  res.status(404).set("Cache-Control", "no-store").json({ error: "Não encontrado." });
});

kaizenWeb.use(
  express.static(__dirname, {
    etag: true,
    index: false,
    lastModified: true,
    setHeaders: (res, filePath, stat) => {
      // Imutável em dois casos, porque nos dois o ENDEREÇO muda quando o
      // conteúdo muda — que é a condição para poder cachear para sempre:
      //   1. hash no nome do arquivo (o padrão do vendor);
      //   2. ?v=... na URL (css/vbm-app.css?v=20260819-1, as fontes, as
      //      páginas que já versionam suas folhas). Sem isto, esses
      //      arquivos voltavam com "no-cache" e revalidavam a CADA
      //      navegação, apesar de já carregarem a versão na URL.
      // O HTML nunca entra: ele é a porta de entrada e é quem carrega a
      // versão nova dos outros.
      const requisicao = res.req;
      const versionadoNaUrl = !!(requisicao && requisicao.query && requisicao.query.v);
      const ehHtml = /\.html?$/i.test(filePath);
      if (!ehHtml && (ARQUIVO_COM_HASH_NO_NOME.test(filePath) || versionadoNaUrl)) {
        res.set("Cache-Control", `public, max-age=${UM_ANO_EM_SEGUNDOS}, immutable`);
      } else if (ATIVO_ESTATICO.test(filePath)) {
        // Imagem/fonte sem versão na URL: uma hora de validade e
        // revalidação depois disso, em vez de ida ao servidor sempre.
        res.set("Cache-Control", `public, max-age=3600`);
      } else {
        res.set("Cache-Control", "no-cache");
      }
    },
  })
);

// ------------------------------------------------------------------
// API — kzn_aprovador
// ------------------------------------------------------------------
const apiRouter = express.Router();

/* Gate da API em TRÊS FAIXAS.
   Antes havia uma só: tudo exigia kzn_admin, com /me de exceção. Na
   prática isso trancava a aplicação inteira — quem não estava em
   KZN_ADMIN abria a Biblioteca e o Novo Kaizen e recebia 403 em todas
   as consultas, então não conseguia listar, cadastrar nem ser aprovado.

   As faixas, da mais aberta para a mais fechada:

     AUTENTICADO  qualquer pessoa que o proxy do Databricks identificou
                  e que existe no MDM. É o uso normal do sistema: ler a
                  Biblioteca e criar/editar o PRÓPRIO Kaizen. As rotas
                  de escrita desta faixa já fazem a checagem por LINHA
                  (contextoDeEdicao / podeEditarKaizen) — a faixa diz
                  "pode chamar", a rota diz "pode mexer NESTE registro".
     APROVADOR    kzn_aprovador: a fila e as decisões.
     ADMIN        kzn_admin: cadastros, usuários, aprovadores, testes.

   Continua sendo uma lista de EXCEÇÕES: rota que não estiver aqui cai
   na faixa ADMIN, ou seja, nasce fechada. */

// Faixa 1 — identidade. Devolve só quem está chamando.
const ROTAS_API_PUBLICAS = new Set(["/me"]);

// Faixa 1 — leitura do sistema, liberada a qualquer usuário autenticado.
// São as consultas que a Biblioteca e o Novo Kaizen precisam para
// funcionar. Nenhuma delas expõe dado de outra pessoa além do que já
// aparece no Kaizen publicado.
const ROTAS_LEITURA_AUTENTICADA = [
  /^\/kaizens$/,
  /^\/kaizens\/\d+$/,
  /^\/kaizens\/\d+\/edicao$/,
  /^\/kaizens\/(filtros|imagem|resumo|titulo-existe|exportar)$/,
  /^\/(categorias|status|replicacoes|desperdicios|resultados|tiporesultados|moedas|tiposkaizen)$/,
  /^\/aprovadores$/,
  /^\/aprovadores\/mdm(\/\d+)?$/,
  /^\/aprovacoes\/contagem$/,
];

// Faixa 1 — escrita do PRÓPRIO Kaizen. A permissão por linha é
// verificada dentro de cada rota; aqui só se garante que quem chama é
// alguém identificado.
const ROTAS_ESCRITA_AUTENTICADA = [
  { metodo: "POST", padrao: /^\/kaizens$/ },
  { metodo: "PUT", padrao: /^\/kaizens\/\d+$/ },
  { metodo: "DELETE", padrao: /^\/kaizens\/\d+$/ },
  { metodo: "POST", padrao: /^\/kaizens\/imagem$/ },
];

// Faixa 2 — aprovação. Fila e decisões.
const ROTAS_APROVADOR = [
  { metodo: "GET", padrao: /^\/aprovacoes$/ },
  { metodo: "POST", padrao: /^\/kaizens\/\d+\/(aprovar|reprovar|solicitar-alteracao|aviso)$/ },
];

function casa(lista, metodo, caminho) {
  return lista.some((r) =>
    r.padrao ? r.metodo === metodo && r.padrao.test(caminho) : r.test(caminho)
  );
}

apiRouter.use(async (req, res, next) => {
  // no-store por padrão. As rotas que PODEM ser guardadas pelo navegador
  // (listas de cadastro, imagem do Kaizen) sobrescrevem este cabeçalho
  // depois, cada uma com o prazo que faz sentido para ela.
  res.set("Cache-Control", "no-store");

  const caminho = req.path.toLowerCase();
  const metodo = req.method.toUpperCase();
  if (ROTAS_API_PUBLICAS.has(caminho)) return next();

  const perfil = await perfilDeAcesso(req);

  // Sem correspondência no MDM não há identidade: nem a faixa mais
  // aberta vale. perfilDeAcesso já registra o motivo no log.
  if (!perfil.idUsuario) {
    return res.status(403).json({ error: "Acesso não autorizado." });
  }

  const ehLeitura = metodo === "GET" && casa(ROTAS_LEITURA_AUTENTICADA, metodo, caminho);
  if (ehLeitura || casa(ROTAS_ESCRITA_AUTENTICADA, metodo, caminho)) return next();

  if (casa(ROTAS_APROVADOR, metodo, caminho)) {
    // Admin também decide: ele é quem destrava a fila quando o aprovador
    // designado está fora.
    if (perfil.aprovador || perfil.admin) return next();
    console.warn(`[acesso] API ${metodo} ${req.path} bloqueada (exige kzn_aprovador)`);
    return res.status(403).json({ error: "Acesso não autorizado." });
  }

  if (perfil.admin) return next();

  console.warn(`[acesso] API ${metodo} ${req.path} bloqueada (exige kzn_admin)`);
  res.status(403).json({ error: "Acesso não autorizado." });
});

// Busca ID_USUARIO + CD_MATRICULA + NM_USUARIO no MDM (kzn_mdm_hierarquia)
// por e-mail — mesma tabela já usada nas abas Aprovadores/Usuários, aqui
// só com outra chave de busca (e-mail em vez de ID_USUARIO). Devolve
// null em qualquer falha: os 3 campos são "extras" (cabeçalho e/ou
// auditoria de cadastro) — uma falha aqui nunca pode derrubar a
// identidade do usuário nem impedir um salvamento.
//
// Reaproveitada por GET /api/me (matrícula no cabeçalho) e por
// idUsuarioLogado() (usuário responsável ao criar/editar categoria) —
// mesma consulta, dois consumidores, sem duplicar SQL.
/* Mesma ideia e mesmo prazo do identidadeCache, para a linha do MDM.
   São duas consultas diferentes (esta traz matrícula e posição) e as
   duas rodavam várias vezes por abertura de tela. */
const mdmCache = new Map();

async function buscarMdmPorEmail(email) {
  if (!email) return null;
  const guardado = mdmCache.get(email);
  if (guardado && guardado.expiraEm >= Date.now()) return guardado.linha;
  try {
    const result = await runQuery(
      // Comparação direta, sem LOWER() na coluna — ver perfilDeAcesso.
      `SELECT TOP (1) ID_USUARIO, CD_MATRICULA, NM_USUARIO, NM_POSICAO, ID_TIPO_USUARIO, SG_ATIVO
         FROM ${FULL_MDM_TABLE} WHERE CD_EMAIL = @email ORDER BY ID_TIPO_USUARIO`,
      [["email", sql.NVarChar(255), email]]
    );
    const linha = result.recordset[0] || null;
    // Só o encontrado entra no cache, pela mesma razão do identidadeCache:
    // guardar "não achei" atrasaria quem acabou de entrar no MDM.
    if (linha) mdmCache.set(email, { linha, expiraEm: Date.now() + TTL_IDENTIDADE_MS });
    return linha;
  } catch (err) {
    console.warn("[mdm] falha ao consultar usuário por e-mail:", err.message);
    return null;
  }
}

// ID_USUARIO (kzn_mdm_hierarquia) do usuário logado, a partir do e-mail
// que o proxy do Databricks Apps já autenticou e repassa em
// X-Forwarded-Email (mesma identidade usada em GET /api/me e no
// cabeçalho — ver js/usuario-graph.js). Não depende do Microsoft Graph:
// o servidor nunca tem o token do Graph (ele mora só no navegador), e
// confiar num e-mail vindo do CLIENTE para gravar "quem criou/editou"
// permitiria forjar o campo pela própria requisição — o cabeçalho do
// proxy é reescrito a cada chamada e não é forjável por quem acessa a
// URL publicada, então é a fonte confiável para um campo de auditoria.
//
// null em qualquer cenário sem quebrar quem chamou: sem cabeçalho
// (fora do Databricks Apps), e-mail sem correspondência no MDM, ou
// falha na consulta. Loga o MOTIVO de cada null (visível nos logs do
// Databricks App) — sem isso, "gravou NULL" e "gravou o ID certo" são
// indistinguíveis de fora, e não dá pra saber se falta cabeçalho ou se
// o e-mail do proxy não bate com CD_EMAIL no MDM.
async function idUsuarioLogado(req) {
  const email = req.get("X-Forwarded-Email");
  if (!email) {
    console.warn("[usuario-logado] sem X-Forwarded-Email nesta requisição — fora do Databricks Apps?");
    return null;
  }
  const mdm = await buscarMdmPorEmail(email);
  if (!mdm) {
    console.warn(`[usuario-logado] e-mail "${email}" (do proxy) sem correspondência em ${FULL_MDM_TABLE}.CD_EMAIL`);
    return null;
  }
  console.log(`[usuario-logado] "${email}" -> ID_USUARIO ${mdm.ID_USUARIO}`);
  return mdm.ID_USUARIO || null;
}

// Identidade do usuário logado, na visão do Databricks Apps + MDM.
//
// O app roda ATRÁS do proxy do Databricks Apps, que já autenticou a
// pessoa (Entra ID) antes de a requisição chegar aqui e repassa a
// identidade em cabeçalhos X-Forwarded-*. Isso dá nome/e-mail reais sem
// nenhuma configuração extra e sem segundo login. A matrícula (que não
// vem do proxy nem do Graph) é buscada no MDM pelo e-mail.
//
// NÃO substitui o Microsoft Graph: aqui não há foto, cargo, empresa nem
// gestor — esses campos só vêm do Graph (ver js/usuario-graph.js). Este
// endpoint é o piso de identidade + a matrícula, usados no cabeçalho
// mesmo antes de o MSAL estar configurado.
//
// ?email=<e-mail> permite consultar a matrícula pelo e-mail do GRAPH,
// para quando o MSAL já resolveu a conta mas o proxy do Databricks não
// mandou X-Forwarded-Email (ex.: acesso fora do Databricks Apps).
//
// Segurança: os X-Forwarded-* são reescritos pelo proxy do Databricks a
// cada requisição, então não são forjáveis por quem acessa o app pela
// URL publicada. O access token repassado NÃO é devolvido ao navegador
// — só informamos se ele existe, para diagnóstico.
apiRouter.get("/me", async (req, res) => {
  const h = (nome) => req.get(nome) || null;

  const email = h("X-Forwarded-Email");
  const usuario = h("X-Forwarded-Preferred-Username") || h("X-Forwarded-User");
  const emailParaMdm = (typeof req.query.email === "string" && req.query.email.trim()) || email;

  // O proxy não manda nome de exibição; derivamos algo apresentável do
  // e-mail ("maria.souza@vale.com" -> "Maria Souza") só como último
  // fallback — o MDM (nome real) e o Graph (displayName) têm prioridade.
  const base = (email || usuario || "").split("@")[0];
  const nomeDerivado = base
    ? base
        .split(/[._-]+/)
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ")
    : null;

  const mdm = await buscarMdmPorEmail(emailParaMdm);

  // Papéis SEMPRE pelo cabeçalho do proxy — nunca por ?email=, que o
  // navegador escolhe. Senão bastaria pedir /api/me?email=<um admin>
  // para o front-end reexibir os links restritos. (Reexibir o link não
  // abriria nada: o gate acima recusa a página de qualquer jeito. Ainda
  // assim, a resposta não pode afirmar um papel que o chamador não tem.)
  const perfil = await perfilDeAcesso(req);

  res.json({
    autenticado: !!(email || usuario),
    nome: (mdm && mdm.NM_USUARIO) || nomeDerivado,
    email: email,
    // Papéis do usuário logado — o front-end usa só para esconder os
    // links de navegação das páginas restritas (ver window.VBMAcesso em
    // js/vbm-app.js). O bloqueio real é o gate de páginas/API.
    admin: perfil.admin,
    aprovador: perfil.aprovador,
    usuario: usuario,
    idUsuario: h("X-Forwarded-User"),
    matricula: (mdm && mdm.CD_MATRICULA) || null,
    // Cargo do MDM (NM_POSICAO) — é o que o cabeçalho mostra na 2ª
    // linha, no lugar da matrícula. Vem do mesmo SELECT, sem consulta
    // extra. O Graph tem um jobTitle próprio, mas a fonte aqui é o
    // banco, como o resto da tela.
    cargo: (mdm && mdm.NM_POSICAO) || null,
    // Líder padrão do Novo Kaizen: só vale se for Vale (tipo 1) ativo.
    valeAtivo: !!(mdm && mdm.ID_TIPO_USUARIO === 1 && mdm.SG_ATIVO === "A"),
    // Diagnóstico: mostra QUAIS cabeçalhos o Databricks está mandando,
    // sem expor o valor do token.
    _diagnostico: {
      temAccessToken: !!req.get("X-Forwarded-Access-Token"),
      cabecalhosRecebidos: Object.keys(req.headers)
        .filter((k) => k.toLowerCase().startsWith("x-forwarded"))
        .sort(),
    },
  });
});

// Conectividade (equivalente ao botão "Testar conexão" do app.py)
apiRouter.get("/test", async (req, res) => {
  try {
    await runQuery("SELECT 1 AS ok");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Listar
// kzn_aprovador é uma tabela de PAPEL, não de cadastro: pelo DER ela
// tem apenas ID_USUARIO (PK e FK para kzn_mdm_hierarquia), SG_ATIVO e
// DT_ATUALIZACAO. Nome, matrícula e e-mail NÃO moram aqui — vêm do
// MDM por join. (A versão anterior consultava NM_USER/CD_MATRICULA
// direto nesta tabela, o que produzia o erro "Invalid column name
// 'NM_USER'" visto na tela.)
// Consequência de negócio: não existe "editar aprovador" — os dados
// pessoais são do MDM e o único campo próprio é SG_ATIVO. Por isso a
// aba tem listar, adicionar e ativar/desativar, sem edição.
// ?lider=<ID_USUARIO> | ?lider=logado — recorta a lista pelos aprovadores
// do MESMO NM_SITE do líder do projeto. Sem o parâmetro a rota segue como
// sempre (lista inteira), que é o que a aba Aprovadores do admin usa.
//
// "logado" existe porque no Novo Kaizen o campo Líder nasce preenchido com
// quem está logado e o hidden id_usuario_lider fica VAZIO até a pessoa
// escolher outro nome — é o mesmo acordo que POST /api/kaizens já tem. Sem
// isso, o caso mais comum (líder = eu) ficaria sem filtro.
//
// O site é resolvido AQUI, no SQL, direto da kzn_mdm_hierarquia: o
// navegador manda um ID, nunca um nome de site, então não há como pedir a
// lista de outra unidade trocando a querystring.
apiRouter.get("/aprovadores", async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limit, 10) || 500, 5000);

    // Quem é o líder, na mesma ordem de precedência do cadastro.
    const pedidoLider = String(req.query.lider || "").trim();
    let idLider = null;
    if (pedidoLider) {
      const n = parseInt(pedidoLider, 10);
      idLider = Number.isInteger(n) && n > 0 ? n : await idUsuarioLogado(req);
    }
    // LEFT JOIN de propósito: um aprovador cujo usuário saiu do MDM
    // continua listado (com os campos vazios) em vez de sumir da tela
    // sem explicação.
    // CD_EMAIL é o nome real da coluna no MDM (o DER antigo mostrava
    // DS_EMAIL — divergência só descoberta em produção, via "Invalid
    // column name"). Alias AS DS_EMAIL preserva o contrato do JSON
    // abaixo e o que o front-end já espera, sem tocar em mais nada.
    // QUEM é o aprovador vem de CD_MATRICULA (quem RECEBE o direito de
    // aprovar). ID_USUARIO desta tabela é outra pessoa: quem CONCEDEU o
    // direito — o usuário logado no momento da gravação.
    //
    // OUTER APPLY com TOP (1) em vez de LEFT JOIN direto: a PK do MDM é
    // (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO), então a mesma
    // matrícula pode aparecer em mais de um tipo e um join simples
    // duplicaria o aprovador na lista.
    const params = [["limite", sql.Int, limite]];
    // O recorte por site só entra quando HÁ um site para comparar. Um
    // líder sem NM_SITE no MDM zeraria a lista e travaria o cadastro — a
    // rota devolve a lista inteira nesse caso e registra o motivo no log,
    // que é um problema de dado a corrigir no MDM, não em silêncio.
    // Efeito colateral deliberado: um aprovador cujo usuário saiu do MDM
    // vem com m.NM_SITE nulo, e "NULL = 'CORPORATIVO'" é UNKNOWN — ele
    // NÃO entra na lista recortada. É o certo: sem pessoa no MDM não há
    // como afirmar que é da mesma unidade (nem há e-mail para notificar).
    // Na aba Aprovadores do admin, que chama sem ?lider=, ele continua
    // aparecendo, que é o que o OUTER APPLY foi feito para garantir.
    let filtroSite = "";
    let colunaSiteLider = "";
    if (idLider) {
      filtroSite = `WHERE ${SITE_DO_USUARIO("@idLider")} IS NULL
                       OR m.NM_SITE = ${SITE_DO_USUARIO("@idLider")}`;
      // O site do líder volta na resposta para o log abaixo e para a tela
      // poder dizer QUAL unidade está filtrando, sem uma segunda consulta.
      colunaSiteLider = `, ${SITE_DO_USUARIO("@idLider")} AS NM_SITE_LIDER`;
      params.push(["idLider", sql.Int, idLider]);
    }

    const result = await runQuery(
      `SELECT TOP (@limite)
              a.ID_APROVADOR, a.CD_MATRICULA, a.SG_ATIVO, a.DT_ATUALIZACAO,
              a.ID_USUARIO AS ID_CONCEDENTE,
              m.ID_USUARIO, m.NM_USUARIO, m.CD_EMAIL AS DS_EMAIL,
              m.NM_POSICAO, m.NM_ESTADO, m.NM_CIDADE, m.NM_SITE${colunaSiteLider}
       FROM ${FULL_TABLE_NAME} a
       OUTER APPLY (
         SELECT TOP (1) x.ID_USUARIO, x.NM_USUARIO, x.CD_EMAIL,
                        x.NM_POSICAO, x.NM_ESTADO, x.NM_CIDADE, x.NM_SITE
         FROM ${FULL_MDM_TABLE} x
         WHERE ${PESSOA_DO_APROVADOR("a")}
         ORDER BY ${ORDEM_PESSOA_DO_APROVADOR("a")}
       ) m
       ${filtroSite}
       -- NM_SITE entra na ordem para a Administração poder agrupar sem
       -- reordenar nada no navegador (ver a aba Aprovadores).
       ORDER BY m.NM_SITE, m.NM_USUARIO, a.ID_APROVADOR`,
      params
    );
    if (idLider) {
      const siteLider = result.recordset.length ? result.recordset[0].NM_SITE_LIDER : null;
      if (siteLider == null) {
        console.warn(`[aprovadores] líder ID_USUARIO=${idLider} sem NM_SITE em ${FULL_MDM_TABLE} — ` +
          "lista devolvida SEM recorte por site.");
      } else {
        console.log(`[aprovadores] recorte por site "${siteLider}" (líder ID_USUARIO=${idLider}): ` +
          `${result.recordset.length} aprovador(es).`);
      }
    }
    res.json(
      result.recordset.map((r) => ({
        // Identidade do REGISTRO: é a PK. ID_USUARIO não serve mais para
        // isso — o mesmo concedente aparece em vários registros.
        ID_APROVADOR: r.ID_APROVADOR,
        // ID_USUARIO do APROVADOR (vem do MDM), usado para reabrir o
        // modal já preenchido com a pessoa certa.
        ID_USUARIO: r.ID_USUARIO,
        // Quem concedeu o direito.
        ID_CONCEDENTE: r.ID_CONCEDENTE,
        CD_MATRICULA: r.CD_MATRICULA,
        NM_USUARIO: r.NM_USUARIO,
        DS_EMAIL: r.DS_EMAIL,
        // Cargo/estado/cidade vêm do MESMO join que já traz
        // nome/matrícula/e-mail, sem consulta extra. O cargo aparece no
        // card; os três juntos abrem o modal de edição já preenchido,
        // sem precisar consultar o MDM de novo.
        NM_POSICAO: r.NM_POSICAO,
        NM_ESTADO: r.NM_ESTADO,
        NM_CIDADE: r.NM_CIDADE,
        // Unidade da pessoa no MDM. É por ela que o Novo Kaizen recorta a
        // lista (?lider=) e que a Administração agrupa os cards.
        NM_SITE: r.NM_SITE,
        // Só vem quando ?lider= foi pedido: a unidade pela qual a lista
        // foi recortada, para a tela poder dizê-la sem consultar de novo.
        NM_SITE_LIDER: r.NM_SITE_LIDER != null ? r.NM_SITE_LIDER : undefined,
        ATIVO: ehAtivo(r.SG_ATIVO),
        DT_ATUALIZACAO: relogioLocal(r.DT_ATUALIZACAO),
      }))
    );
  } catch (err) {
    console.error("[aprovadores] erro ao listar:", err.message);
    res.status(500).json({ error: "Erro ao consultar aprovadores: " + err.message });
  }
});

// Busca de pessoas no MDM: ?q=<termo>, agora sempre em NM_USUARIO,
// CD_EMAIL e CD_MATRICULA ao mesmo tempo (nome, e-mail OU matrícula
// batendo já entra no resultado) — antes só buscava 1 coluna por vez
// via ?campo=nome|email, o que deixava a busca "errada" quando a
// pessoa digitava e-mail ou matrícula num campo pensado pra nome (ex.:
// Líder do Projeto). ?campo= é aceito mas ignorado (compatibilidade).
//
// TOP (10) e mínimo de 2 caracteres seguram o custo: sem isso, um
// LIKE '%%' varreria o MDM inteiro a cada tecla digitada.
const MDM_BUSCA_MIN = 2;

// Tipo de usuário "terceiro" no MDM (kzn_tipo_usuario). A aba Usuários
// lista SÓ esses — constante do servidor, nunca parâmetro da URL, para
// que o filtro não possa ser removido pelo cliente.
const ID_TIPO_USUARIO_TERCEIRO = 2;

// Monta o termo de um LIKE "contém", escapando os curingas do SQL Server
// (%, _ e [) para que o texto digitado seja buscado literalmente.
function termoContem(texto) {
  return "%" + String(texto).replace(/[[%_]/g, (c) => "[" + c + "]") + "%";
}
const MDM_BUSCA_TOP = 10;

// "Começa com": só o curinga à direita. Mesmo escape do termoContem —
// [, % e _ digitados são caracteres, não curingas.
function termoComecaCom(texto) {
  return String(texto).replace(/[[%_]/g, (c) => "[" + c + "]") + "%";
}
// Na busca por prefixo o 1º caractere já vale, e o teto sobe: com uma
// letra só, 10 linhas seriam um recorte arbitrário do alfabeto.
const MDM_BUSCA_INICIO_MIN = 1;
const MDM_BUSCA_INICIO_TOP = 50;

apiRouter.get("/aprovadores/mdm", async (req, res) => {
  try {
    // ?modo=inicio — casa pelo COMEÇO do nome ("cr" traz quem começa
    // com "cr", não quem tem "cr" no meio) e já busca no 1º caractere.
    // Usado pelos dois campos de equipe do Novo Kaizen; sem o parâmetro,
    // a rota segue como sempre (contém, mínimo de 2) — é o que a aba
    // Aprovadores usa.
    const porInicio = String(req.query.modo || "").toLowerCase() === "inicio";

    const termo = String(req.query.q || "").trim();
    const minimo = porInicio ? MDM_BUSCA_INICIO_MIN : MDM_BUSCA_MIN;
    if (termo.length < minimo) return res.json([]);

    const coluna = String(req.query.campo || "").toLowerCase() === "email" ? "CD_EMAIL" : "NM_USUARIO";
    const termoLike = porInicio ? termoComecaCom(termo) : termoContem(termo);
    const teto = porInicio ? MDM_BUSCA_INICIO_TOP : MDM_BUSCA_TOP;

    // ?tipo=1 (empregado próprio) ou ?tipo=2 (terceiro) — usado pelos
    // dois campos de equipe do Novo Kaizen, que buscam populações
    // diferentes. Só esses dois valores são aceitos; qualquer outra
    // coisa é ignorada e a busca segue sem recorte, que é o
    // comportamento de quem já usava esta rota (aba Aprovadores).
    const tipoPedido = parseInt(req.query.tipo, 10);
    const tipo = tipoPedido === 1 || tipoPedido === 2 ? tipoPedido : null;

    const params = [["termo", sql.NVarChar(255), termoLike]];
    let filtroTipo = "";
    if (tipo !== null) {
      // Campos do Novo Kaizen: só quem está ATIVO no MDM (SG_ATIVO = 'A').
      filtroTipo = "AND ID_TIPO_USUARIO = @tipo AND SG_ATIVO = 'A'";
      params.push(["tipo", sql.Int, tipo]);
    }

    // nome.sobrenome@vale.com -> "nome sobrenome": cobre quando
    // NM_USUARIO está vazio/errado mas o e-mail bate com o nome digitado
    // (mesmo raciocínio do nomeDoEmail() no front-end).
    const nomeDoEmail =
      "REPLACE(LEFT(CD_EMAIL, CASE WHEN CHARINDEX('@', CD_EMAIL) > 0 " +
      "THEN CHARINDEX('@', CD_EMAIL) - 1 ELSE LEN(CD_EMAIL) END), '.', ' ')";

    // Por prefixo a busca é de NOME: casar e-mail e matrícula pelo começo
    // traria gente que não "começa com" o que foi digitado no nome.
    const alternativas = porInicio
      ? [`NM_USUARIO LIKE @termo`, `${nomeDoEmail} LIKE @termo`]
      : [`NM_USUARIO LIKE @termo`, `CD_EMAIL LIKE @termo`,
         `CD_MATRICULA LIKE @termo`, `${nomeDoEmail} LIKE @termo`];

    const result = await runQuery(
      `SELECT TOP (${teto})
              ID_USUARIO, NM_USUARIO, CD_MATRICULA, CD_EMAIL, NM_POSICAO, NM_ESTADO, NM_CIDADE
       FROM ${FULL_MDM_TABLE}
       -- O bloco de OR fica entre parênteses: sem eles o AND do tipo se
       -- ligaria só à última alternativa e vazaria gente de outro tipo.
       WHERE (${alternativas.join(" OR ")})
       ${filtroTipo}
       ORDER BY NM_USUARIO`,
      params
    );
    res.json(result.recordset);
  } catch (err) {
    console.error("[aprovadores] erro ao buscar no MDM:", err.message);
    res.status(500).json({ error: "Erro ao buscar no MDM: " + err.message });
  }
});

// Consulta um usuário no MDM pelo ID — usada pelo formulário de
// "Novo Aprovador" para mostrar de quem é aquele ID antes de salvar
// (nome/matrícula/e-mail não são digitados: pertencem ao MDM).
apiRouter.get("/aprovadores/mdm/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "ID_USUARIO inválido." });

    const result = await runQuery(
      `SELECT TOP (1) ID_USUARIO, CD_MATRICULA, NM_USUARIO, CD_EMAIL AS DS_EMAIL, NM_POSICAO
       FROM ${FULL_MDM_TABLE} WHERE ID_USUARIO = @id`,
      [["id", sql.Int, id]]
    );
    if (!result.recordset.length) {
      return res.status(404).json({ error: "Usuário não encontrado no MDM." });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[aprovadores] erro ao consultar MDM:", err.message);
    res.status(500).json({ error: "Erro ao consultar o MDM: " + err.message });
  }
});

// CD_MATRICULA da pessoa, buscada no MDM pelo ID_USUARIO. Pelo DER,
// kzn_aprovador tem PK (ID_APROVADOR, CD_MATRICULA) e ID_USUARIO como
// FK — ou seja, a matrícula é NOT NULL e precisa ser gravada junto.
//
// Vem sempre do MDM, nunca do corpo da requisição: quem chama escolhe a
// pessoa (ID_USUARIO) e a matrícula é um dado derivado dela; aceitar do
// cliente permitiria gravar um par ID/matrícula que não existe no MDM.
//
// Devolve null quando o ID_USUARIO não existe lá — o que também serve
// de validação, poupando uma consulta só para conferir a existência.
/**
 * CD_MATRICULA da pessoa, lida de kzn_mdm_hierarquia.
 *
 * A PK do MDM é (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO): o MESMO
 * ID_USUARIO pode ter mais de uma linha, com matrículas DIFERENTES.
 * Procurar só pelo ID e pegar TOP (1) sem ORDER BY devolvia uma linha
 * qualquer — era assim que a matrícula errada acabava gravada.
 *
 * Por isso a tela manda também a CD_MATRICULA da linha que o usuário
 * escolheu na busca. Ela não é gravada como veio: serve para ACHAR a
 * linha certa, e o que vai para o banco é o valor que está no MDM.
 * Sem ela (cliente antigo), cai no modo por ID — agora com ORDER BY,
 * para pelo menos ser sempre a mesma linha.
 */
async function matriculaDoMdm(idUsuario, matriculaEscolhida) {
  if (matriculaEscolhida != null && String(matriculaEscolhida).trim() !== "") {
    const exata = await runQuery(
      `SELECT TOP (1) CD_MATRICULA FROM ${FULL_MDM_TABLE}
        WHERE ID_USUARIO = @id AND CD_MATRICULA = @matricula
        ORDER BY ID_TIPO_USUARIO`,
      [["id", sql.Int, idUsuario], ["matricula", sql.NVarChar(30), String(matriculaEscolhida).trim()]]
    );
    const achada = exata.recordset[0];
    if (achada && achada.CD_MATRICULA != null) return achada.CD_MATRICULA;
    return null; // par que não existe no MDM: não inventa uma matrícula
  }

  const r = await runQuery(
    `SELECT TOP (1) CD_MATRICULA FROM ${FULL_MDM_TABLE}
      WHERE ID_USUARIO = @id
      ORDER BY ID_TIPO_USUARIO, CD_MATRICULA`,
    [["id", sql.Int, idUsuario]]
  );
  const linha = r.recordset[0];
  return linha && linha.CD_MATRICULA != null ? linha.CD_MATRICULA : null;
}

/** Copia a hierarquia do LÍDER para kzn_kaizen_hierarquia.
 *
 *  Uma linha por Kaizen (ID_KAIZEN é a PK), refeita a cada gravação —
 *  cadastro e edição —, porque o líder pode mudar na edição e a própria
 *  hierarquia dele pode ter mudado no MDM desde a última vez.
 *
 *  Os oito níveis são lidos de kzn_mdm_hierarquia dentro do próprio
 *  MERGE. Trazer a hierarquia para o Node e devolvê-la ao banco seria
 *  uma ida e volta a mais, com uma janela no meio em que o MDM pode
 *  mudar.
 *
 *  RODA DEPOIS DO COMMIT do Kaizen, e de propósito. A primeira versão
 *  rodava dentro da transação e quebrou o cadastro em produção:
 *
 *    The MERGE statement conflicted with the FOREIGN KEY constraint
 *    "FK_KZN_KAIZEN_HIERARQUIA_KAIZEN" ... table
 *    "CI.KZN_PEDRAVISAOCONSOLIDADA", column 'ID_KAIZEN'.
 *
 *  Ou seja: na hora do MERGE o Kaizen recém-inserido ainda não estava
 *  visível para a checagem da FK. Depois do commit ele está, e a FK não
 *  tem como falhar.
 *
 *  O preço é a gravação não ser atômica com o Kaizen — e é o preço
 *  certo: esta tabela é uma FOTOGRAFIA para relatório. Deixar de
 *  registrar a hierarquia é um problema pequeno; impedir alguém de
 *  cadastrar um Kaizen por causa dela é um problema grande. Por isso
 *  nada aqui lança: falhou, fica no log e o cadastro segue.
 *
 *  O USING lê tudo das TABELAS, não de variáveis do Node: o ID_KAIZEN
 *  e o ID_USUARIO_LIDER saem da própria kzn_pedravisaoconsolidada, e a
 *  hierarquia sai de kzn_mdm_hierarquia pelo ID_USUARIO igual a esse
 *  líder. Assim a foto não tem como divergir do que ficou gravado no
 *  Kaizen, e a linha de origem só existe se o Kaizen existir — se ele
 *  não estiver lá, o MERGE não grava (e avisa) em vez de estourar a FK. */
async function gravarHierarquiaDoKaizen(idKaizen, origem) {
  // Sem origem, atual: é o caminho do cadastro novo, que só grava lá.
  const tab = tabelasDaOrigem(origem || "A");
  if (!Number.isInteger(idKaizen) || idKaizen <= 0) {
    console.warn(`[hierarquia] ID_KAIZEN inválido (${idKaizen}); nada gravado.`);
    return false;
  }
  const niveis = [];
  for (let n = 1; n <= 8; n++) niveis.push(`NM_HIERARQUIA_N${n}`);

  try {
    // OUTER APPLY com TOP (1), não LEFT JOIN direto: a PK do MDM é
    // (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO), então o mesmo
    // ID_USUARIO aparece em mais de uma linha e um join simples devolve
    // VÁRIAS origens para o mesmo ID_KAIZEN. O MERGE recusa isso — não dá
    // para gravar duas vezes a mesma linha de destino — e a gravação
    // inteira morre. Foi exatamente o que aconteceu em produção: o
    // cadastro passava, a tabela ficava vazia e o erro só aparecia no log.
    // Mesmo TOP(1)/ORDER BY ID_TIPO_USUARIO usado no resto do arquivo,
    // para a hierarquia bater com o líder mostrado na Biblioteca.
    //
    // OUTER APPLY (e não CROSS APPLY) mantém a linha quando o líder não
    // tem nenhum registro no MDM: os oito níveis saem NULL, que é para
    // isso que essas colunas são NULL-áveis. O que não pode faltar é a
    // linha do Kaizen.
    //
    // O OUTPUT devolve o que foi de fato gravado. Serve para o log dizer
    // se foi INSERT ou UPDATE e com que líder — sem uma segunda consulta,
    // e sem depender de rowsAffected.
    const r = await runQuery(
      `MERGE INTO ${tab.hierarquia} AS alvo
       USING (SELECT p.ID_KAIZEN,
                     p.ID_USUARIO_LIDER,
                     ${niveis.map((c) => `m.${c}`).join(",\n                     ")}
                FROM ${tab.pvc} p
                OUTER APPLY (
                  SELECT TOP (1) ${niveis.map((c) => `x.${c}`).join(", ")}
                    FROM ${FULL_MDM_TABLE} x
                   WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
                   ORDER BY x.ID_TIPO_USUARIO
                ) m
               WHERE p.ID_KAIZEN = @idKaizen) AS origem
          ON alvo.ID_KAIZEN = origem.ID_KAIZEN
       WHEN MATCHED THEN UPDATE SET
              alvo.ID_USUARIO_LIDER = origem.ID_USUARIO_LIDER,
              ${niveis.map((c) => `alvo.${c} = origem.${c}`).join(",\n              ")},
              alvo.DT_ATUALIZACAO = ${AGORA_BRASILIA}
       WHEN NOT MATCHED THEN
         INSERT (ID_KAIZEN, ID_USUARIO_LIDER, ${niveis.join(", ")}, DT_ATUALIZACAO)
         VALUES (origem.ID_KAIZEN, origem.ID_USUARIO_LIDER,
                 ${niveis.map((c) => `origem.${c}`).join(", ")}, ${AGORA_BRASILIA})
       OUTPUT $action AS ACAO, inserted.ID_USUARIO_LIDER, inserted.NM_HIERARQUIA_N1;`,
      [["idKaizen", sql.Int, idKaizen]]
    );

    const gravada = r.recordset && r.recordset[0];
    if (gravada) {
      // Sucesso também vai para o log. Sem isto, "a tabela está vazia"
      // não distingue "o código não rodou" de "rodou e não gravou".
      console.log(
        `[hierarquia] ID_KAIZEN=${idKaizen} ${gravada.ACAO} ` +
          `(líder ID_USUARIO=${gravada.ID_USUARIO_LIDER}, N1=${gravada.NM_HIERARQUIA_N1 ?? "NULL"}).`
      );
      return true;
    }
    // Com o LEFT JOIN só sobra uma explicação: o Kaizen não está na PVC.
    console.warn(`[hierarquia] ID_KAIZEN=${idKaizen} não encontrado em ${FULL_PVC_TABLE}; nada gravado.`);
    return false;
  } catch (err) {
    // Nunca derruba o cadastro: ver o comentário acima. O número do erro
    // vai junto porque é ele que separa "sem permissão" (229) de
    // "tabela não existe" (208) de violação de FK (547).
    console.error(
      `[hierarquia] ID_KAIZEN=${idKaizen}: falha ao gravar em ${FULL_KAIZEN_HIER_TABLE} ` +
        `(erro ${err.number || "?"}): ${err.message}`
    );
    return false;
  }
}

// ID_APROVADOR (PK própria de kzn_aprovador) a partir do ID_USUARIO
// escolhido na tela de Novo Kaizen — ver POST /kaizens abaixo. O
// front-end só conhece/mostra ID_USUARIO (é o que GET /aprovadores
// devolve); a FK de kzn_pedravisaoconsolidada é para ID_APROVADOR, não
// para ID_USUARIO, então resolvemos aqui, sempre no servidor, e de
// quebra confirmamos que o aprovador escolhido está ATIVO.
async function idAprovadorPorUsuario(idUsuario) {
  // Caminho INVERSO do PESSOA_DO_APROVADOR: a tela manda o ID_USUARIO da
  // pessoa (é o que /api/aprovadores devolve) e aqui se acha a linha de
  // kzn_aprovador correspondente. Os ramos têm de ser OS MESMOS de lá, na
  // mesma prioridade — senão o Kaizen é gravado apontando para um
  // ID_APROVADOR cuja pessoa o comunicado depois não consegue resolver,
  // que é o pior dos dois mundos.
  //
  //   0. a matrícula da linha casa com a matrícula do MDM;
  //   1. a "matrícula" da linha É o ID_USUARIO (caso do banco atual:
  //      ID_APROVADOR = 1 com CD_MATRICULA = 181222);
  //   2. a linha não tem matrícula e o ID_USUARIO dela é o aprovador
  //      (linhas antigas).
  const CASA_POR_MATRICULA =
    `EXISTS (SELECT 1 FROM ${FULL_MDM_TABLE} m
              WHERE m.ID_USUARIO = @id
                AND ${MATRICULA_IGUAL("m.CD_MATRICULA", "a.CD_MATRICULA")})`;
  const CASA_POR_ID_NA_MATRICULA = `TRY_CAST(a.CD_MATRICULA AS BIGINT) = @id`;
  const CASA_POR_ID_LEGADO =
    `(a.ID_USUARIO = @id
      AND (a.CD_MATRICULA IS NULL OR LTRIM(RTRIM(CAST(a.CD_MATRICULA AS VARCHAR(30)))) = ''))`;

  const r = await runQuery(
    `SELECT TOP (1) a.ID_APROVADOR
       FROM ${FULL_TABLE_NAME} a
      WHERE a.SG_ATIVO IN ${SG_ATIVO_SIM_SQL}
        AND (${CASA_POR_MATRICULA} OR ${CASA_POR_ID_NA_MATRICULA} OR ${CASA_POR_ID_LEGADO})
      ORDER BY CASE WHEN ${CASA_POR_MATRICULA} THEN 0
                    WHEN ${CASA_POR_ID_NA_MATRICULA} THEN 1
                    ELSE 2 END, a.ID_APROVADOR`,
    [["id", sql.Int, idUsuario]]
  );
  return r.recordset.length ? r.recordset[0].ID_APROVADOR : null;
}

// Adicionar — grava o vínculo (ID_USUARIO + CD_MATRICULA, ambos do
// MDM); o usuário precisa existir lá (a FK garante isso no banco, mas
// checamos antes para devolver uma mensagem clara em vez de um erro cru
// de constraint).
apiRouter.post("/aprovadores", async (req, res) => {
  try {
    const idUsuario = parseInt(req.body?.ID_USUARIO, 10);
    if (!Number.isInteger(idUsuario)) {
      return res.status(400).json({ error: "ID_USUARIO é obrigatório e deve ser um número inteiro." });
    }

    const matricula = await matriculaDoMdm(idUsuario, req.body?.CD_MATRICULA);
    if (matricula == null) {
      return res.status(400).json({ error: "Usuário não encontrado no MDM — verifique o ID_USUARIO." });
    }

    // Duplicidade é por MATRÍCULA: é ela que diz QUEM recebe o direito.
    const jaExiste = await runQuery(
      `SELECT TOP (1) 1 AS X FROM ${FULL_TABLE_NAME} WHERE ${MATRICULA_IGUAL("CD_MATRICULA", "@matricula")}`,
      [["matricula", sql.NVarChar(30), matricula]]
    );
    if (jaExiste.recordset.length) {
      return res.status(409).json({ error: "Este usuário já está cadastrado como aprovador." });
    }

    // ID_USUARIO = quem CONCEDE o direito = o usuário logado. Resolvido
    // no servidor (idUsuarioLogado), nunca enviado pelo cliente.
    const idConcedente = await idUsuarioLogado(req);
    if (idConcedente == null) {
      return res.status(400).json({
        error: "Não foi possível identificar o usuário logado no MDM para registrar quem concedeu o direito.",
      });
    }

    // ID_APROVADOR é NOT NULL e NÃO é identity: o banco não gera valor
    // sozinho, então o INSERT precisa trazer o próximo — mesma regra das
    // tabelas de cadastro (ver ISNULL(MAX(pk),0)+1 em
    // registrarCadastroBilingue). Sem isso o insert falha com "Cannot
    // insert the value NULL into column 'ID_APROVADOR'".
    const proximo = await runQuery(
      `SELECT ISNULL(MAX(ID_APROVADOR), 0) + 1 AS PROXIMO FROM ${FULL_TABLE_NAME}`
    );
    const idAprovador = proximo.recordset[0].PROXIMO;

    await runQuery(
      `INSERT INTO ${FULL_TABLE_NAME} (ID_APROVADOR, CD_MATRICULA, ID_USUARIO, SG_ATIVO, DT_ATUALIZACAO)
       VALUES (@idAprovador, @matricula, @idConcedente, 'S', ${AGORA_BRASILIA})`,
      [
        ["idAprovador", sql.Int, idAprovador],
        ["matricula", sql.NVarChar(30), matricula],
        ["idConcedente", sql.Int, idConcedente],
      ]
    );
    res.status(201).json({ ok: true, ID_APROVADOR: idAprovador, ID_USUARIO: idUsuario, ID_CONCEDENTE: idConcedente });
  } catch (err) {
    console.error("[aprovadores] erro ao inserir:", err.message);
    res.status(500).json({ error: "Erro ao inserir aprovador: " + err.message });
  }
});

// Editar — kzn_aprovador só tem ID_USUARIO e SG_ATIVO (ver DER), e
// SG_ATIVO é o ativar/desativar logo abaixo. Então "editar" aqui é
// APONTAR o registro para outra pessoa: troca o ID_USUARIO, mantendo o
// mesmo vínculo (e o SG_ATIVO atual). Nome, cargo, matrícula e e-mail
// continuam vindo do MDM — nada disso é editável por aqui.
//
// Mesmas validações do POST, pela mesma razão: ID inteiro, usuário
// existente no MDM e sem duplicar um aprovador já cadastrado.
apiRouter.put("/aprovadores/:id", async (req, res) => {
  try {
    // :id é o ID_APROVADOR (a PK). Antes era o ID_USUARIO, o que deixou
    // de servir: ID_USUARIO agora é quem CONCEDE, e o mesmo concedente
    // aparece em vários registros — filtrar por ele atingiria todos eles
    // de uma vez.
    const idAprovador = parseInt(req.params.id, 10);
    const idNovo = parseInt(req.body?.ID_USUARIO, 10);
    if (!Number.isInteger(idAprovador)) return res.status(400).json({ error: "ID_APROVADOR inválido." });
    if (!Number.isInteger(idNovo)) {
      return res.status(400).json({ error: "ID_USUARIO é obrigatório e deve ser um número inteiro." });
    }

    // idNovo é a pessoa escolhida na busca do MDM: o que a tabela guarda
    // dela é a MATRÍCULA (quem RECEBE o direito de aprovar).
    const matricula = await matriculaDoMdm(idNovo, req.body?.CD_MATRICULA);
    if (matricula == null) {
      return res.status(400).json({ error: "Usuário não encontrado no MDM — verifique o ID_USUARIO." });
    }

    // Já existe outro registro para essa matrícula? (o próprio não conta)
    const jaExiste = await runQuery(
      `SELECT TOP (1) 1 AS X FROM ${FULL_TABLE_NAME}
        WHERE ${MATRICULA_IGUAL("CD_MATRICULA", "@matricula")} AND ID_APROVADOR <> @idAprovador`,
      [["matricula", sql.NVarChar(30), matricula], ["idAprovador", sql.Int, idAprovador]]
    );
    if (jaExiste.recordset.length) {
      return res.status(409).json({ error: "Este usuário já está cadastrado como aprovador." });
    }

    // ID_USUARIO = quem CONCEDE = o usuário logado agora. Editar é
    // reconceder o direito, então o concedente passa a ser quem salvou.
    const idConcedente = await idUsuarioLogado(req);
    if (idConcedente == null) {
      return res.status(400).json({
        error: "Não foi possível identificar o usuário logado no MDM para registrar quem concedeu o direito.",
      });
    }

    const alterado = await runQuery(
      `UPDATE ${FULL_TABLE_NAME}
          SET CD_MATRICULA = @matricula, ID_USUARIO = @idConcedente, DT_ATUALIZACAO = ${AGORA_BRASILIA}
        WHERE ID_APROVADOR = @idAprovador`,
      [
        ["matricula", sql.NVarChar(30), matricula],
        ["idConcedente", sql.Int, idConcedente],
        ["idAprovador", sql.Int, idAprovador],
      ]
    );
    if (!alterado.rowsAffected[0]) {
      return res.status(404).json({ error: "Aprovador não encontrado." });
    }
    res.json({ ok: true, ID_APROVADOR: idAprovador, ID_USUARIO: idNovo, ID_CONCEDENTE: idConcedente });
  } catch (err) {
    console.error("[aprovadores] erro ao editar:", err.message);
    res.status(500).json({ error: "Erro ao editar aprovador: " + err.message });
  }
});

// Ativar/desativar — mesmo contrato das abas de cadastro.
apiRouter.put("/aprovadores/:id/status", async (req, res) => {
  try {
    // :id é o ID_APROVADOR (a PK) — ver o comentário no PUT acima.
    const idAprovador = parseInt(req.params.id, 10);
    if (!Number.isInteger(idAprovador)) return res.status(400).json({ error: "ID_APROVADOR inválido." });
    if (typeof req.body?.ativo !== "boolean") {
      return res.status(400).json({ error: "Campo 'ativo' (true/false) é obrigatório." });
    }

    // Ativar/desativar também é gravação: registra quem fez.
    const idConcedente = await idUsuarioLogado(req);
    if (idConcedente == null) {
      return res.status(400).json({
        error: "Não foi possível identificar o usuário logado no MDM para registrar quem concedeu o direito.",
      });
    }

    const result = await runQuery(
      `UPDATE ${FULL_TABLE_NAME}
          SET SG_ATIVO = @sgAtivo, ID_USUARIO = @idConcedente, DT_ATUALIZACAO = ${AGORA_BRASILIA}
        WHERE ID_APROVADOR = @idAprovador`,
      [
        ["sgAtivo", sql.Char(1), req.body.ativo ? "S" : "N"],
        ["idConcedente", sql.Int, idConcedente],
        ["idAprovador", sql.Int, idAprovador],
      ]
    );
    if (!result.rowsAffected[0]) return res.status(404).json({ error: "Aprovador não encontrado." });
    res.json({ ok: true, ativo: req.body.ativo });
  } catch (err) {
    console.error("[aprovadores] erro ao atualizar status:", err.message);
    res.status(500).json({ error: "Erro ao atualizar status do aprovador: " + err.message });
  }
});

// ------------------------------------------------------------------
// API — kzn_mdm_hierarquia (aba "Usuários")
// ------------------------------------------------------------------
// SOMENTE LEITURA, de propósito — e o próprio modal da tela diz que os
// dados são sincronizados do MDM corporativo. Por isso não há POST/PUT
// aqui: criar/editar/inativar usuário exigiria colunas (ou uma tabela
// de vínculo) que esta rota não usa hoje.
// O papel exibido é DERIVADO: quem está em kzn_aprovador aparece como
// "Aprovador"; os demais, como "Operador". É a única fonte de papel
// disponível hoje no modelo.
// CD_EMAIL é o nome real da coluna de e-mail no MDM (não DS_EMAIL —
// ver nota em buscarMdmPorEmail acima); alias AS DS_EMAIL preserva o
// contrato do JSON abaixo.
// Empresas distintas dos terceiros — alimenta o filtro "Empresa" da
// aba Usuários. Mesmo recorte fixo da listagem (ID_TIPO_USUARIO = 2),
// para o combo não oferecer empresa que a lista nunca mostraria.
//
// Registrada ANTES de /usuarios para não ser capturada por uma futura
// rota com parâmetro.
// Valores distintos de uma coluna do MDM, para alimentar os filtros da
// aba Usuários. A coluna vem SEMPRE de uma constante do código (ver as
// duas rotas abaixo), nunca da URL — não há como pedir outra coluna.
//
// Mesmo recorte fixo da listagem (ID_TIPO_USUARIO = 2): o combo não
// oferece opção que a lista nunca mostraria.
async function opcoesDistintasDoMdm(coluna, opcoes = {}) {
  // Por padrão só os TERCEIROS: esta função nasceu para os combos da
  // busca de terceiros do admin, onde listar unidade de gente que não é
  // terceiro só atrapalharia. O filtro da Biblioteca precisa do
  // contrário — todas as unidades da hierarquia —, e pede
  // { todosOsTipos: true }.
  const todosOsTipos = opcoes.todosOsTipos === true;
  // Biblioteca: as unidades dos Kaizens históricos moram em
  // kzn_hist_mdm_vbm_terc — só o MDM atual deixaria de fora unidades
  // (ex.: MANITOBA) que só existem no histórico.
  const fonteMdm = opcoes.incluirHistorico === true
    ? `(SELECT ${coluna}, ID_TIPO_USUARIO FROM ${FULL_MDM_TABLE}
        UNION ALL
        SELECT ${coluna}, ID_TIPO_USUARIO FROM ${FULL_HIST_MDM_TABLE}) mdm`
    : FULL_MDM_TABLE;
  const result = await runQuery(
    `SELECT DISTINCT ${coluna} AS VALOR
     FROM ${fonteMdm}
     WHERE ${todosOsTipos ? "" : "ID_TIPO_USUARIO = @tipo AND "}${coluna} IS NOT NULL AND LTRIM(RTRIM(${coluna})) <> ''
     ORDER BY ${coluna}`,
    todosOsTipos ? [] : [["tipo", sql.Int, ID_TIPO_USUARIO_TERCEIRO]]
  );
  return result.recordset.map((r) => r.VALOR);
}

// Registradas ANTES de /usuarios para não serem capturadas por uma
// futura rota com parâmetro.
apiRouter.get("/usuarios/empresas", async (req, res) => {
  try {
    res.json(await opcoesDistintasDoMdm("NM_EMPRESA"));
  } catch (err) {
    console.error("[usuarios] erro ao listar empresas:", err.message);
    res.status(500).json({ error: "Erro ao consultar empresas: " + err.message });
  }
});

apiRouter.get("/usuarios/unidades", async (req, res) => {
  try {
    res.json(await opcoesDistintasDoMdm("NM_SITE"));
  } catch (err) {
    console.error("[usuarios] erro ao listar unidades:", err.message);
    res.status(500).json({ error: "Erro ao consultar unidades: " + err.message });
  }
});

// Lista os usuários TERCEIROS do MDM (ID_TIPO_USUARIO = 2).
//
// O recorte por tipo é constante do servidor e entra em toda consulta,
// independentemente dos filtros da tela: busca, empresa e unidade só
// estreitam o resultado, nunca ampliam.
//
// ?q=       COMEÇO do nome, e-mail ou matrícula (mínimo 2 caracteres; abaixo
//           disso é ignorado, como o autocomplete da tela espera)
// ?empresa= NM_EMPRESA exata(s), vírgula entre várias
// ?unidade= NM_SITE exata(s), vírgula entre várias
// ?status=  ativo e/ou inativo (ausente = todos)
apiRouter.get("/usuarios", async (req, res) => {
  try {
    const limite = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
    const termo = String(req.query.q || "").trim();
    // Empresa, unidade e status aceitam vários valores separados por
    // vírgula (filtro de múltipla seleção da tela); vazio = todos.
    const empresas = listaTextoOuVaziaGlobal(req.query.empresa);
    const unidades = listaTextoOuVaziaGlobal(req.query.unidade);
    const status = listaTextoOuVaziaGlobal(req.query.status).map((v) => v.toLowerCase());
    const querAtivo = status.includes("ativo");
    const querInativo = status.includes("inativo");

    const filtros = ["m.ID_TIPO_USUARIO = @tipo"];
    // Os dois (ou nenhum) marcados = sem recorte de status.
    // No MDM, SG_ATIVO é 'A' (ativo) / 'I' (inativo) — não 'S'/'N'.
    if (querAtivo && !querInativo) filtros.push("m.SG_ATIVO = 'A'");
    else if (querInativo && !querAtivo) filtros.push("ISNULL(m.SG_ATIVO, 'I') <> 'A'");
    const params = [
      ["limite", sql.Int, limite],
      ["tipo", sql.Int, ID_TIPO_USUARIO_TERCEIRO],
    ];

    // "Começa com" (não "contém"): "carlos" traz quem COMEÇA com Carlos
    // no nome (ou no e-mail/matrícula), não quem tem Carlos no meio.
    if (termo.length >= MDM_BUSCA_MIN) {
      filtros.push(
        "(m.NM_USUARIO LIKE @termo OR m.CD_EMAIL LIKE @termo OR m.CD_MATRICULA LIKE @termo)"
      );
      params.push(["termo", sql.NVarChar(255), termoComecaCom(termo)]);
    }
    filtroEmLista(filtros, params, "m.NM_EMPRESA", "empresa", empresas, sql.NVarChar(30));
    filtroEmLista(filtros, params, "m.NM_SITE", "unidade", unidades, sql.NVarChar(30));

    // A grade mostra 6 colunas, mas a listagem traz o registro inteiro:
    // é o que o modal de edição precisa, e assim abrir a edição não faz
    // requisição nenhuma. São 11 colunas a mais num resultado que já é
    // limitado a 500 linhas.
    const colunas = COLUNAS_MDM_TEXTO.map(([c]) => "m." + c).join(", ");
    // Booleano, não a letra: "Ativo"/"Inativo" é rótulo de tela e
    // acompanha a troca de idioma no front-end.
    const comoItem = (r) => ({ ...r, ATIVO: r.SG_ATIVO === "A" });

    // ?pagina= (0-based) liga a paginação da aba Usuários — mesmo padrão
    // de GET /kaizens. Sem ele a resposta segue sendo a lista (TOP
    // @limite), para quem já consome o contrato antigo.
    if (req.query.pagina !== undefined) {
      const pagina = Math.max(parseInt(req.query.pagina, 10) || 0, 0);
      const tamanho = Math.min(Math.max(parseInt(req.query.tamanho, 10) || 24, 1), 100);
      params.push(["deslocamento", sql.Int, pagina * tamanho], ["tamanho", sql.Int, tamanho]);
      const onde = `FROM ${FULL_MDM_TABLE} m WHERE ${filtros.join(" AND ")}`;
      // ORDER BY termina na chave completa (ID_USUARIO, CD_MATRICULA; o
      // tipo é fixo): homônimos não trocam de página entre uma chamada
      // e outra.
      const [pag, contagem] = await Promise.all([
        runQuery(
          `SELECT m.ID_USUARIO, m.CD_MATRICULA, m.SG_ATIVO, ${colunas} ${onde}
           ORDER BY m.NM_USUARIO, m.ID_USUARIO, m.CD_MATRICULA
           OFFSET @deslocamento ROWS FETCH NEXT @tamanho ROWS ONLY`,
          params
        ),
        runQuery(`SELECT COUNT(*) AS TOTAL ${onde}`, params),
      ]);
      return res.json({
        pagina,
        tamanho,
        total: contagem.recordset[0].TOTAL,
        itens: pag.recordset.map(comoItem),
      });
    }

    const result = await runQuery(
      `SELECT TOP (@limite)
              m.ID_USUARIO, m.CD_MATRICULA, m.SG_ATIVO, ${colunas}
       FROM ${FULL_MDM_TABLE} m
       WHERE ${filtros.join(" AND ")}
       ORDER BY m.NM_USUARIO`,
      params
    );
    res.json(result.recordset.map(comoItem));
  } catch (err) {
    console.error("[usuarios] erro ao listar:", err.message);
    res.status(500).json({ error: "Erro ao consultar usuários: " + err.message });
  }
});

// ── Escrita em kzn_mdm_hierarquia (aba "Usuários") ──
//
// A CHAVE PRIMÁRIA É COMPOSTA: (ID_USUARIO, CD_MATRICULA,
// ID_TIPO_USUARIO) — ver o DER. Duas consequências que valem para as
// três rotas abaixo:
//
//   1. Toda condição de identificação usa as TRÊS colunas. Filtrar só
//      por ID_USUARIO poderia atingir mais de uma linha, já que o mesmo
//      ID pode aparecer com matrículas diferentes.
//   2. ID_USUARIO e CD_MATRICULA não são editáveis: trocá-los é criar
//      outro registro, não editar este. A tela mostra os dois campos
//      travados na edição.
//
// ID_TIPO_USUARIO é constante do servidor (2 = terceiro) e nunca vem do
// cliente: é o mesmo recorte da listagem, e é o que impede esta tela de
// alcançar empregados próprios.
const COLUNAS_MDM_TEXTO = [
  ["NM_USUARIO", 30],
  ["CD_EMAIL", 100],
  ["NM_POSICAO", 30],
  ["NM_EMPRESA", 30],
  ["NM_PAIS", 30],
  ["NM_ESTADO", 30],
  ["NM_CIDADE", 30],
  ["NM_SITE", 30],
];
for (let n = 1; n <= 8; n++) COLUNAS_MDM_TEXTO.push([`NM_HIERARQUIA_N${n}`, 80]);

// Texto vazio vira NULL: a coluna aceita nulo e "" só ocuparia espaço
// fingindo ser um valor. Corta espaços das pontas por higiene.
function textoOuNulo(valor) {
  if (valor == null) return null;
  const limpo = String(valor).trim();
  return limpo === "" ? null : limpo;
}

// Parâmetros das colunas de texto, na ordem de COLUNAS_MDM_TEXTO. O
// tamanho declarado é o do DER: passar mais que isso é erro do banco
// (traduzido por mensagemErroSql), não truncamento silencioso.
function parametrosDeTexto(corpo) {
  return COLUNAS_MDM_TEXTO.map(([coluna, tamanho]) => [
    coluna,
    sql.NVarChar(tamanho),
    textoOuNulo(corpo?.[coluna]),
  ]);
}

function chaveDoUsuario(req) {
  const idUsuario = parseInt(req.params.id, 10);
  const matricula = textoOuNulo(req.body?.CD_MATRICULA ?? req.query?.matricula);
  if (!Number.isInteger(idUsuario)) return { erro: "ID_USUARIO inválido." };
  if (!matricula) return { erro: "CD_MATRICULA é obrigatória: faz parte da chave do registro." };
  return { idUsuario, matricula };
}

const FILTRO_CHAVE_MDM =
  "ID_USUARIO = @id AND CD_MATRICULA = @matricula AND ID_TIPO_USUARIO = @tipo";

// Apoio do formulário: o próximo ID livre e os valores já cadastrados
// em cada campo de texto, para o usuário escolher em vez de digitar.
//
// Uma requisição só, com duas consultas: 14 chamadas separadas de
// DISTINCT (uma por coluna) custariam 14 idas ao banco para montar um
// modal. O UNION devolve tudo de uma vez, já sem repetições.
//
// NM_USUARIO e CD_EMAIL ficam de fora de propósito: são de cada pessoa,
// sugerir o de outra só atrapalharia.
const COLUNAS_COM_SUGESTAO = COLUNAS_MDM_TEXTO
  .map(([c]) => c)
  .filter((c) => c !== "NM_USUARIO" && c !== "CD_EMAIL");

apiRouter.get("/usuarios/formulario", async (req, res) => {
  try {
    const proximo = await runQuery(
      `SELECT ISNULL(MAX(ID_USUARIO), 0) + 1 AS PROXIMO FROM ${FULL_MDM_TABLE}`
    );

    const uniao = COLUNAS_COM_SUGESTAO.map(
      (c) => `SELECT '${c}' AS COLUNA, ${c} AS VALOR FROM ${FULL_MDM_TABLE}
              WHERE ID_TIPO_USUARIO = @tipo AND ${c} IS NOT NULL AND LTRIM(RTRIM(${c})) <> ''`
    ).join(" UNION ");

    const valores = await runQuery(`${uniao} ORDER BY COLUNA, VALOR`, [
      ["tipo", sql.Int, ID_TIPO_USUARIO_TERCEIRO],
    ]);

    const opcoes = {};
    COLUNAS_COM_SUGESTAO.forEach((c) => { opcoes[c] = []; });
    valores.recordset.forEach((r) => { opcoes[r.COLUNA].push(r.VALOR); });

    res.json({ proximoId: proximo.recordset[0].PROXIMO, opcoes });
  } catch (err) {
    console.error("[usuarios] erro ao montar formulário:", err.message);
    res.status(500).json({ error: "Erro ao consultar opções: " + err.message });
  }
});

apiRouter.post("/usuarios", async (req, res) => {
  try {
    const idUsuario = parseInt(req.body?.ID_USUARIO, 10);
    const matricula = textoOuNulo(req.body?.CD_MATRICULA);
    const nome = textoOuNulo(req.body?.NM_USUARIO);
    if (!Number.isInteger(idUsuario)) {
      return res.status(400).json({ error: "ID_USUARIO é obrigatório e deve ser um número inteiro." });
    }
    if (!matricula) return res.status(400).json({ error: "CD_MATRICULA é obrigatória." });
    if (!nome) return res.status(400).json({ error: "NM_USUARIO é obrigatório." });

    // ID novo tem de ser maior que todos os já existentes. A tela já
    // sugere o próximo (ver GET /usuarios/formulario), mas a regra vive
    // aqui: o campo é editável e a sugestão pode envelhecer entre abrir
    // o modal e salvar.
    const maior = await runQuery(
      `SELECT ISNULL(MAX(ID_USUARIO), 0) AS MAIOR FROM ${FULL_MDM_TABLE}`
    );
    const maiorAtual = maior.recordset[0].MAIOR;
    if (idUsuario <= maiorAtual) {
      return res.status(400).json({
        error: `O ID do usuário deve ser maior que ${maiorAtual}, o maior já cadastrado. Sugerido: ${maiorAtual + 1}.`,
      });
    }

    const chave = [
      ["id", sql.Int, idUsuario],
      ["matricula", sql.NVarChar(30), matricula],
      ["tipo", sql.Int, ID_TIPO_USUARIO_TERCEIRO],
    ];

    const jaExiste = await runQuery(
      `SELECT TOP (1) 1 AS X FROM ${FULL_MDM_TABLE} WHERE ${FILTRO_CHAVE_MDM}`,
      chave
    );
    if (jaExiste.recordset.length) {
      return res.status(409).json({ error: "Já existe um usuário com este ID e matrícula." });
    }

    const colunas = COLUNAS_MDM_TEXTO.map(([c]) => c);
    await runQuery(
      `INSERT INTO ${FULL_MDM_TABLE}
         (ID_USUARIO, CD_MATRICULA, ID_TIPO_USUARIO, SG_ATIVO, ${colunas.join(", ")}, DT_ATUALIZACAO)
       VALUES
         (@id, @matricula, @tipo, @sgAtivo, ${colunas.map((c) => "@" + c).join(", ")}, ${AGORA_BRASILIA})`,
      [
        ...chave,
        ["sgAtivo", sql.Char(1), req.body?.ATIVO === false ? "I" : "A"], // MDM: A/I
        ...parametrosDeTexto(req.body),
      ]
    );
    res.status(201).json({ ok: true, ID_USUARIO: idUsuario, CD_MATRICULA: matricula });
  } catch (err) {
    console.error("[usuarios] erro ao inserir:", err.message);
    res.status(500).json({ error: mensagemErroSql(err, "usuário", "tipo de usuário") });
  }
});

// Editar — muda só os campos descritivos. A chave identifica a linha e
// não é alterada (ver nota acima).
apiRouter.put("/usuarios/:id", async (req, res) => {
  try {
    const { idUsuario, matricula, erro } = chaveDoUsuario(req);
    if (erro) return res.status(400).json({ error: erro });

    const nome = textoOuNulo(req.body?.NM_USUARIO);
    if (!nome) return res.status(400).json({ error: "NM_USUARIO é obrigatório." });

    const atribuicoes = COLUNAS_MDM_TEXTO.map(([c]) => `${c} = @${c}`).join(", ");
    const alterado = await runQuery(
      `UPDATE ${FULL_MDM_TABLE}
          SET ${atribuicoes}, DT_ATUALIZACAO = ${AGORA_BRASILIA}
        WHERE ${FILTRO_CHAVE_MDM}`,
      [
        ["id", sql.Int, idUsuario],
        ["matricula", sql.NVarChar(30), matricula],
        ["tipo", sql.Int, ID_TIPO_USUARIO_TERCEIRO],
        ...parametrosDeTexto(req.body),
      ]
    );
    if (!alterado.rowsAffected[0]) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({ ok: true, ID_USUARIO: idUsuario, CD_MATRICULA: matricula });
  } catch (err) {
    console.error("[usuarios] erro ao editar:", err.message);
    res.status(500).json({ error: mensagemErroSql(err, "usuário", "tipo de usuário") });
  }
});

// Ativar/desativar — grava SG_ATIVO. Mesmo contrato das outras abas: o
// registro nunca é excluído, só deixa de contar como ativo.
apiRouter.put("/usuarios/:id/status", async (req, res) => {
  try {
    const { idUsuario, matricula, erro } = chaveDoUsuario(req);
    if (erro) return res.status(400).json({ error: erro });
    if (typeof req.body?.ativo !== "boolean") {
      return res.status(400).json({ error: "Campo 'ativo' (true/false) é obrigatório." });
    }

    const alterado = await runQuery(
      `UPDATE ${FULL_MDM_TABLE} SET SG_ATIVO = @sgAtivo, DT_ATUALIZACAO = ${AGORA_BRASILIA}
        WHERE ${FILTRO_CHAVE_MDM}`,
      [
        ["sgAtivo", sql.Char(1), req.body.ativo ? "A" : "I"], // MDM: A/I
        ["id", sql.Int, idUsuario],
        ["matricula", sql.NVarChar(30), matricula],
        ["tipo", sql.Int, ID_TIPO_USUARIO_TERCEIRO],
      ]
    );
    if (!alterado.rowsAffected[0]) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({ ok: true, ativo: req.body.ativo });
  } catch (err) {
    console.error("[usuarios] erro ao atualizar status:", err.message);
    res.status(500).json({ error: "Erro ao atualizar status do usuário: " + err.message });
  }
});

// ------------------------------------------------------------------
// API — cadastros bilíngues (kzn_categoria, kzn_replicacao,
// kzn_desperdicio, kzn_resultados)
// ------------------------------------------------------------------
// Estas 4 tabelas têm exatamente o mesmo desenho no DER
// (database/DER_VBM_Kaizen_CI.html): PK própria + ID_IDIOMA, URL_ICONE,
// NM_*, DS_*, SG_ATIVO, DT_ATUALIZACAO — 1 LINHA POR IDIOMA para o
// mesmo registro (mesmo ID, ID_IDIOMA diferente). Por isso todas
// compartilham as mesmas rotas/regras, geradas por
// registrarCadastroBilingue() abaixo: listar, buscar por id (2
// idiomas), criar, editar e ativar/desativar.
//
// TAMANHOS: vêm do DER (database/DER_VBM_Kaizen_CI.html). Antes
// deste ajuste o DER mostrava NM VARCHAR(20)/DS VARCHAR(40) e só a
// tabela de Categoria estava marcada como "exceção" (colunas já
// ampliadas para 30/100 no banco). A versão atual do DER mostra que
// as 4 tabelas (categoria, replicacao, desperdicio, resultados) têm
// exatamente as MESMAS colunas VARCHAR(30)/VARCHAR(100) — não há mais
// exceção nenhuma, as 4 sempre tiveram o mesmo tamanho.
const CADASTRO_LIMITES_DER = { nome: 30, descricao: 100 };
// URL_ICONE VARCHAR(200) — igual nas 4 tabelas que têm a coluna (DER).
const ICONE_MAX = 200;

function tabelaCadastro(envVar, padrao) {
  return `[${DB_SCHEMA}].[${safeIdentifier(process.env[envVar], padrao)}]`;
}

/**
 * Registra as 5 rotas REST de um cadastro bilíngue.
 *
 * cfg:
 *   rota          — segmento da URL (ex.: "categorias")
 *   tabela        — nome completo já escapado ([schema].[tabela])
 *   pk            — coluna de chave primária (ex.: "ID_CATEGORIA")
 *   colNome       — coluna de nome (ex.: "NM_CATEGORIA")
 *   colDescricao  — coluna de descrição (ex.: "DS_CATEGORIA"). OPCIONAL:
 *                   omitir quando a tabela não tem coluna de descrição
 *                   (ex.: kzn_tipo_resultado, que só tem NM_*) — nesse
 *                   caso a rota nunca lê/grava DS e a validação exige
 *                   só o nome.
 *   maxNome       — limite de caracteres do nome (do DER)
 *   maxDescricao  — limite de caracteres da descrição (do DER).
 *                   Ignorado quando colDescricao não é passado.
 *   temIcone      — false quando a tabela não tem URL_ICONE (ex.:
 *                   kzn_tipo_resultado). Padrão true (as 4 tabelas
 *                   originais sempre tiveram essa coluna).
 *   rotuloSing    — rótulo em mensagens de erro (ex.: "categoria")
 *   colunasExtras — colunas adicionais a preservar no INSERT do MERGE,
 *                   herdadas da linha do outro idioma (ex.: a FK
 *                   ID_TIPO_RESULTADO de kzn_resultados). Opcional.
 *   contagem      — { tabela, coluna } para o badge "N kaizens".
 *                   Opcional: sem isso, QTD_KAIZENS vem null.
 *   capturarUsuarioResponsavel — true grava, de forma automática e
 *                   transparente (a interface nunca expõe nem permite
 *                   editar isso), o ID_USUARIO (kzn_mdm_hierarquia) de
 *                   quem gravou o registro por último — resolvido no
 *                   servidor via idUsuarioLogado(req), nunca enviado
 *                   pelo cliente. 1 coluna só (sem distinguir criação de
 *                   edição — mesmo desenho de DT_ATUALIZACAO, que já é
 *                   "a última gravação", não "a criação"). Padrão false
 *                   (as 5 tabelas originais não têm essa coluna).
 *                   Usuário não identificado (fora do Databricks Apps,
 *                   e-mail sem correspondência no MDM) grava NULL —
 *                   nunca bloqueia o salvamento.
 *   colUsuario    — nome da coluna, só usado quando
 *                   capturarUsuarioResponsavel é true. Padrão "ID_USUARIO".
 *   campoExtraEditavel — { col, campo } para 1 FK escolhida pelo usuário
 *                   num <select> do formulário (ex.: ID_TIPO_RESULTADO
 *                   em kzn_resultados, escolhido pelo nome na aba "Tipo
 *                   Resultados", gravado como ID). Diferente de
 *                   colunasExtras (que só HERDA o valor da linha do
 *                   outro idioma): aqui o valor vem do corpo da
 *                   requisição (campo `campo`, nível raiz — não dentro
 *                   de pt/en, é o mesmo nos 2 idiomas) e é gravado
 *                   direto, tanto ao criar quanto ao editar. Por padrão
 *                   aceita null (não bloqueia o salvamento sem valor
 *                   escolhido) — passe `obrigatorio: true` dentro do
 *                   objeto quando a coluna real for NOT NULL (ex.:
 *                   ID_TIPO_RESULTADO em kzn_resultados — "Cannot
 *                   insert the value NULL..." se salvar sem escolher).
 *                   `rotulo` (opcional): nome amigável usado na
 *                   mensagem de erro de "obrigatório" — sem ele, usa
 *                   o próprio nome da coluna (col).
 */

// Traduz o erro cru do SQL Server pra algo que o usuário entenda. Erros
// SEM tradução conhecida (retorno null) continuam aparecendo crus, como
// sempre — nunca escondidos. Hoje só cobre violação de UNIQUE KEY (nome
// duplicado no mesmo idioma) — o caso real observado em produção
// ("Violation of UNIQUE KEY constraint 'UQ_KZN_RESULTADOS_NM'...").
// Compartilhada por todas as 6 tabelas bilíngues: qualquer uma delas
// pode ter a mesma constraint de nome único.
function mensagemErroSql(err, rotuloSing, rotuloExtra) {
  const numero = err && err.number;
  const texto = (err && err.message) || "";
  if (numero === 2627 || numero === 2601 || /violation of unique key constraint|cannot insert duplicate key/i.test(texto)) {
    return `Já existe um(a) ${rotuloSing} cadastrado(a) com esse nome neste idioma.`;
  }
  // A FK dessas tabelas é COMPOSTA (id + ID_IDIOMA), porque a tabela
  // referenciada tem PK composta. Então a linha em INGLÊS do registro só
  // grava se o item escolhido também tiver a linha em inglês: item
  // cadastrado só em português derruba exatamente essa metade do save
  // (FK_KZN_RESULTADOS_TIPO, observado em produção).
  if (numero === 547 || /conflicted with the foreign key constraint/i.test(texto)) {
    return `O ${rotuloExtra || "item vinculado"} selecionado não está cadastrado nos dois idiomas (Português e Inglês). Cadastre a tradução dele antes de usá-lo aqui.`;
  }
  return null; // sem tradução conhecida: quem chamou usa a mensagem crua do err
}

/* Cache em memória das listas de CADASTRO (categorias, status,
   replicações, desperdícios, resultados, tipos de resultado).
   São listas pequenas, mudam raramente e eram reconsultadas a cada
   abertura de tela e a cada troca de idioma — só o Novo Kaizen abria
   com 6 consultas dessas. A chave inclui o idioma porque a lista vem
   traduzida. Qualquer gravação na própria rota limpa a entrada, então
   o cadastro continua refletindo na tela na hora: o TTL é rede de
   segurança para alteração feita FORA do app (direto no banco).
   Mesma ideia do limiteColunaCache mais abaixo. */
/* O cache é SÓ do servidor. Uma versão anterior também mandava
   "Cache-Control: private, max-age=300" para o navegador, e isso
   quebrava a Administração: depois de cadastrar, a tela relê a lista na
   hora, mas o NAVEGADOR respondia com a cópia dele — sem nem perguntar
   ao servidor — e o registro recém-criado só aparecia cinco minutos
   depois. O cache do servidor é o que valia a pena (evita a ida ao
   Azure SQL) e é invalidado na gravação; o do navegador economizava
   pouco e escondia a gravação de quem acabou de fazê-la.
   As respostas seguem com o "no-store" que o gate da API já aplica. */
const CADASTRO_TTL_MS = 5 * 60 * 1000;
const cadastroCache = new Map();

// `variante` entra na CHAVE do cache. Sem ela, /resultados?tipo=1 e
// ?tipo=2 dividiriam a mesma entrada e o segundo combo receberia a
// lista do primeiro — um bug que só apareceria depois do primeiro
// acesso, dentro da janela do TTL, e sumiria sozinho ao expirar.
function cadastroCacheLer(rota, idIdioma, variante) {
  const item = cadastroCache.get(`${rota}|${idIdioma}|${variante || ""}`);
  if (!item || item.expiraEm < Date.now()) return null;
  return item.dados;
}
function cadastroCacheGravar(rota, idIdioma, variante, dados) {
  cadastroCache.set(`${rota}|${idIdioma}|${variante || ""}`, { dados, expiraEm: Date.now() + CADASTRO_TTL_MS });
}
function cadastroCacheLimpar(rota) {
  for (const chave of cadastroCache.keys()) {
    if (chave.startsWith(`${rota}|`)) cadastroCache.delete(chave);
  }
}

function registrarCadastroBilingue(cfg) {
  const { rota, tabela, pk, colNome, colDescricao, maxNome, maxDescricao, rotuloSing } = cfg;
  const extras = cfg.colunasExtras || [];
  const temIcone = cfg.temIcone !== false;
  const capturarUsuario = !!cfg.capturarUsuarioResponsavel;
  const extraEditavel = cfg.campoExtraEditavel || null;
  const filtroNumerico = cfg.filtroNumerico || null;
  const colUsuario = cfg.colUsuario || "ID_USUARIO";
  const log = `[${rota}]`;

  // Validação única, compartilhada por POST (criar) e PUT (editar) —
  // garante que os dois processos apliquem exatamente a mesma regra.
  function validarCampos(nomePt, descPt, nomeEn, descEn) {
    if (!nomePt || !nomeEn || (colDescricao && (!descPt || !descEn))) {
      return colDescricao
        ? "Nome e descrição são obrigatórios nos dois idiomas."
        : "Nome é obrigatório nos dois idiomas.";
    }
    if (nomePt.length > maxNome || nomeEn.length > maxNome) {
      return `O nome deve ter no máximo ${maxNome} caracteres (em cada idioma).`;
    }
    if (colDescricao && (descPt.length > maxDescricao || descEn.length > maxDescricao)) {
      return `A descrição deve ter no máximo ${maxDescricao} caracteres (em cada idioma).`;
    }
    return null;
  }

  // Mesma regra nos dois processos (criar/editar): valor não numérico
  // é erro de formato; ausente só é erro se a coluna real for NOT NULL
  // (extraEditavel.obrigatorio) — sem isso, o INSERT falha só lá no
  // banco com "Cannot insert the value NULL...", uma mensagem que não
  // diz ao usuário qual campo faltou.
  // Caminho do ícone aceito para gravação: caminho relativo/absoluto do
  // próprio app (assets/icons/x.svg, /icones/x.svg) ou URL http(s), sempre
  // terminando em extensão de imagem. Recusa "..", aspas e sinais de tag —
  // o valor volta para a tela dentro de <img src>, então nada de conteúdo
  // que possa escapar do atributo. Só vale para o que é GRAVADO agora; a
  // leitura de registros antigos continua aceitando o que já está no banco.
  const ICONE_FORMATO = /^(https?:\/\/[^\s"'<>]+|\/?[A-Za-z0-9._\-/]+)\.(svg|png|jpg|jpeg|webp|gif)$/i;

  function validarIcone(urlIcone) {
    if (urlIcone === undefined) return null; // não veio: não mexe na coluna
    if (urlIcone.length > ICONE_MAX) return `O caminho do ícone deve ter no máximo ${ICONE_MAX} caracteres.`;
    if (urlIcone.includes("..") || !ICONE_FORMATO.test(urlIcone)) return "Caminho de ícone inválido.";
    return null;
  }

  function validarExtra(extra) {
    if (!extraEditavel) return null;
    if (extra != null && Number.isNaN(extra)) return `${extraEditavel.col} inválido.`;
    if (extraEditavel.obrigatorio && extra == null) {
      return `${extraEditavel.rotulo || extraEditavel.col} é obrigatório.`;
    }
    return null;
  }

  function lerCorpo(req) {
    const pt = req.body?.pt || {};
    const en = req.body?.en || {};
    const corpo = {
      nomePt: (pt.NM || "").trim(),
      descPt: (pt.DS || "").trim(),
      nomeEn: (en.NM || "").trim(),
      descEn: (en.DS || "").trim(),
    };
    if (extraEditavel) {
      const bruto = req.body?.[extraEditavel.campo];
      corpo.extra = bruto === "" || bruto == null ? null : parseInt(bruto, 10);
    }
    // URL_ICONE: só existe quando a tela tem seletor de ícone. Ausente ou
    // vazio vira undefined — e undefined significa "não mexe na coluna",
    // nunca "apaga o ícone" (ver upsertIdioma).
    if (temIcone) {
      const bruto = req.body?.urlIcone;
      corpo.urlIcone = typeof bruto === "string" && bruto.trim() ? bruto.trim() : undefined;
    }
    return corpo;
  }

  // Upsert de 1 linha (1 idioma) — MERGE: atualiza se a linha
  // (pk + ID_IDIOMA) já existe, cria se não existe. Usada tanto pelo
  // POST (id novo → sempre INSERT) quanto pelo PUT (UPDATE pra quem já
  // existe, INSERT só pro idioma que faltava). Mesma função, mesma
  // regra, nos dois processos.
  // WHEN NOT MATCHED: URL_ICONE (e demais colunasExtras) herdam o valor
  // da linha do OUTRO idioma que já existir — mesmo registro, mesmo
  // ícone/FK nos dois idiomas; ficam NULL na criação, quando nenhuma
  // linha existe ainda. Tabela sem URL_ICONE (temIcone:false): a coluna
  // simplesmente não entra no MERGE, senão o SQL Server rejeitaria a
  // query inteira com "Invalid column name".
  const colsHerdadas = (temIcone ? ["URL_ICONE"] : []).concat(extras);
  const selectHerdado = (col) => `(SELECT TOP (1) ${col} FROM ${tabela} WHERE ${pk} = @id)`;

  function upsertIdioma(id, idIdioma, nome, descricao, idUsuario, extraValor, urlIcone) {
    // URL_ICONE tem 2 caminhos, e só um vale por chamada:
    //   corpo TROUXE o ícone -> grava o valor recebido (no INSERT e no
    //     UPDATE), que é a aba com seletor de ícone (Categorias);
    //   corpo NÃO trouxe -> comportamento de sempre: herda da linha do
    //     outro idioma no INSERT e o UPDATE não toca na coluna. É o que
    //     preserva o ícone dos registros já existentes e mantém as abas
    //     sem seletor exatamente como eram.
    const gravaIcone = temIcone && urlIcone != null;
    const herdadas = gravaIcone ? extras : colsHerdadas;
    const colsInsert = [pk, "ID_IDIOMA"].concat(gravaIcone ? ["URL_ICONE"] : [], herdadas, [colNome], colDescricao ? [colDescricao] : [], ["SG_ATIVO", "DT_ATUALIZACAO"])
      .concat(capturarUsuario ? [colUsuario] : [])
      .concat(extraEditavel ? [extraEditavel.col] : []);
    const valsInsert = ["@id", "@idIdioma"].concat(gravaIcone ? ["@urlIcone"] : [], herdadas.map(selectHerdado), ["@nome"], colDescricao ? ["@descricao"] : [], ["'S'", AGORA_BRASILIA])
      // Sempre quem está salvando agora — criar ou editar, sem distinguir
      // (mesmo desenho de DT_ATUALIZACAO, ao lado).
      .concat(capturarUsuario ? ["@idUsuario"] : [])
      // Diferente de colsHerdadas: não herda da linha do outro idioma,
      // é sempre o que veio no corpo desta requisição (mesmo valor nos
      // 2 idiomas, porque os 2 upserts do mesmo POST/PUT usam o mesmo
      // extraValor).
      .concat(extraEditavel ? ["@extra"] : []);
    const setUpdate = `${colNome} = @nome` + (colDescricao ? `, ${colDescricao} = @descricao` : "") + `, DT_ATUALIZACAO = ${AGORA_BRASILIA}`
      + (gravaIcone ? `, URL_ICONE = @urlIcone` : "")
      + (capturarUsuario ? `, ${colUsuario} = @idUsuario` : "")
      + (extraEditavel ? `, ${extraEditavel.col} = @extra` : "");

    const params = [
      ["nome", sql.NVarChar(maxNome), nome],
      ["id", sql.Int, id],
      ["idIdioma", sql.Int, idIdioma],
    ];
    if (colDescricao) params.push(["descricao", sql.NVarChar(maxDescricao), descricao]);
    // Usuário não identificado (fora do Databricks Apps, e-mail sem
    // correspondência no MDM): grava NULL, nunca bloqueia o salvamento.
    if (capturarUsuario) params.push(["idUsuario", sql.Int, idUsuario ?? null]);
    // Sem seleção no combo: grava NULL, nunca bloqueia o salvamento.
    if (extraEditavel) params.push(["extra", sql.Int, extraValor ?? null]);
    // VARCHAR(200) no DER (database/DER_VBM_Kaizen_CI.html).
    if (gravaIcone) params.push(["urlIcone", sql.NVarChar(ICONE_MAX), urlIcone]);

    return runQuery(
      `MERGE INTO ${tabela} AS target
       USING (SELECT @id AS ${pk}, @idIdioma AS ID_IDIOMA) AS src
         ON target.${pk} = src.${pk} AND target.ID_IDIOMA = src.ID_IDIOMA
       WHEN MATCHED THEN
         UPDATE SET ${setUpdate}
       WHEN NOT MATCHED THEN
         INSERT (${colsInsert.join(", ")})
         VALUES (${valsInsert.join(", ")});`,
      params
    );
  }

  // Listar — um registro por linha, no idioma pedido em ?idioma=
  // (pt-BR/en). Antes o ID_IDIOMA era fixo em PT, então a tela em
  // inglês continuava mostrando os nomes/descrições em português.
  //
  // A linha PT é a BASE (todo registro tem a dela; a tradução pode
  // nunca ter sido cadastrada). O idioma pedido entra por LEFT JOIN e
  // o COALESCE cai para o texto PT quando falta a tradução — assim
  // trocar para inglês nunca faz um registro sumir da lista.
  //
  // NM_PT vai junto de propósito: a contagem do badge casa por NOME na
  // tabela de pendências, que guarda o nome em português. Sem essa
  // coluna, listar em inglês zeraria todos os badges.
  apiRouter.get(`/${rota}`, async (req, res) => {
    try {
      const idIdiomaPedido = idIdiomaDaRequisicao(req);
      // Recorte opcional por uma coluna própria da tabela, declarado
      // pela rota (cfg.filtroNumerico). Hoje só /resultados usa: os dois
      // combos da etapa "Resultados & Aprendizados" pedem a MESMA
      // tabela, separados por ID_TIPO_RESULTADO. O valor chega como
      // parâmetro tipado — o nome da coluna vem do código, nunca da URL.
      let filtroExtra = "";
      const paramsFiltro = [];
      let variante = "";
      if (filtroNumerico) {
        const bruto = req.query[filtroNumerico.query];
        if (bruto != null && String(bruto).trim() !== "") {
          const n = parseInt(bruto, 10);
          if (!Number.isInteger(n)) {
            return res.status(400).json({ error: `${filtroNumerico.query} inválido.` });
          }
          filtroExtra = ` AND base.${filtroNumerico.col} = @filtroExtra`;
          paramsFiltro.push(["filtroExtra", sql.Int, n]);
          variante = `${filtroNumerico.query}=${n}`;
        }
      }
      const emCache = cadastroCacheLer(rota, idIdiomaPedido, variante);
      if (emCache) return res.json(emCache);
      const colsSelect = [`base.${pk} AS ID`, `COALESCE(tr.${colNome}, base.${colNome}) AS NM`];
      if (colDescricao) colsSelect.push(`COALESCE(tr.${colDescricao}, base.${colDescricao}) AS DS`);
      colsSelect.push(`base.${colNome} AS NM_PT`);
      if (temIcone) colsSelect.push(`base.URL_ICONE`);
      colsSelect.push(
        `base.SG_ATIVO`,
        `CASE WHEN @idIdioma <> @idIdiomaBase AND tr.ID_IDIOMA IS NULL THEN 1 ELSE 0 END AS SEM_TRADUCAO`
      );
      const result = await runQuery(
        // TOP explícito: são tabelas de cadastro, hoje com dezenas de
        // linhas, e a tela é um <select>. O teto existe para que um
        // crescimento inesperado não vire uma lista sem fim na resposta.
        `SELECT TOP (1000) ${colsSelect.join(", ")}
         FROM ${tabela} base
         LEFT JOIN ${tabela} tr
                ON tr.${pk} = base.${pk} AND tr.ID_IDIOMA = @idIdioma
         WHERE base.ID_IDIOMA = @idIdiomaBase${filtroExtra}
         ORDER BY COALESCE(tr.${colNome}, base.${colNome})`,
        [
          ["idIdioma", sql.Int, idIdiomaPedido],
          ["idIdiomaBase", sql.Int, ID_IDIOMA_PT],
        ].concat(paramsFiltro)
      );

      // Contagem opcional (badge "N kaizens"), numa ÚNICA consulta
      // agrupada — não uma por registro. Se a tabela/coluna não existir
      // de verdade, falha sozinha sem derrubar a lista: todo mundo fica
      // com QTD_KAIZENS null e só loga o motivo.
      let contagemPorNome = {};
      if (cfg.contagem) {
        try {
          const contagem = await runQuery(
            `SELECT ${cfg.contagem.coluna} AS CHAVE, COUNT(*) AS QTD
             FROM ${cfg.contagem.tabela} GROUP BY ${cfg.contagem.coluna}`
          );
          contagem.recordset.forEach((r) => { contagemPorNome[r.CHAVE] = r.QTD; });
        } catch (err) {
          console.warn(`${log} contagem indisponível (${cfg.contagem.tabela}): ${err.message}`);
        }
      }

      const corpo = result.recordset.map((r) => ({
          ID: r.ID,
          NM: r.NM,
          DS: colDescricao ? r.DS : null,
          URL_ICONE: temIcone ? r.URL_ICONE : null,
          ATIVO: ehAtivo(r.SG_ATIVO),
          // casa pelo nome em PT: a tabela de pendências guarda o nome
          // em português, independentemente do idioma da tela.
          QTD: contagemPorNome[r.NM_PT] != null ? contagemPorNome[r.NM_PT] : null,
          // true = pediu um idioma diferente de PT e este registro não
          // tem aquela tradução cadastrada (o NM/DS acima vêm do PT por
          // causa do COALESCE). O front-end usa isso para sinalizar o
          // card, em vez de deixar parecer, em silêncio, que o texto em
          // português É a tradução.
          SEM_TRADUCAO: r.SEM_TRADUCAO === 1,
      }));
      cadastroCacheGravar(rota, idIdiomaPedido, variante, corpo);
      res.json(corpo);
    } catch (err) {
      console.error(`${log} erro ao consultar:`, err.message);
      res.status(500).json({ error: `Erro ao consultar ${rotuloSing}: ` + err.message });
    }
  });

  // Buscar 1 registro por ID — as duas linhas (PT e EN) do mesmo ID,
  // usadas para popular o formulário de edição bilíngue.
  apiRouter.get(`/${rota}/:id`, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: `${pk} inválido.` });

      const colsSelectId = ["ID_IDIOMA", `${colNome} AS NM`];
      if (colDescricao) colsSelectId.push(`${colDescricao} AS DS`);
      if (extraEditavel) colsSelectId.push(`${extraEditavel.col} AS EXTRA`);
      if (temIcone) colsSelectId.push("URL_ICONE");
      const result = await runQuery(
        `SELECT ${colsSelectId.join(", ")} FROM ${tabela} WHERE ${pk} = @id`,
        [["id", sql.Int, id]]
      );

      const pt = result.recordset.find((r) => r.ID_IDIOMA === ID_IDIOMA_PT);
      const en = result.recordset.find((r) => r.ID_IDIOMA === ID_IDIOMA_EN);
      if (!pt && !en) return res.status(404).json({ error: `Registro de ${rotuloSing} não encontrado.` });

      res.json({
        ID: id,
        pt: pt ? { NM: pt.NM, DS: colDescricao ? pt.DS : "" } : null,
        en: en ? { NM: en.NM, DS: colDescricao ? en.DS : "" } : null,
        // Mesmo valor nos 2 idiomas (não é um dado bilíngue) — pega de
        // qualquer linha que exista.
        ...(extraEditavel ? { [extraEditavel.campo]: (pt && pt.EXTRA) ?? (en && en.EXTRA) ?? null } : {}),
        // Idem: o ícone é do registro, não do idioma. A tela de edição usa
        // este valor para já abrir com o ícone que está gravado.
        ...(temIcone ? { urlIcone: (pt && pt.URL_ICONE) ?? (en && en.URL_ICONE) ?? null } : {}),
      });
    } catch (err) {
      console.error(`${log} erro ao consultar por ID:`, err.message);
      res.status(500).json({ error: `Erro ao consultar ${rotuloSing}: ` + err.message });
    }
  });

  // Editar — grava as duas linhas (PT e EN) do mesmo ID. O registro
  // pode ter só a linha PT cadastrada (a EN nunca criada): por isso
  // upsert, não UPDATE puro — senão digitar a tradução pela 1ª vez não
  // gravaria nada (0 linhas afetadas, sem erro). Só mexe em registro
  // que já existe: sem NENHUMA linha com esse ID, devolve 404 —
  // criar do zero é só pelo POST.
  apiRouter.put(`/${rota}/:id`, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: `${pk} inválido.` });

      const { nomePt, descPt, nomeEn, descEn, extra, urlIcone } = lerCorpo(req);
      const erro = validarCampos(nomePt, descPt, nomeEn, descEn);
      if (erro) return res.status(400).json({ error: erro });
      const erroExtra = validarExtra(extra);
      if (erroExtra) return res.status(400).json({ error: erroExtra });
      const erroIcone = validarIcone(urlIcone);
      if (erroIcone) return res.status(400).json({ error: erroIcone });

      const existe = await runQuery(
        `SELECT TOP (1) 1 AS X FROM ${tabela} WHERE ${pk} = @id`,
        [["id", sql.Int, id]]
      );
      if (!existe.recordset.length) {
        return res.status(404).json({ error: `Registro de ${rotuloSing} não encontrado.` });
      }

      // Resolvido uma vez (não por idioma) e nunca a partir do corpo da
      // requisição — a interface não tem (nem pode ter) campo para isso.
      const idUsuario = capturarUsuario ? await idUsuarioLogado(req) : null;

      await Promise.all([
        upsertIdioma(id, ID_IDIOMA_PT, nomePt, descPt, idUsuario, extra, urlIcone),
        upsertIdioma(id, ID_IDIOMA_EN, nomeEn, descEn, idUsuario, extra, urlIcone),
      ]);
      // Cache limpo DEPOIS da gravação — ver o comentário no POST.
      cadastroCacheLimpar(rota);
      res.json({ ok: true });
    } catch (err) {
      console.error(`${log} erro ao atualizar:`, err.message);
      const amigavel = mensagemErroSql(err, rotuloSing, extraEditavel && (extraEditavel.rotulo || extraEditavel.col));
      res.status(amigavel ? 409 : 500).json({ error: amigavel || `Erro ao atualizar ${rotuloSing}: ` + err.message });
    }
  });

  // Criar — MESMA validação e MESMO upsert do editar; a única
  // diferença é que o ID é novo (próximo disponível), então as 2
  // chamadas caem sempre no ramo INSERT do MERGE.
  // Sem transação explícita: numa falha a meio caminho (EN falha
  // depois do PT gravado), o registro fica só com a linha PT — mesma
  // situação que o upsert do editar já resolve numa edição seguinte.
  apiRouter.post(`/${rota}`, async (req, res) => {
    try {
      const { nomePt, descPt, nomeEn, descEn, extra, urlIcone } = lerCorpo(req);
      const erro = validarCampos(nomePt, descPt, nomeEn, descEn);
      if (erro) return res.status(400).json({ error: erro });
      const erroExtra = validarExtra(extra);
      if (erroExtra) return res.status(400).json({ error: erroExtra });
      const erroIcone = validarIcone(urlIcone);
      if (erroIcone) return res.status(400).json({ error: erroIcone });

      const proximo = await runQuery(`SELECT ISNULL(MAX(${pk}), 0) + 1 AS PROXIMO FROM ${tabela}`);
      const id = proximo.recordset[0].PROXIMO;

      const idUsuario = capturarUsuario ? await idUsuarioLogado(req) : null;

      await Promise.all([
        upsertIdioma(id, ID_IDIOMA_PT, nomePt, descPt, idUsuario, extra, urlIcone),
        upsertIdioma(id, ID_IDIOMA_EN, nomeEn, descEn, idUsuario, extra, urlIcone),
      ]);
      // Limpa o cache DEPOIS da gravação, não antes: limpando antes,
      // uma leitura que chegasse no meio do caminho repovoaria o cache
      // com a lista ANTIGA e a novidade ficaria escondida até o TTL.
      cadastroCacheLimpar(rota);
      res.status(201).json({ ok: true, ID: id });
    } catch (err) {
      console.error(`${log} erro ao criar:`, err.message);
      const amigavel = mensagemErroSql(err, rotuloSing, extraEditavel && (extraEditavel.rotulo || extraEditavel.col));
      res.status(amigavel ? 409 : 500).json({ error: amigavel || `Erro ao criar ${rotuloSing}: ` + err.message });
    }
  });

  // Ativar/desativar — grava SG_ATIVO ('S'/'N') nas linhas de TODOS os
  // idiomas desse ID (o status é do registro, não de uma tradução).
  apiRouter.put(`/${rota}/:id/status`, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: `${pk} inválido.` });
      if (typeof req.body?.ativo !== "boolean") {
        return res.status(400).json({ error: "Campo 'ativo' (true/false) é obrigatório." });
      }

      const result = await runQuery(
        `UPDATE ${tabela} SET SG_ATIVO = @sgAtivo, DT_ATUALIZACAO = ${AGORA_BRASILIA} WHERE ${pk} = @id`,
        [
          ["sgAtivo", sql.Char(1), req.body.ativo ? "S" : "N"],
          ["id", sql.Int, id],
        ]
      );
      if (!result.rowsAffected[0]) {
        return res.status(404).json({ error: `Registro de ${rotuloSing} não encontrado.` });
      }
      // Cache limpo DEPOIS da gravação — ver o comentário no POST.
      cadastroCacheLimpar(rota);
      res.json({ ok: true, ativo: req.body.ativo });
    } catch (err) {
      console.error(`${log} erro ao atualizar status:`, err.message);
      res.status(500).json({ error: `Erro ao atualizar status de ${rotuloSing}: ` + err.message });
    }
  });
}

registrarCadastroBilingue({
  rota: "categorias",
  tabela: FULL_CATEGORIA_TABLE,
  pk: "ID_CATEGORIA",
  colNome: "NM_CATEGORIA",
  colDescricao: "DS_CATEGORIA",
  // Mesmo tamanho do DER que as outras 3 tabelas bilíngues (não é
  // mais exceção — ver nota em CADASTRO_LIMITES_DER acima).
  maxNome: CADASTRO_LIMITES_DER.nome,
  maxDescricao: CADASTRO_LIMITES_DER.descricao,
  rotuloSing: "categoria",
  contagem: { tabela: FULL_PENDENCIA_TABLE, coluna: "NM_CATEGORIA" },
  // ID_USUARIO: coluna nova em kzn_categoria (a ser adicionada ao banco
  // — ainda não existe no DER atual; só ID_USUARIO + DT_ATUALIZACAO,
  // sem distinguir criação de edição). Gravada automaticamente a
  // partir do usuário logado (ver idUsuarioLogado() acima); a interface
  // não expõe nem permite editar esse campo. Só Categorias tem essa
  // auditoria por enquanto — capturarUsuarioResponsavel é opt-in por
  // tabela, então as outras 5 abas bilíngues continuam exatamente como
  // estavam.
  capturarUsuarioResponsavel: true,
});

registrarCadastroBilingue({
  rota: "replicacoes",
  tabela: tabelaCadastro("AZURE_SQL_REPLICACAO_TABLE", "kzn_replicacao"),
  pk: "ID_REPLICACAO",
  colNome: "NM_REPLICACAO",
  colDescricao: "DS_REPLICACAO",
  maxNome: CADASTRO_LIMITES_DER.nome,
  maxDescricao: CADASTRO_LIMITES_DER.descricao,
  rotuloSing: "potencial de replicação",
  // ID_USUARIO (DER atualizado): mesmo padrão de Categoria — grava
  // automaticamente quem criou/editou, via idUsuarioLogado(); interface
  // não expõe nem permite editar esse campo.
  capturarUsuarioResponsavel: true,
});

registrarCadastroBilingue({
  rota: "desperdicios",
  tabela: tabelaCadastro("AZURE_SQL_DESPERDICIO_TABLE", "kzn_desperdicio"),
  pk: "ID_DESPERDICIO",
  colNome: "NM_DESPERDICIO",
  colDescricao: "DS_DESPERDICIO",
  maxNome: CADASTRO_LIMITES_DER.nome,
  maxDescricao: CADASTRO_LIMITES_DER.descricao,
  rotuloSing: "tipo de desperdício",
  // js/desperdicios.js já usa palavraBadge:"usos" (mesmo padrão do
  // badge "kaizens" de Categoria), mas faltava esta config no servidor
  // — sem ela, QTD vinha sempre null e o badge só mostrava "—". Mesma
  // tabela/abordagem de Categoria (contagem falha em silêncio se a
  // tabela/coluna não existir, sem derrubar a lista — ver nota de
  // ressalva sobre esta tabela no relatório desta tarefa).
  contagem: { tabela: FULL_PENDENCIA_TABLE, coluna: "NM_DESPERDICIO" },
  // ID_USUARIO (DER atualizado): mesmo padrão de Categoria/Replicação —
  // grava automaticamente quem criou/editou.
  capturarUsuarioResponsavel: true,
});

registrarCadastroBilingue({
  rota: "resultados",
  tabela: tabelaCadastro("AZURE_SQL_RESULTADO_TABLE", "kzn_resultados"),
  pk: "ID_RESULTADO",
  colNome: "NM_RESULTADO",
  colDescricao: "DS_RESULTADO",
  maxNome: CADASTRO_LIMITES_DER.nome,
  maxDescricao: CADASTRO_LIMITES_DER.descricao,
  rotuloSing: "tipo de resultado",
  // ID_TIPO_RESULTADO: FK própria desta tabela, agora escolhida pelo
  // usuário num combo (por nome, kzn_tipo_resultado/aba "Tipo
  // Resultados"), gravado como ID — ver campoExtraEditavel.
  // obrigatorio:true — a coluna real é NOT NULL (confirmado em produção:
  // "Cannot insert the value NULL into column 'ID_TIPO_RESULTADO'...").
  campoExtraEditavel: { col: "ID_TIPO_RESULTADO", campo: "idTipoResultado", obrigatorio: true, rotulo: "Tipo de Resultado" },
  // GET /resultados?tipo=1|2 — os dois combos da etapa "Resultados &
  // Aprendizados" bebem desta mesma tabela e se separam por
  // ID_TIPO_RESULTADO (1 = financeiro, 2 = outros). O recorte fica no
  // SERVIDOR: a tela manda o número, não o nome da coluna.
  filtroNumerico: { query: "tipo", col: "ID_TIPO_RESULTADO" },
  // ID_USUARIO: mesmo padrão das demais abas — grava automaticamente
  // quem criou/editou.
  capturarUsuarioResponsavel: true,
});

// kzn_tipo_resultado (DER atualizado): ID_TIPO_RESULTADO, ID_IDIOMA,
// NM_TIPO_RESULTADO, SG_ATIVO, ID_USUARIO, DT_ATUALIZACAO — SEM
// URL_ICONE e SEM DS_* (só nome).
registrarCadastroBilingue({
  rota: "tiporesultados",
  tabela: tabelaCadastro("AZURE_SQL_TIPO_RESULTADO_TABLE", "kzn_tipo_resultado"),
  pk: "ID_TIPO_RESULTADO",
  colNome: "NM_TIPO_RESULTADO",
  maxNome: CADASTRO_LIMITES_DER.nome,
  temIcone: false,
  rotuloSing: "tipo de resultado (classificação)",
  // ID_USUARIO: mesmo padrão de Categoria/Replicação/Desperdícios —
  // grava automaticamente quem criou/editou.
  capturarUsuarioResponsavel: true,
});

// kzn_status: ID_STATUS, ID_IDIOMA, URL_ICONE VARCHAR(200),
// NM_STATUS VARCHAR(30), DS_STATUS VARCHAR(100), SG_ATIVO, ID_USUARIO,
// DT_ATUALIZACAO. Substitui kzn_motivo_reprovacao nesta aba do admin.
//
// Diferença em relação à tabela antiga: kzn_status TEM URL_ICONE, então
// temIcone passa a true e o modal ganha a paleta de ícones que as outras
// abas com ícone já usam — nenhum componente novo.
//
// kzn_motivo_reprovacao saiu do DER por completo: o fluxo de reprovação
// passou a gravar o texto direto em PVC.DS_MOTIVO (ver o próprio
// POST /kaizens/:id/reprovar).
registrarCadastroBilingue({
  rota: "status",
  tabela: tabelaCadastro("AZURE_SQL_STATUS_TABLE", "kzn_status"),
  pk: "ID_STATUS",
  colNome: "NM_STATUS",
  colDescricao: "DS_STATUS",
  maxNome: CADASTRO_LIMITES_DER.nome,
  maxDescricao: CADASTRO_LIMITES_DER.descricao,
  temIcone: true,
  rotuloSing: "status",
  // ID_USUARIO: mesmo padrão das demais abas — grava automaticamente
  // quem criou/editou.
  capturarUsuarioResponsavel: true,
});

// kzn_tipo_kaizen: ID_TIPO_KAIZEN, ID_IDIOMA, NM_TIPO_KAIZEN,
// DS_TIPO_KAIZEN, SG_ATIVO, ID_USUARIO, DT_ATUALIZACAO — schema
// confirmado por consulta direta (SSMS). SEM URL_ICONE (temIcone:false),
// mesmo padrão de Tipo Resultados.
registrarCadastroBilingue({
  rota: "tiposkaizen",
  tabela: tabelaCadastro("AZURE_SQL_TIPO_KAIZEN_TABLE", "kzn_tipo_kaizen"),
  pk: "ID_TIPO_KAIZEN",
  colNome: "NM_TIPO_KAIZEN",
  colDescricao: "DS_TIPO_KAIZEN",
  maxNome: CADASTRO_LIMITES_DER.nome,
  maxDescricao: CADASTRO_LIMITES_DER.descricao,
  temIcone: false,
  rotuloSing: "tipo de Kaizen",
  capturarUsuarioResponsavel: true,
});

// ------------------------------------------------------------------
// kzn_moeda — não é bilíngue (sem ID_IDIOMA), então não usa
// registrarCadastroBilingue(). Só leitura por enquanto: a tela de Novo
// Kaizen só CONSOME esta lista (combo "Moeda" da Etapa 4); cadastrar
// moeda continua sendo feito direto no banco até existir uma aba
// própria no admin.
// ------------------------------------------------------------------
apiRouter.get("/moedas", async (req, res) => {
  try {
    // Mesmo cadastroCache dos outros catálogos (ver comentário acima
    // dele) — só este ficou de fora por não passar por
    // registrarCadastroBilingue(). Sem ID_IDIOMA nem variante: uma
    // entrada só, TTL de 5min é rede de segurança pra quem cadastrar
    // moeda direto no banco (não há rota de escrita aqui para invalidar).
    const emCache = cadastroCacheLer("moedas", 0, "");
    if (emCache) return res.json(emCache);

    const result = await runQuery(
      `SELECT ID_MOEDA, NM_MOEDA, SG_MOEDA, NM_PAIS, SG_ATIVO
       FROM ${FULL_MOEDA_TABLE}
       ORDER BY NM_MOEDA`
    );
    const itens = result.recordset.map((r) => ({
      ID: r.ID_MOEDA,
      NM: r.NM_MOEDA,
      SG: r.SG_MOEDA,
      PAIS: r.NM_PAIS,
      ATIVO: ehAtivo(r.SG_ATIVO),
    }));
    cadastroCacheGravar("moedas", 0, "", itens);
    res.json(itens);
  } catch (err) {
    console.error("[moedas] erro ao listar:", err.message);
    res.status(500).json({ error: "Erro ao consultar moedas: " + err.message });
  }
});

// ------------------------------------------------------------------
// kzn_tipo_kaizen — Tipo de Kaizen (Novo / Abrangência / Replicação).
// O CRUD/listagem pública (aba Administração, combo do Novo Kaizen) é o
// registrarCadastroBilingue() acima. listarTiposKaizen()/conferirTipoKaizen()
// abaixo são só o USO INTERNO de POST/PUT /kaizens (validar o ID
// escolhido antes de gravar) — chave de cache própria para não colidir
// com o cache do CRUD, que guarda um formato de item diferente (ID/DS/
// URL_ICONE/QTD, ver registrarCadastroBilingue).
// ------------------------------------------------------------------
const FULL_TIPO_KAIZEN_TABLE = tabelaCadastro("AZURE_SQL_TIPO_KAIZEN_TABLE", "kzn_tipo_kaizen");

// Sem cache de propósito: é validação de gravação (POST/PUT /kaizens),
// não uma listagem de tela — desativar um tipo na Administração tem de
// valer JÁ na próxima tentativa de salvar, não só depois do TTL.
async function listarTiposKaizen(idIdioma) {
  const r = await runQuery(`SELECT * FROM ${FULL_TIPO_KAIZEN_TABLE}`);
  const linhas = r.recordset;
  const cols = linhas.length ? Object.keys(linhas[0]) : [];
  const colId = cols.includes("ID_TIPO_KAIZEN") ? "ID_TIPO_KAIZEN"
    : cols.find((c) => /^ID_/i.test(c) && !/^ID_(IDIOMA|USUARIO)$/i.test(c));
  const colNome = cols.includes("NM_TIPO_KAIZEN") ? "NM_TIPO_KAIZEN"
    : cols.find((c) => /^NM_/i.test(c)) || cols.find((c) => /^DS_/i.test(c));
  if (linhas.length && (!colId || !colNome)) {
    throw new Error(`${FULL_TIPO_KAIZEN_TABLE} sem coluna de ID/nome reconhecível (colunas: ${cols.join(", ")})`);
  }
  let base = linhas;
  if (cols.includes("ID_IDIOMA")) {
    // Por tipo: a linha do idioma pedido; sem tradução, a do português.
    const porId = new Map();
    linhas.forEach((l) => {
      const atual = porId.get(l[colId]);
      if (l.ID_IDIOMA === idIdioma || (!atual && l.ID_IDIOMA === 1)) porId.set(l[colId], l);
    });
    base = [...porId.values()];
  }
  return base
    .map((l) => ({ ID: l[colId], NM: l[colNome], ATIVO: cols.includes("SG_ATIVO") ? ehAtivo(l.SG_ATIVO) : true }))
    .sort((a, b) => a.ID - b.ID);
}

/** A coluna existe NESTA tabela da PVC (atual ou histórica)? Mesmo
 *  padrão de temColunaDsResultado: coluna ausente = não grava e não
 *  exige, em vez de derrubar o cadastro/edição. Usada pelas colunas
 *  novas ID_TIPO_KAIZEN, SG_GM e URL_GM. */
const colunaPvcCache = new Map();
async function temColunaNaPvc(nomeTabela, coluna) {
  const chave = `${nomeTabela}.${coluna}`;
  if (colunaPvcCache.has(chave)) return colunaPvcCache.get(chave);
  let existe = false;
  try {
    const r = await runQuery(
      `SELECT 1 AS OK FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela AND COLUMN_NAME = @coluna`,
      [["esquema", sql.NVarChar(128), DB_SCHEMA], ["tabela", sql.NVarChar(128), nomeTabela],
       ["coluna", sql.NVarChar(128), coluna]]
    );
    existe = r.recordset.length > 0;
  } catch (err) {
    existe = false;
  }
  if (!existe) console.warn(`[kaizens] ${coluna} ausente em ${DB_SCHEMA}.${nomeTabela} — não será gravada.`);
  colunaPvcCache.set(chave, existe);
  return existe;
}

/** Obrigatório e válido (ativo em kzn_tipo_kaizen) sempre que a coluna
 *  existe na tabela de destino. { grava } ou { erro }. */
async function conferirTipoKaizen(nomeTabela, idTipoKaizen) {
  if (!(await temColunaNaPvc(nomeTabela, "ID_TIPO_KAIZEN"))) return { grava: false };
  const validos = (await listarTiposKaizen(1)).filter((t) => t.ATIVO).map((t) => t.ID);
  if (!validos.includes(idTipoKaizen)) return { erro: "Selecione o Tipo de Kaizen." };
  return { grava: true };
}

/** Gestão de Mudança: SG_GM ('S'/'N') + URL_GM (link da evidência,
 *  obrigatório quando 'S'). Só grava/exige se as DUAS colunas existirem. */
async function conferirGestaoMudanca(nomeTabela, sgGm, urlGm) {
  const [temSg, temUrl] = await Promise.all([
    temColunaNaPvc(nomeTabela, "SG_GM"), temColunaNaPvc(nomeTabela, "URL_GM"),
  ]);
  if (!temSg || !temUrl) return { grava: false };
  if (sgGm !== "S" && sgGm !== "N") return { erro: "Informe se o Kaizen possui Gestão de Mudança." };
  if (sgGm === "S" && !urlGm) return { erro: "Link da evidência da Gestão de Mudança é obrigatório." };
  if (urlGm && urlGm.length > PVC_LIMITES.URL_GM) {
    return { erro: `Link da Gestão de Mudança deve ter no máximo ${PVC_LIMITES.URL_GM} caracteres.` };
  }
  return { grava: true, url: sgGm === "S" ? urlGm : null };
}

// ------------------------------------------------------------------
// Novo Kaizen (kaizen-novo.html) — imagens (Antes/Depois) + criação
// ------------------------------------------------------------------
// As imagens NOVAS são gravadas no Azure Blob Storage — ver
// azure-blob.js. O Volume do Databricks (databricks-fs.js) continua
// atendendo só a LEITURA das fotos gravadas antes dessa troca.
//
// Por que os dois: as linhas já existentes na PVC têm o caminho do
// volume gravado em URL_IMG_ANTES/URL_IMG_DEPOIS. Apagar esse caminho
// sem copiar os arquivos apagaria a foto de todo Kaizen já cadastrado.
// Como a origem é reconhecível pelo próprio caminho (volume começa com
// "/Volumes/", blob não), dá para atender os dois sem migração e sem
// data marcada — ver armazenamentoDe() abaixo. Se um dia os arquivos
// antigos forem copiados para o Blob e as duas colunas atualizadas,
// basta remover o ramo do volume daqui.
//
// Caminho pedido no arquivo de especificação (Usuário - Novo Kaizen -
// Aprovação.txt), preservado dentro do Blob:
//   Antes:  <container>/<pasta>/imgs/before/
//   Depois: <container>/<pasta>/imgs/after/
// que no volume eram:
//   /Volumes/franquia_bmsa_insight/ci/kaizen/imgs/before/ (e after/)
//
// O upload acontece assim que a pessoa escolhe o arquivo na Etapa 2/3
// (não espera o "Enviar para Aprovação" final) — o caminho devolvido
// fica num campo oculto (url_imagem_antes/depois) até o POST /kaizens.
// Consequência aceita: escolher uma foto e nunca terminar o formulário
// deixa um arquivo órfão no armazenamento; tolerável para o volume de
// uso desta tela, mas fica registrado aqui caso vire problema (poda por
// idade de arquivo, por exemplo). Enquanto o SAS do Blob não tiver a
// permissão de delete (sp=racwd), a limpeza do temporário também falha
// e engrossa esse mesmo monte — ver azure-blob.js.
const IMG_MAX_BYTES = 10 * 1024 * 1024; // 10MB — mesmo limite anunciado no formulário
const IMG_MIME_AUTORIZADOS = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMG_EXT_POR_MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMG_MAX_BYTES },
});

// multer.single() como middleware direto devolveria um erro cru (HTML,
// não JSON) quando o arquivo estoura o limite — envolvemos manualmente
// para sempre responder no mesmo formato { error } do resto da API.
function receberImagemUnica(req, res, next) {
  upload.single("imagem")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Arquivo maior que 10MB." });
    }
    return res.status(400).json({ error: "Erro no upload: " + err.message });
  });
}

const VOLUME_BASE_IMGS = "/Volumes/franquia_bmsa_insight/ci/kaizen/imgs";
// Base no Blob. É relativa à pasta configurada em AZURE_STORAGE_CONTAINER
// ("05 - Kaizen", que azure-blob.js prefixa). Estas pastas JÁ EXISTEM no
// datalake e são as que o time usa — não invente outras, o caminho
// completo é "05 - Kaizen/01 - Imagens/01 - Antes".
const BLOB_BASE_IMGS = "01 - Imagens";
const PASTA_POR_TIPO_IMG = { antes: "01 - Antes", depois: "02 - Depois" };
// O volume antigo usava before/after; esse mapa vale só para o Blob,
// porque gravação nova só acontece lá. Caminho de volume não é remontado
// em lugar nenhum — vem pronto do banco, do jeito que foi gravado.

/** De onde vem (ou para onde vai) este caminho de imagem.
 *
 *  O caminho se identifica sozinho: o do volume é absoluto e começa com
 *  "/Volumes/", o do blob é relativo ("imgs/before/1.png"). Não há
 *  ambiguidade possível entre os dois formatos, então não é preciso uma
 *  coluna nova no banco dizendo a origem. */
function ehCaminhoDeVolume(caminho) {
  return String(caminho || "").startsWith("/Volumes/");
}

/** Bases aceitas na LEITURA. A gravação usa só BLOB_BASE_IMGS; as outras
 *  existem para não quebrar caminhos que JÁ ESTÃO gravados no banco:
 *
 *    VOLUME_BASE_IMGS  fotos anteriores à mudança para o Blob.
 *    "imgs"            fotos gravadas pela primeira versão desta mudança,
 *                      que criou uma pasta "imgs/before|after" em vez de
 *                      usar "01 - Imagens/01 - Antes|02 - Depois". São
 *                      poucas, de cadastros de teste; quando as linhas
 *                      forem corrigidas (ou apagadas) esta entrada sai.
 */
const BASES_LEITURA_IMGS = [VOLUME_BASE_IMGS, BLOB_BASE_IMGS, "imgs"];

/** Este caminho é uma imagem de Kaizen legítima?
 *
 *  Duas condições, as duas necessárias: estar sob uma das bases aceitas, e
 *  não conter ".." em segmento nenhum. Só o prefixo não basta —
 *  "01 - Imagens/../../outra-coisa" começa com a base e mesmo assim sai
 *  dela. Como este caminho vem da querystring, quem chama escolhe o
 *  texto, e a rota vale um proxy de leitura se a checagem for frouxa. */
function caminhoDeImagemValido(caminho) {
  const texto = String(caminho || "");
  if (!BASES_LEITURA_IMGS.some((base) => texto.startsWith(base + "/"))) return false;
  return !texto.split("/").includes("..");
}

// Leitura e remoção vão para a origem do caminho; a GRAVAÇÃO é sempre no
// Blob quando ele está configurado. Assim o que já existe continua sendo
// exibido e o que é novo já nasce no destino novo.
async function lerImagemArmazenada(caminho) {
  return ehCaminhoDeVolume(caminho) ? baixarArquivoDoVolume(caminho) : baixarArquivoDoBlob(caminho);
}

async function removerImagemArmazenada(caminho) {
  return ehCaminhoDeVolume(caminho) ? removerArquivoDoVolume(caminho) : removerArquivoDoBlob(caminho);
}

async function gravarImagemArmazenada(caminho, buffer, contentType) {
  return ehCaminhoDeVolume(caminho)
    ? enviarArquivoParaVolume(caminho, buffer, contentType)
    : enviarArquivoParaBlob(caminho, buffer, contentType);
}

// Nome gerado no servidor (nunca o nome original do arquivo): evita
// colisão entre pessoas diferentes enviando "foto.jpg" ao mesmo tempo e
// evita qualquer caractere problemático vindo do sistema de arquivos de
// quem enviou.
// Nome DEFINITIVO da foto: SÓ o ID_KAIZEN. Ex.:
// "01 - Imagens/01 - Antes/7.png" e "01 - Imagens/02 - Depois/7.png".
// Quem separa o "antes" do "depois" é a PASTA — o nome não repete essa
// informação. O número é o ID_KAIZEN da kzn_pedravisaoconsolidada, que
// no cadastro novo é MAX(ID_KAIZEN)+1 (calculado dentro da transação do
// POST /kaizens) e na edição é o ID que o Kaizen já tem. Por vir do
// banco, o mesmo número serve às duas fotos sem nenhuma coordenação
// entre os dois uploads.

/** Nome PROVISÓRIO, usado SÓ no cadastro novo, enquanto o ID não existe.
 *
 *  Na edição o ID já existe e a foto entra direto com o nome definitivo
 *  — nenhum arquivo provisório é criado.
 *
 *  No cadastro novo não há como evitá-lo: a tela envia a foto quando a
 *  pessoa escolhe o arquivo (etapas 2 e 3) e o ID_KAIZEN só nasce no
 *  INSERT, lá no fim. Entre um momento e outro o arquivo precisa de um
 *  nome que não possa colidir com o de mais ninguém — daí o instante +
 *  aleatório. Assim que o ID aparece, o arquivo é regravado com o nome
 *  definitivo e ESTE é apagado (ver renomearImagemParaId). Se a remoção
 *  falhar — é o que acontece quando o SAS não tem a permissão 'd' — o
 *  provisório fica na pasta como lixo, ao lado do definitivo e com o
 *  mesmo tamanho. */
function nomeArquivoTemporario(mimetype) {
  const ext = IMG_EXT_POR_MIME[mimetype] || ".jpg";
  return `TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
}

/** Nome definitivo da foto, a partir do MIME e do número do Kaizen. */
function nomeArquivoImagem(mimetype, idKaizen) {
  const ext = IMG_EXT_POR_MIME[mimetype] || ".jpg";
  return `${idKaizen}${ext}`;
}

/** Apaga as fotos do mesmo Kaizen com OUTRA extensão, na mesma pasta.
 *
 *  Trocar um PNG por um JPG grava "1.jpg" e deixaria "1.png" para trás:
 *  dois arquivos para o mesmo Kaizen na mesma pasta, que é justamente a
 *  ambiguidade que nomear pelo ID veio resolver. São no máximo duas
 *  chamadas, todas best-effort — falhar aqui não atrapalha nada além de
 *  deixar um arquivo sobrando. */
async function limparOutrasExtensoes(pasta, numero, caminhoMantido) {
  for (const ext of new Set(Object.values(IMG_EXT_POR_MIME))) {
    const alvo = `${pasta}/${numero}${ext}`;
    if (alvo === caminhoMantido) continue;
    await removerImagemArmazenada(alvo);
  }
}

/** Deixa UMA foto com o nome "<numero>.<ext>", na pasta onde ela já está.
 *
 *  Se o arquivo já está com esse nome, não faz nada — nem uma chamada ao
 *  armazenamento. Senão lê, regrava com o nome final e apaga o antigo.
 *
 *  A pasta é sempre a do arquivo atual: o upload já colocou o arquivo em
 *  "01 - Antes" ou "02 - Depois" conforme o tipo, e é a pasta que diz
 *  qual é qual.
 *
 *  Em qualquer falha devolve o caminho ORIGINAL: a foto existe e está
 *  gravada, e perder o cadastro inteiro por causa do nome do arquivo
 *  seria trocar um problema pequeno por um grande. O erro fica no log
 *  com o ID, para dar para renomear depois se alguém quiser. */
async function renomearImagemParaId(caminhoAtual, idKaizen) {
  const numero = idKaizen;
  if (!caminhoAtual || !Number.isInteger(numero) || numero <= 0) return caminhoAtual;
  const pasta = caminhoAtual.slice(0, caminhoAtual.lastIndexOf("/"));
  const arquivo = caminhoAtual.slice(caminhoAtual.lastIndexOf("/") + 1);
  // Já está no padrão "<numero>.<ext>"? Então não há o que fazer.
  if (new RegExp(`^${numero}\\.[a-z0-9]+$`, "i").test(arquivo)) return caminhoAtual;

  try {
    const { buffer, contentType } = await lerImagemArmazenada(caminhoAtual);
    const ext = IMG_EXT_POR_MIME[contentType] || arquivo.slice(arquivo.lastIndexOf("."));
    const caminhoFinal = `${pasta}/${numero}${ext}`;
    if (caminhoFinal === caminhoAtual) return caminhoAtual;
    // Origem e destino são o mesmo lugar: o arquivo temporário foi
    // gravado no mesmo armazenamento em que o definitivo vai ficar.
    await gravarImagemArmazenada(caminhoFinal, buffer, contentType);
    const apagou = await removerImagemArmazenada(caminhoAtual);
    if (!apagou) console.warn(`[imagem] ID_KAIZEN=${idKaizen}: ${caminhoAtual} ficou gravado (não foi possível apagar).`);
    await limparOutrasExtensoes(pasta, numero, caminhoFinal);
    return caminhoFinal;
  } catch (err) {
    console.error(`[imagem] ID_KAIZEN=${idKaizen}: não foi possível renomear ${caminhoAtual}: ${err.message}`);
    return caminhoAtual;
  }
}

/** Nomeia as fotos do Kaizen — as duas levam o ID_KAIZEN.
 *
 *  Não há número a "decidir": ele vem do banco (kzn_pedravisaoconsolidada),
 *  é o mesmo para as duas fotos por construção e não muda entre um upload
 *  e o outro. Na edição, as fotos que já estavam gravadas já têm esse
 *  nome, então a chamada correspondente não faz nada. */
async function nomearImagensDoKaizen({ novoAntes, novoDepois, idKaizen }) {
  const [antes, depois] = await Promise.all([
    novoAntes ? renomearImagemParaId(novoAntes, idKaizen) : Promise.resolve(null),
    novoDepois ? renomearImagemParaId(novoDepois, idKaizen) : Promise.resolve(null),
  ]);
  return { antes, depois };
}

// GET /kaizens/imagem?path=... — serve de volta uma imagem já gravada (a
// Biblioteca usa isso no <img src>, já que nem o caminho do volume nem o
// do blob são URLs que o navegador acesse direto — e no caso do blob o
// SAS não pode sair do servidor). Atende as duas origens, cada uma
// restrita à sua base: não é um proxy genérico de nenhuma das duas.
apiRouter.get("/kaizens/imagem", async (req, res) => {
  try {
    const caminho = String(req.query.path || "");
    if (!caminhoDeImagemValido(caminho)) {
      return res.status(400).json({ error: "Caminho de imagem inválido." });
    }
    const { buffer, contentType } = await lerImagemArmazenada(caminho);
    res.setHeader("Content-Type", contentType);
    // O nome do arquivo é o ID do Kaizen e NÃO muda ao trocar a foto,
    // então a URL sozinha não diz se o conteúdo mudou. Quem chama
    // resolve isso passando ?v= com a DT_ATUALIZACAO do Kaizen — que
    // muda exatamente quando a foto é substituída. Com versão na URL a
    // resposta pode ser guardada para sempre; sem ela, o cache curto de
    // antes, que ainda evita rebuscar a mesma imagem durante a
    // navegação mas deixa a troca aparecer depressa.
    res.setHeader(
      "Cache-Control",
      req.query.v ? `private, max-age=${UM_ANO_EM_SEGUNDOS}, immutable` : "private, max-age=60"
    );
    res.send(buffer);
  } catch (err) {
    console.error("[kaizens/imagem GET] erro:", err.message);
    res.status(404).end();
  }
});

apiRouter.post("/kaizens/imagem", receberImagemUnica, async (req, res) => {
  try {
    const tipo = String(req.query.tipo || "").toLowerCase();
    const pasta = PASTA_POR_TIPO_IMG[tipo];
    if (!pasta) return res.status(400).json({ error: "Parâmetro 'tipo' deve ser 'antes' ou 'depois'." });
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado (campo 'imagem')." });
    if (!IMG_MIME_AUTORIZADOS.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Formato não suportado. Envie PNG, JPG ou WEBP." });
    }

    // Todo upload entra com nome provisório, edição inclusive. O nome
    // definitivo é o número do Kaizen na pasta, e esse número só pode ser
    // decidido quando as DUAS fotos são conhecidas (ver
    // nomearImagensDoKaizen): calculado por upload, o "antes" gravado
    // como 7 faria o "depois" virar 8 e o par se desfaz. Quem batiza é o
    // POST /kaizens e o PUT /kaizens/:id.
    //
    // O ?id= continua exigindo autorização. Ele não decide mais nome de
    // arquivo, mas manda enviar foto no contexto de um Kaizen, e isso é
    // de quem pode editá-lo. A permissão é a mesma da edição (autor,
    // aprovador ou admin) — o status não entra aqui: quem decide se ainda
    // dá para salvar é o PUT.
    const idKaizenArquivo = parseInt(req.query.id, 10);
    const temId = Number.isInteger(idKaizenArquivo) && idKaizenArquivo > 0;
    if (temId) {
      // O ?id= PRECISA de autorização: com o nome do arquivo sendo o ID e
      // a gravação em overwrite, mandar o ID de OUTRO Kaizen gravaria por
      // cima da foto dele.
      // A tela manda a origem junto com o ?id= (ver VBMEdicao.origem).
      const autoriz = await podeEditarKaizen(req, idKaizenArquivo, origemValida(req.query.origem));
      if (!autoriz.existe) {
        return res.status(404).json({ error: "Kaizen não encontrado." });
      }
      if (!autoriz.pode) {
        console.warn(`[imagem] usuário ${autoriz.idUsuario} sem permissão para gravar imagem do ID_KAIZEN=${idKaizenArquivo}`);
        return res.status(403).json({ error: "Usuário não autorizado a alterar as imagens deste Kaizen." });
      }
    }
    // Com ID (edição) o arquivo já nasce com o nome DEFINITIVO: o número
    // existe, então não há por que gravar um provisório e depois copiar.
    // É assim que a edição não deixa nenhum TEMP_ para trás.
    const nomeArquivo = temId
      ? nomeArquivoImagem(req.file.mimetype, idKaizenArquivo)
      : nomeArquivoTemporario(req.file.mimetype);
    // Destino da gravação: o Blob. O Volume só continua atendendo as
    // fotos antigas na leitura. Sem a configuração do Blob não há para
    // onde gravar — falhar aqui, com a causa dita, é melhor do que
    // gravar no lugar errado e descobrir depois.
    if (!blobConfigurado()) {
      console.error("[imagem] AZURE_STORAGE_* não configurado — upload recusado.");
      return res.status(500).json({ error: "Armazenamento de imagens não configurado. Avise o administrador." });
    }
    const caminhoImagem = `${BLOB_BASE_IMGS}/${pasta}/${nomeArquivo}`;
    await enviarArquivoParaBlob(caminhoImagem, req.file.buffer, req.file.mimetype);
    // Trocar PNG por JPG deixaria o arquivo antigo para trás, com outra
    // extensão e o mesmo ID. Some com ele.
    if (temId) await limparOutrasExtensoes(`${BLOB_BASE_IMGS}/${pasta}`, idKaizenArquivo, caminhoImagem);

    res.json({ ok: true, url: caminhoImagem });
  } catch (err) {
    console.error("[kaizens/imagem] erro ao enviar imagem:", err.message);
    res.status(500).json({ error: "Erro ao enviar a imagem: " + err.message });
  }
});

// Ciclo de vida do Kaizen — kzn_pedravisaoconsolidada.ID_STATUS.
//
// Era SG_STATUS, um VARCHAR com literais ('EM_APROVACAO', 'APROVADO',
// 'REPROVADO'). No DER atual virou ID_STATUS, chave estrangeira para
// kzn_status — que é um CADASTRO, editável pela aba Status Kaizen. Não
// há mais literal para o código fixar.
//
// A ÚNICA fonte do ID é kzn_status. Não há variável de ambiente no
// caminho: os status já estão cadastrados, e um ID em app.yaml só
// acrescentava um segundo lugar para a verdade divergir — se alguém
// trocasse o número lá, o app gravaria um status que não é o da tela.
//
// ID_STATUS é a chave funcional (o mesmo número nos dois idiomas) e
// ID_IDIOMA é só apresentação. Por isso a resolução varre o cadastro
// inteiro, em qualquer idioma: "Aguardando aprovação" e "Awaiting
// approval" são a mesma linha lógica e devolvem o mesmo ID_STATUS.
// Só entram linhas ativas (SG_ATIVO 'S' na PRD ou 'A' na DEV — ver ehAtivo).
/** Status que colocam o Kaizen na FILA DE APROVAÇÃO: "Aguardando
 *  aprovação" e "Revisado". O revisado volta para a fila porque, tendo
 *  sido ajustado pelo autor, precisa de nova validação — não é uma
 *  decisão já tomada.
 *
 *  Os dois saem de idDoStatus(), como todo ID de status do sistema.
 *  Sem catálogo resolvido, a fila cai no comportamento antigo
 *  ("ID_STATUS IS NULL"), em vez de listar tudo. */
async function idsNaFilaDeAprovacao() {
  const ids = await Promise.all([idDoStatus("emAprovacao"), idDoStatus("revisado")]);
  return ids.filter((x) => Number.isInteger(x));
}

/** Os parâmetros são numerados (@idFila0, @idFila1...) e criados só para
 *  os IDs que existem — mandar parâmetro sobrando quebraria o comando. */
function filtroPendente(idsFila) {
  const lista = Array.isArray(idsFila) ? idsFila : (idsFila != null ? [idsFila] : []);
  if (!lista.length) return "p.ID_STATUS IS NULL";
  return `p.ID_STATUS IN (${lista.map((_, i) => `@idFila${i}`).join(", ")})`;
}
function paramsComPendente(params, idsFila) {
  const lista = Array.isArray(idsFila) ? idsFila : (idsFila != null ? [idsFila] : []);
  return params.concat(lista.map((id, i) => [`idFila${i}`, sql.Int, id]));
}

/** Nomes cadastrados que identificam cada momento do ciclo, nos dois
 *  idiomas. É a ponte entre o cadastro — que o administrador edita na
 *  aba Status Kaizen — e os quatro momentos que o código precisa nomear.
 *  Vários rótulos por momento porque o mesmo estado já foi cadastrado
 *  com nomes diferentes ao longo do projeto ("Solicitado alterações"
 *  hoje, "Solicitar alteração" antes); um rótulo antigo não pode
 *  derrubar a decisão do aprovador. */
const NOMES_DO_STATUS = {
  emAprovacao: ["Aguardando aprovação", "Em aprovação", "Aguardando", "Em análise",
                "Awaiting approval", "Pending approval", "Waiting approval"],
  aprovado: ["Aprovado", "Aprovada", "Concluído", "Approved", "Approve"],
  reprovado: ["Reprovado", "Rejeitado", "Reprovada", "Rejected", "Reject"],
  revisado: ["Revisado", "Revisada", "Em revisão", "Reviewed", "Revised"],
  alteracao: ["Solicitado alterações", "Solicitado alteração", "Solicitar alterações",
              "Solicitar alteração", "Em alteração", "Ajuste solicitado",
              "Request changes", "Requested changes", "Change requested"],
};

const semAcento = (x) =>
  String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

/** kzn_status carregado uma vez e reusado: é cadastro, não muda a cada
 *  Kaizen. O TTL curto existe porque a aba Status Kaizen edita essa
 *  mesma tabela — sem ele, renomear um status só passaria a valer no
 *  próximo restart do app. */
const TTL_CATALOGO_STATUS_MS = 60 * 1000;
let catalogoStatus = null;   // Map: nome normalizado -> ID_STATUS
let catalogoStatusEm = 0;

async function carregarCatalogoStatus() {
  if (catalogoStatus && Date.now() - catalogoStatusEm < TTL_CATALOGO_STATUS_MS) {
    return catalogoStatus;
  }
  // Sem try/catch: um erro de consulta precisa subir. Engolir aqui fazia
  // "banco fora do ar" parecer "status não cadastrado" — exatamente o
  // diagnóstico errado que este trecho já produziu em produção.
  const lista = await runQuery(
    `SELECT ID_STATUS, NM_STATUS FROM ${FULL_STATUS_TABLE} WHERE SG_ATIVO IN ${SG_ATIVO_SIM_SQL}`
  );
  const mapa = new Map();
  lista.recordset.forEach((r) => {
    const chave = semAcento(r.NM_STATUS);
    if (chave && !mapa.has(chave)) mapa.set(chave, r.ID_STATUS);
  });
  catalogoStatus = mapa;
  catalogoStatusEm = Date.now();
  return mapa;
}

/** ID_STATUS de um momento do ciclo, resolvido só por kzn_status. TODO
 *  ponto que precisa de um ID passa por aqui — senão um caminho resolve
 *  de um jeito e o outro de outro, e o Kaizen some da fila. */
async function idDoStatus(momento) {
  const nomes = NOMES_DO_STATUS[momento] || NOMES_DO_STATUS.emAprovacao;
  const mapa = await carregarCatalogoStatus();
  for (const nome of nomes) {
    const id = mapa.get(semAcento(nome));
    if (id != null) return id;
  }
  // Log com o que o cadastro realmente tem: sem isso, "nome diferente do
  // esperado" e "cadastro vazio" ficam indistinguíveis no incidente.
  console.error(
    `[status] momento "${momento}" não encontrado em ${FULL_STATUS_TABLE}. ` +
    `Aceitos: ${nomes.join(" | ")}. Ativos no cadastro: ${[...mapa.keys()].join(" | ") || "(nenhum)"}.`
  );
  return null;
}

const ERRO_STATUS_NAO_CONFIGURADO =
  "Status não encontrado no cadastro. Verifique em Administração > " +
  "Status Kaizen se os status Aguardando aprovação, Aprovado, Rejeitado " +
  "e Solicitado alterações existem e estão ativos.";

// Limites de texto — vêm do DER (database/DER_VBM_Kaizen.html /
// e_PVC). NM_KAIZEN foi de 30 para 100: o limite curto vinha das tabelas
// de cadastro e apertava demais o título. Alargar não invalida nada do
// que já está gravado — o que cabia em 30 cabe em 100.
const PVC_LIMITES = {
  NM_KAIZEN: 100,
  // Os campos de texto livre e de URL foram para VARCHAR(300) no DER
  // atual.
  DS_PROBLEMA: 300,
  DS_OBJETIVO: 300,
  DS_ESTADO_ANTES: 300,
  DS_ESTADO_DEPOIS: 300,
  URL_REFERENCIA: 300,
  URL_GM: 300,
  DS_LICOES_APRENDIDAS: 300,
  // DS_COMPARA_META é o novo destino da "Comparação com a Meta Inicial";
  // DS_RESULTADO_ESPERADO é onde ela morava e continua sendo o destino
  // enquanto o ALTER TABLE não roda. Mesmo limite nos dois, porque é o
  // MESMO campo da tela — validar por um e gravar no outro deixaria
  // passar um texto que o banco recusa.
  DS_COMPARA_META: 300,
  DS_RESULTADO_ESPERADO: 300,
  URL_IMG: 300,
  // DS_MOTIVO: texto da reprovação, gravado direto na linha do Kaizen.
  DS_MOTIVO: 300,
};

/** Tamanho REAL de uma coluna de texto da PVC, lido do banco em vez de
 *  confiado ao DER.
 *
 *  O DER diz um número; se a coluna em produção for menor, validar pelo
 *  DER deixa passar um texto que o INSERT/UPDATE recusa depois — a
 *  pessoa escreve, clica e leva um erro de truncamento no lugar do
 *  resultado. Lido uma vez por coluna e guardado: é metadado, não muda
 *  em runtime. Só consulta INFORMATION_SCHEMA — não altera estrutura.
 *
 *  Era exclusivo do DS_MOTIVO; virou genérico porque NM_KAIZEN passou a
 *  precisar da mesma proteção enquanto o ALTER TABLE de 30 para 100
 *  (database/alterar_nm_kaizen_100.sql) não for aplicado. */
/* DT_REFERENCIA é a coluna computada persistida sugerida na auditoria
   (ISNULL(DT_CONCLUSAO, DT_ATUALIZACAO)) — ver
   database/otimizacao_indices.sql. Ela é o que torna o filtro por
   período e a ordenação da Biblioteca indexáveis: ISNULL() aplicado na
   hora da consulta impede qualquer índice de ser usado.

   O código funciona COM ou SEM ela: enquanto o script não for rodado, a
   expressão original é usada e nada quebra; assim que a coluna existir,
   a mesma consulta passa a usá-la sem precisar de novo deploy. A
   verificação é feita uma vez e guardada. */
let colunaReferenciaExiste = null;
// DS_RESULTADO_ALCANCADO em kzn_pedravisaoconsolidada guarda a
// "Descrição dos Resultados Alcançados" — texto livre do KAIZEN, não do
// catálogo (ver database/adicionar_colunas_texto_pvc.sql). Não confundir
// com kzn_resultados.DS_RESULTADO, que é a descrição do ITEM DE
// CATÁLOGO e continua existindo, intocada.
//
// A coluna é NOVA: o código pode chegar ao ar antes do script rodar, e
// um INSERT citando coluna inexistente derrubaria o cadastro inteiro.
// Checa uma vez, guarda a resposta e diz no log o que decidiu — "não
// gravou a descrição" e "gravou" não podem ser indistinguíveis de fora.
// Este campo é OPCIONAL, então sem a coluna o texto é descartado com
// aviso; o obrigatório (Comparação com a Meta) tem tratamento próprio,
// logo abaixo.
let colunaDsResultadoExiste = null;
async function temColunaDsResultado() {
  if (colunaDsResultadoExiste !== null) return colunaDsResultadoExiste;
  try {
    const r = await runQuery(
      `SELECT 1 AS OK FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela
          AND COLUMN_NAME = 'DS_RESULTADO_ALCANCADO'`,
      [["esquema", sql.NVarChar(128), DB_SCHEMA], ["tabela", sql.NVarChar(128), DB_PVC_TABLE]]
    );
    colunaDsResultadoExiste = r.recordset.length > 0;
  } catch (err) {
    colunaDsResultadoExiste = false;
  }
  console.log(`[resultados] DS_RESULTADO_ALCANCADO ${colunaDsResultadoExiste ? "disponível" : "AUSENTE"} em ` +
    `${FULL_PVC_TABLE}` + (colunaDsResultadoExiste ? "." :
      " — a descrição dos resultados não será gravada; rode database/adicionar_colunas_texto_pvc.sql."));
  return colunaDsResultadoExiste;
}

/* DS_COMPARA_META passa a guardar a "Comparação com a Meta Inicial /
   Declaração do Problema" — o campo obrigatório do fim da etapa 4. Até
   aqui esse texto morava em DS_RESULTADO_ESPERADO.
   Ver database/adicionar_colunas_texto_pvc.sql.

   Enquanto o script não roda, a coluna NÃO EXISTE, e este campo é
   OBRIGATÓRIO: descartá-lo como se faz com a descrição dos resultados
   (que é opcional) perderia o que a pessoa escreveu. Por isso a falta
   da coluna aqui não descarta nada — mantém a gravação em
   DS_RESULTADO_ESPERADO, que é onde o campo está hoje, e o app troca
   sozinho de coluna assim que o ALTER TABLE for aplicado. */
let colunaDsComparaMetaExiste = null;
async function colunaDaComparacaoMeta() {
  if (colunaDsComparaMetaExiste === null) {
    try {
      const r = await runQuery(
        `SELECT 1 AS OK FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela AND COLUMN_NAME = 'DS_COMPARA_META'`,
        [["esquema", sql.NVarChar(128), DB_SCHEMA], ["tabela", sql.NVarChar(128), DB_PVC_TABLE]]
      );
      colunaDsComparaMetaExiste = r.recordset.length > 0;
    } catch (err) {
      colunaDsComparaMetaExiste = false;
    }
    console.log("[comparacao] " + (colunaDsComparaMetaExiste
      ? `DS_COMPARA_META disponível em ${FULL_PVC_TABLE}.`
      : `DS_COMPARA_META AUSENTE em ${FULL_PVC_TABLE} — a Comparação com a Meta continua` +
        " gravando em DS_RESULTADO_ESPERADO; rode database/adicionar_colunas_texto_pvc.sql."));
  }
  return colunaDsComparaMetaExiste ? "DS_COMPARA_META" : "DS_RESULTADO_ESPERADO";
}

/* DT_ATUALIZACAO em kzn_pedravisaoconsolidada foi renomeada para
   DT_CRIACAO em produção (fora do controle deste código) — confirmado
   por consulta direta ao INFORMATION_SCHEMA via SSMS. A coluna é
   citada por nome em quase toda rota que toca a PVC direto — listagem
   de aprovação, decisão de aprovar/reprovar, cadastro, edição,
   comunicado por e-mail —, então em vez de trocar cada rota para um
   nome fixo (e quebrar de novo se o nome mudar outra vez, ou em outro
   ambiente que ainda não tenha a renomeação), o nome real é resolvido
   uma vez aqui, como as outras colunas opcionais acima — com DT_CRIACAO
   como padrão, já que é o nome confirmado em produção HOJE.

   A histórica (kzn_hist_pedravisaoconsolidada) foi tratada por muito
   tempo como "não tocada por essa renomeação" — suposição nunca
   verificada, e ERRADA: o texto do SQL que efetivamente saiu para o
   banco (capturado via corpoErroSql, ver runQuery) mostrou a mesma
   falha vindo do lado histórico. As duas tabelas são resolvidas
   INDEPENDENTEMENTE, cada uma com seu próprio cache — nada garante que
   uma renomeação futura atinja as duas ao mesmo tempo. */
const colunaAtualizacaoCache = new Map();
async function colunaAtualizacaoDe(nomeSchema, nomeTabela) {
  const chave = `${nomeSchema}.${nomeTabela}`;
  if (colunaAtualizacaoCache.has(chave)) return colunaAtualizacaoCache.get(chave);
  let resolvida;
  try {
    const r = await runQuery(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela
          AND COLUMN_NAME IN ('DT_ATUALIZACAO', 'DT_CRIACAO')`,
      [["esquema", sql.NVarChar(128), nomeSchema], ["tabela", sql.NVarChar(128), nomeTabela]]
    );
    const nomes = r.recordset.map((x) => x.COLUMN_NAME);
    // DT_CRIACAO é o padrão — é o nome confirmado em produção hoje para
    // a tabela atual, e o mais recente de qualquer forma. Se a checagem
    // não achar nenhuma das duas linhas, cair no nome ANTIGO (como
    // acontecia antes) travava a rota em erro consistente até o
    // processo reiniciar — o mesmo padrão observado nos relatos.
    resolvida = nomes.includes("DT_CRIACAO") ? "DT_CRIACAO"
      : nomes.includes("DT_ATUALIZACAO") ? "DT_ATUALIZACAO" : "DT_CRIACAO";
    if (!nomes.length) {
      console.warn(`[kaizens] INFORMATION_SCHEMA não encontrou DT_ATUALIZACAO nem DT_CRIACAO em ` +
        `${chave} — usando DT_CRIACAO como padrão (confirmado em produção).`);
    }
  } catch (err) {
    resolvida = "DT_CRIACAO";
    console.error(`[kaizens] erro ao resolver a coluna de atualização de ${chave} (usando DT_CRIACAO como padrão): ${err.message}`);
  }
  colunaAtualizacaoCache.set(chave, resolvida);
  console.log(`[kaizens] coluna de data de atualização em [${nomeSchema}].[${nomeTabela}]: ${resolvida}.`);
  return resolvida;
}
const colunaAtualizacaoPvc = () => colunaAtualizacaoDe(DB_SCHEMA, DB_PVC_TABLE);
const colunaAtualizacaoHist = () => colunaAtualizacaoDe(DB_SCHEMA, DB_HIST_PVC_TABLE);

/* ── A fonte da BIBLIOTECA: atual + histórico ─────────────────────

   Tabela derivada com UNION ALL das duas. Usada no lugar do nome da
   tabela nas consultas da Biblioteca, que por isso não mudam de forma:
   continuam escrevendo `p.NM_KAIZEN`, `p.ID_STATUS` e o resto.

   UNION ALL, e não UNION: UNION elimina duplicatas, o que obriga o
   banco a ordenar o resultado inteiro das duas pontas antes de
   devolver a primeira linha. Não há duplicata a eliminar — são tabelas
   disjuntas —, então seria pagar uma ordenação de 12.000 linhas por
   nada.

   ORIGEM diz de qual tabela a linha veio. Não é enfeite: é o que
   permite ao detalhe e à gravação irem à tabela certa. Sem ela, editar
   um Kaizen histórico faria UPDATE na tabela atual, que não tem a
   linha — a gravação se perderia sem erro nenhum.

   As colunas são LISTADAS, nunca `*`: UNION ALL casa por POSIÇÃO, não
   por nome. Com `*` dos dois lados, uma coluna a mais em qualquer uma
   das tabelas desalinharia tudo em silêncio, e a Biblioteca passaria a
   mostrar o valor de uma coluna no lugar de outra.

   DS_COMPARA_META e DS_RESULTADO_ALCANCADO existem na histórica desde
   o começo; na atual dependem do ALTER TABLE. Os dois lados são
   resolvidos em tempo de execução para que o tipo e a ordem batam de
   qualquer jeito.

   DT_REFERENCIA sai calculada aqui, uma vez, para o filtro de ano e a
   ordenação da Biblioteca serem pela data de CRIAÇÃO do Kaizen — nunca
   a de conclusão, que é só um dado do próprio registro (ver correção
   de 29/09/2026: o filtro de ano e o card mostravam datas diferentes
   porque um usava DT_CRIACAO e o outro caía para DT_CONCLUSAO). No
   lado atual usa a coluna persistida quando ela existe (é indexável);
   na histórica é sempre a própria coluna de criação. */
/** `apenasOrigem` ("A" ou "H") restringe o resultado a UM lado só — e,
 *  mais importante, tira a OUTRA tabela do TEXTO do comando. Quando
 *  quem chama já sabe a origem (edição, PUT, upload de imagem), o SQL
 *  enviado ao banco não cita mais a tabela que não interessa: não é
 *  "o otimizador provavelmente descarta aquele ramo do UNION" — é o
 *  ramo nem existir no comando. Sem argumento, devolve o UNION ALL das
 *  duas, para quem precisa mesmo das duas (a listagem da Biblioteca,
 *  o resumo, o filtro de anos). */
async function fonteBiblioteca(apenasOrigem) {
  const colComparaMeta = await colunaDaComparacaoMeta();
  const temAlcancado = await temColunaDsResultado();
  const alcancadoAtual = temAlcancado ? "DS_RESULTADO_ALCANCADO" : "CAST(NULL AS VARCHAR(100))";
  const dataRefAtual = await expressaoDataReferencia("");
  // Nome real em CADA tabela — pode não ser mais "DT_ATUALIZACAO" em
  // nenhuma das duas (ver colunaAtualizacaoDe; resolvidas
  // independentemente, uma renomeação não implica a outra). Exposto
  // sempre com o MESMO nome lógico "DT_ATUALIZACAO" no resultado da
  // fonte unificada (o alias abaixo), então nenhum código que lê
  // `p.DT_ATUALIZACAO` a partir daqui precisa saber ou mudar por causa
  // disso.
  const colAtualizacaoAtual = await colunaAtualizacaoPvc();
  const colAtualizacaoHist = await colunaAtualizacaoHist();

  const bloco = (origem, compara, alcancado, dataRef, tabela, colAtualizacao) => `
    SELECT ORIGEM = ${origem},
           ID_KAIZEN, NM_KAIZEN, ID_STATUS, ID_CATEGORIA, ID_REPLICACAO, ID_APROVADOR,
           ID_USUARIO_CADASTRO, ID_USUARIO_LIDER, ID_USUARIO_ATUALIZACAO,
           DS_PROBLEMA, DS_OBJETIVO, DS_ESTADO_ANTES, DS_ESTADO_DEPOIS, URL_REFERENCIA,
           DS_LICOES_APRENDIDAS,
           DS_COMPARA_META = ${compara},
           DS_RESULTADO_ALCANCADO = ${alcancado},
           VL_RESULTADO_FINANCEIRO, ID_MOEDA, DT_CONCLUSAO, DT_ATUALIZACAO = ${colAtualizacao}, DS_MOTIVO,
           URL_IMG_ANTES, URL_IMG_DEPOIS,
           DT_REFERENCIA = ${dataRef}
      FROM ${tabela}`;

  const ladoAtual = bloco("'A'", colComparaMeta, alcancadoAtual, dataRefAtual, FULL_PVC_TABLE, colAtualizacaoAtual);
  const ladoHist = bloco("'H'", "DS_COMPARA_META", "DS_RESULTADO_ALCANCADO",
    colAtualizacaoHist, FULL_HIST_PVC_TABLE, colAtualizacaoHist);

  if (apenasOrigem === "A") return `(${ladoAtual})`;
  if (apenasOrigem === "H") return `(${ladoHist})`;
  return `(${ladoAtual}\n    UNION ALL\n    ${ladoHist})`;
}

/* Em qual tabela mora este ID_KAIZEN? Devolve "A", "H" ou null.

   O ID é único dentro de cada tabela, mas as duas são carregadas por
   caminhos diferentes e nada no banco impede o mesmo número nas duas.
   Quando isso acontece a atual ganha — é a que ainda recebe gravação —
   e o caso fica registrado no log, porque é defeito de carga e não
   situação normal. */
async function origemDoKaizen(idKaizen) {
  const r = await runQuery(
    `SELECT ORIGEM = 'A' FROM ${FULL_PVC_TABLE} WHERE ID_KAIZEN = @idKaizen
     UNION ALL
     SELECT ORIGEM = 'H' FROM ${FULL_HIST_PVC_TABLE} WHERE ID_KAIZEN = @idKaizen`,
    [["idKaizen", sql.Int, idKaizen]]
  );
  if (r.recordset.length > 1) {
    console.warn(`[historico] ID_KAIZEN=${idKaizen} existe nas DUAS tabelas — ` +
      "a atual prevalece. Confira a carga do histórico: IDs não deveriam colidir.");
    return "A";
  }
  return r.recordset.length ? r.recordset[0].ORIGEM : null;
}

/** Troca por completo os vínculos Kaizen ↔ Resultado, dentro da
 *  transação de quem chamou. Um só caminho para o cadastro e para a
 *  edição: no cadastro a lista chega vazia do banco e só há INSERT; na
 *  edição o DELETE tira o que havia. É o mesmo padrão que membros e
 *  desperdícios já usam — some tudo, entra o que veio da tela.
 *
 *  `ids` pode trazer nulos (bloco desligado) e repetidos (a mesma linha
 *  do catálogo escolhida nos dois blocos, se um dia isso for possível);
 *  os dois são filtrados aqui, e não em cada chamador. */
async function gravarResultadosDoKaizen(tx, idKaizen, ids, tabela) {
  // Sem tabela informada, a atual — é o caminho do cadastro novo.
  const alvo = tabela || FULL_RESULTADO_KAIZEN_TABLE;
  const reqDel = new sql.Request(tx);
  reqDel.input("idKaizen", sql.Int, idKaizen);
  await reqDel.query(`DELETE FROM ${alvo} WHERE ID_KAIZEN = @idKaizen`);

  const unicos = [...new Set((ids || []).filter((x) => Number.isInteger(x)))];
  for (const idResultado of unicos) {
    const req = new sql.Request(tx);
    req.input("idKaizen", sql.Int, idKaizen);
    req.input("idResultado", sql.Int, idResultado);
    await req.query(
      `INSERT INTO ${alvo} (ID_KAIZEN, ID_RESULTADO, DT_ATUALIZACAO)
       VALUES (@idKaizen, @idResultado, ${AGORA_BRASILIA})`
    );
  }
  return unicos.length;
}

async function expressaoDataReferencia(prefixo) {
  const p = prefixo ? `${prefixo}.` : "";
  if (colunaReferenciaExiste === null) {
    try {
      const r = await runQuery(
        `SELECT 1 AS OK FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @tabela AND COLUMN_NAME = 'DT_REFERENCIA'`,
        [["esquema", sql.NVarChar(128), DB_SCHEMA], ["tabela", sql.NVarChar(128), DB_PVC_TABLE]]
      );
      colunaReferenciaExiste = r.recordset.length > 0;
      console.log(`[kaizens] DT_REFERENCIA ${colunaReferenciaExiste ? "disponível" : "ausente"} — ` +
        `ordenação ${colunaReferenciaExiste ? "por índice" : "pela expressão (rode database/otimizacao_indices.sql)"}`);
    } catch (err) {
      colunaReferenciaExiste = false;
    }
  }
  if (colunaReferenciaExiste) return `${p}DT_REFERENCIA`;
  // Sem DT_REFERENCIA, cai para a própria coluna de criação — e o nome
  // real dela na PVC pode não ser mais DT_ATUALIZACAO (ver
  // colunaAtualizacaoPvc). Só chamado com o lado ATUAL (fonteBiblioteca
  // nunca pede este fallback para o histórico).
  const colAtualizacao = await colunaAtualizacaoPvc();
  return `${p}${colAtualizacao}`;
}

const limiteColunaCache = new Map();
async function limiteDaColuna(coluna, padraoDER) {
  if (limiteColunaCache.has(coluna)) return limiteColunaCache.get(coluna);
  let limite = padraoDER;
  try {
    const r = await runQuery(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS TAM FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @tabela AND COLUMN_NAME = @coluna`,
      [["schema", sql.NVarChar(128), DB_SCHEMA], ["tabela", sql.NVarChar(128), DB_PVC_TABLE],
       ["coluna", sql.NVarChar(128), coluna]]
    );
    const tam = r.recordset.length ? r.recordset[0].TAM : null;
    // -1 = VARCHAR(MAX): sem limite prático, vale o do DER.
    if (tam > 0) limite = tam;
  } catch (err) {
    console.error(`[limite] não foi possível ler o tamanho de ${coluna}:`, err.message);
  }
  limiteColunaCache.set(coluna, limite);
  return limite;
}
const limiteDsMotivo = () => limiteDaColuna("DS_MOTIVO", PVC_LIMITES.DS_MOTIVO);
const limiteNmKaizen = () => limiteDaColuna("NM_KAIZEN", PVC_LIMITES.NM_KAIZEN);

/** ID_STATUS do "Revisado", conferido no banco antes de ser usado.
 *
 *  O número 5 vem da regra de negócio, mas não é confiado de olho
 *  fechado: a linha tem de existir, estar ATIVA e ter o nome de
 *  "Revisado" em algum idioma. Assim, se alguém desativar ou renomear
 *  esse status no cadastro, a edição recusa com mensagem clara em vez
 *  de carimbar um status que não significa mais o que se espera.
 *
 *  Nunca vem do navegador — o front não manda ID_STATUS. */
const ID_STATUS_REVISADO = 5;
const NOMES_REVISADO = ["Revisado", "Revisada", "Em revisão", "Reviewed", "Revised"];

async function idStatusRevisado() {
  const r = await runQuery(
    `SELECT ID_STATUS, NM_STATUS, SG_ATIVO FROM ${FULL_STATUS_TABLE}
      WHERE ID_STATUS = @id`,
    [["id", sql.Int, ID_STATUS_REVISADO]]
  );
  if (!r.recordset.length) {
    return { erro: `Status ${ID_STATUS_REVISADO} ("Revisado") não está cadastrado em Administração > Status Kaizen.` };
  }
  const ativos = r.recordset.filter((x) => ehAtivo(x.SG_ATIVO));
  if (!ativos.length) {
    return { erro: `Status ${ID_STATUS_REVISADO} ("Revisado") está inativo em Administração > Status Kaizen.` };
  }
  const alvo = NOMES_REVISADO.map(semAcento);
  if (!ativos.some((x) => alvo.includes(semAcento(x.NM_STATUS)))) {
    return {
      erro: `Status ${ID_STATUS_REVISADO} existe, mas está cadastrado como "${ativos[0].NM_STATUS}" — esperado "Revisado".`,
    };
  }
  return { id: ID_STATUS_REVISADO };
}

/** Já existe OUTRO Kaizen com este nome?
 *
 *  Compara sem maiúsculas, sem acento e sem espaço sobrando — a mesma
 *  normalização que a busca da Biblioteca usa, para "Reduzir  Setup" e
 *  "reduzir setup" não virarem dois cadastros.
 *
 *  `idIgnorar` existe para a EDIÇÃO: ao atualizar, o próprio registro
 *  não pode ser tratado como duplicata de si mesmo. */
// Líder do Projeto: funcionário Vale (ID_TIPO_USUARIO = 1) ATIVO no MDM.
async function ehValeAtivo(idUsuario) {
  if (!Number.isInteger(idUsuario)) return false;
  const r = await runQuery(
    `SELECT TOP (1) 1 AS OK FROM ${FULL_MDM_TABLE}
      WHERE ID_USUARIO = @id AND ID_TIPO_USUARIO = 1 AND SG_ATIVO = 'A'`,
    [["id", sql.Int, idUsuario]]
  );
  return r.recordset.length > 0;
}
const ERRO_LIDER_VALE = "O Líder do Projeto deve ser um funcionário Vale ativo.";

async function existeKaizenComMesmoNome(nome, idIgnorar, origem) {
  const alvo = String(nome || "").trim().replace(/\s+/g, " ");
  if (!alvo) return false;
  // Unicidade dentro da ORIGEM: um Kaizen histórico não bloqueia o nome
  // de um atual, e vice-versa — são cadastros de épocas diferentes.
  const tabela = tabelasDaOrigem(origem || "A").pvc;
  // A comparação acontece no banco, parametrizada: COLLATE ..._CI_AI
  // ignora maiúsculas (CI) e acento (AI), a mesma indiferença que a
  // busca da Biblioteca aplica no navegador. O REPLACE aninhado colapsa
  // espaço repetido, para "Reduzir  setup" não virar um cadastro novo.
  //
  // @idIgnorar é o registro EM EDIÇÃO: ele nunca pode ser duplicata de
  // si mesmo. Nulo (cadastro novo) faz a condição sair da conta.
  const semEspacoDuplo = (col) =>
    `REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(${col})), ' ', '<>'), '><', ''), '<>', ' ')`;
  const r = await runQuery(
    `SELECT TOP (1) ID_KAIZEN FROM ${tabela}
      WHERE ${semEspacoDuplo("NM_KAIZEN")} COLLATE Latin1_General_CI_AI = @nome COLLATE Latin1_General_CI_AI
        AND (@idIgnorar IS NULL OR ID_KAIZEN <> @idIgnorar)`,
    [["nome", sql.NVarChar(PVC_LIMITES.NM_KAIZEN), alvo],
     ["idIgnorar", sql.Int, Number.isInteger(idIgnorar) ? idIgnorar : null]]
  );
  return r.recordset.length > 0;
}

/** Leitura e validação do corpo do formulário de Kaizen.
 *
 *  Estava dentro do POST /kaizens. Virou função porque a edição (PUT)
 *  precisa das MESMAS regras: se cada rota lesse o corpo do seu jeito,
 *  um limite corrigido em uma delas passaria batido na outra.
 *  Não decide nada de permissão nem toca no banco — só lê e valida. */
function lerKaizenDoCorpo(b) {

  const obrigatorio = (valor, rotulo) =>
    valor == null || String(valor).trim() === "" ? `${rotulo} é obrigatório.` : null;
  const maxLen = (valor, max, rotulo) =>
    valor != null && String(valor).length > max ? `${rotulo} deve ter no máximo ${max} caracteres.` : null;
  const textoOuNuloLocal = (valor) => {
    if (valor == null) return null;
    const limpo = String(valor).trim();
    return limpo === "" ? null : limpo;
  };
  const intOuNulo = (valor) => (valor === "" || valor == null ? null : parseInt(valor, 10));

  const titulo = String(b.titulo || "").trim();
  const declaracaoProblema = String(b.declaracao_problema || "").trim();
  const metaObjetivo = String(b.meta_objetivo || "").trim();
  const descricaoAntes = String(b.descricao_antes || "").trim();
  const descricaoDepois = String(b.descricao_depois || "").trim();
  const idCategoria = intOuNulo(b.id_categoria);
  const idReplicacao = intOuNulo(b.id_replicacao);
  const idTipoKaizen = intOuNulo(b.id_tipo_kaizen);
  const idUsuarioAprovador = intOuNulo(b.id_usuario_aprovador);
  const idUsuarioLider = intOuNulo(b.id_usuario_lider); // opcional: sem escolha, usa quem está logado
  // Desperdícios: seleção múltipla (ver FULL_KZ_DESPERDICIO_TABLE
  // acima) — a lista vai inteira para kzn_kaizen_desperdicio, e a PVC
  // não guarda desperdício nenhum.
  const idsDesperdicio = Array.isArray(b.ids_desperdicio)
    ? [...new Set(b.ids_desperdicio.map((v) => parseInt(v, 10)).filter((n) => Number.isInteger(n)))]
    : [];
  const urlImgAntes = textoOuNuloLocal(b.url_imagem_antes);
  const urlImgDepois = textoOuNuloLocal(b.url_imagem_depois);
  const urlReferencia = textoOuNuloLocal(b.links_documentos);
  const sgGm = String(b.sg_gm || "").trim().toUpperCase();
  const urlGm = textoOuNuloLocal(b.url_gm);
  const licoesAprendidas = textoOuNuloLocal(b.licoes_aprendidas);
  const comparacaoMeta = textoOuNuloLocal(b.comparacao_meta_inicial);

  // Data de Conclusão — coluna DT_CONCLUSAO, do tipo DATE. Chega como
  // "YYYY-MM-DD" (o formato que o <input type="date"> envia) e é
  // comparada como TEXTO: nesse formato a ordem alfabética é a ordem
  // cronológica, então não há Date, fuso nem hora no meio do caminho
  // para distorcer a conta. Campo OBRIGATÓRIO — a tela também cobra, mas
  // quem decide é aqui: uma requisição montada fora da tela não pode
  // gravar Kaizen sem data de conclusão.
  const dataConclusao = textoOuNuloLocal(b.data_conclusao);
  const formatoDataOk = dataConclusao == null || /^\d{4}-\d{2}-\d{2}$/.test(dataConclusao);
  // Data que existe no calendário: "2026-02-31" passa no formato acima
  // mas não é dia nenhum, e o SQL Server recusaria na conversão.
  const dataExiste = formatoDataOk && dataConclusao != null
    ? somenteData(new Date(dataConclusao + "T00:00:00Z")) === dataConclusao
    : true;
  const dataAnteriorAHoje = dataConclusao == null || dataConclusao < hojeEmBrasilia();

  // "Tipo de Resultado Financeiro" (Saving/Cost Avoided) continua só na
  // tela — não há coluna no DER para essa classificação. Moeda e Valor
  // são gravados normalmente quando o bloco "Resultado Financeiro" está
  // ativo.
  const geraResultadoFinanceiro = b.fl_resultado_financeiro === true || b.fl_resultado_financeiro === "true";
  const idMoeda = geraResultadoFinanceiro ? intOuNulo(b.id_moeda) : null;
  const valorResultadoFinanceiro =
    geraResultadoFinanceiro && b.valor_resultado_financeiro !== "" && b.valor_resultado_financeiro != null
      ? Number(b.valor_resultado_financeiro)
      : null;

  // Os dois combos de resultado carregam um ID_RESULTADO do CATÁLOGO
  // (kzn_resultados), separados por ID_TIPO_RESULTADO: 1 = financeiro,
  // 2 = outros. Cada um escolhido vira UMA linha em
  // kzn_resultado_kaizen — o vínculo Kaizen ↔ Resultado.
  //
  // Antes o campo se chamava id_tipo_resultado_outros e carregava um
  // ID_TIPO_RESULTADO, porque o combo lia da tabela de CLASSIFICAÇÃO.
  // O nome antigo continua aceito para não quebrar uma tela que ainda
  // não tenha sido atualizada em cache.
  const geraResultadoOutros = b.fl_resultado_outros === true || b.fl_resultado_outros === "true";
  const idResultadoOutros = geraResultadoOutros
    ? intOuNulo(b.id_resultado_outros != null && b.id_resultado_outros !== "" ? b.id_resultado_outros : b.id_tipo_resultado_outros)
    : null;
  const idResultadoFinanceiro = geraResultadoFinanceiro ? intOuNulo(b.id_resultado_financeiro) : null;
  const descricaoResultadoOutros = geraResultadoOutros ? textoOuNuloLocal(b.descricao_resultado_outros) : null;

  // Membros da equipe (Vale + externos): ambos são só um ID_USUARIO do
  // MDM — ver nota em FULL_MEMBROS_TABLE acima. Dedupe por segurança
  // (mesma pessoa marcada duas vezes não deve virar 2 linhas na
  // junção, que tem PK composta ID_KAIZEN+ID_USUARIO).
  const membros = Array.isArray(b.membros)
    ? [...new Set(b.membros.map((v) => parseInt(v, 10)).filter((n) => Number.isInteger(n)))]
    : [];

  const erros = [
    obrigatorio(titulo, "Título do Kaizen"),
    maxLen(titulo, PVC_LIMITES.NM_KAIZEN, "Título do Kaizen"),
    obrigatorio(declaracaoProblema, "Descrição do Problema"),
    maxLen(declaracaoProblema, PVC_LIMITES.DS_PROBLEMA, "Descrição do Problema"),
    obrigatorio(metaObjetivo, "Meta / Objetivo"),
    maxLen(metaObjetivo, PVC_LIMITES.DS_OBJETIVO, "Meta / Objetivo"),
    obrigatorio(descricaoAntes, "Descrição do Antes"),
    maxLen(descricaoAntes, PVC_LIMITES.DS_ESTADO_ANTES, "Descrição do Antes"),
    obrigatorio(descricaoDepois, "Descrição do Depois"),
    maxLen(descricaoDepois, PVC_LIMITES.DS_ESTADO_DEPOIS, "Descrição do Depois"),
    Number.isInteger(idCategoria) ? null : "Categoria é obrigatória.",
    Number.isInteger(idUsuarioAprovador) ? null : "Aprovador é obrigatório.",
    maxLen(urlReferencia, PVC_LIMITES.URL_REFERENCIA, "Links / Documentos"),
    maxLen(licoesAprendidas, PVC_LIMITES.DS_LICOES_APRENDIDAS, "Lições Aprendidas"),
    maxLen(comparacaoMeta, PVC_LIMITES.DS_COMPARA_META, "Comparação com a meta inicial"),
    // Mensagem escrita à mão em vez de obrigatorio(): o helper monta
    // "<campo> é obrigatório", que erra o gênero de "Data".
    !dataConclusao ? "Data de Conclusão é obrigatória." : null,
    !formatoDataOk || !dataExiste ? "Data de Conclusão inválida." : null,
    formatoDataOk && dataExiste && !dataAnteriorAHoje
      ? "A Data de Conclusão deve ser anterior à data de hoje." : null,
    geraResultadoOutros && !Number.isInteger(idResultadoOutros) ? "Resultado (Outros) é obrigatório quando o bloco está ativo." : null,
    geraResultadoFinanceiro && !Number.isInteger(idResultadoFinanceiro) ? "Resultado (Financeiro) é obrigatório quando o bloco está ativo." : null,
    geraResultadoOutros && !descricaoResultadoOutros ? "Descrição dos Resultados Alcançados é obrigatória quando \"Outros\" está ativo." : null,
    maxLen(descricaoResultadoOutros, 100, "Descrição dos Resultados Alcançados"),
  ].filter(Boolean);
  return { erros, dados: { idTipoKaizen, sgGm, urlGm, titulo, declaracaoProblema, metaObjetivo, descricaoAntes, descricaoDepois, idCategoria, idReplicacao, idUsuarioAprovador, idUsuarioLider, idsDesperdicio, urlImgAntes, urlImgDepois, urlReferencia, licoesAprendidas, comparacaoMeta, dataConclusao, geraResultadoFinanceiro, idMoeda, valorResultadoFinanceiro, geraResultadoOutros, idResultadoOutros, idResultadoFinanceiro, descricaoResultadoOutros, membros } };
}

apiRouter.post("/kaizens", async (req, res) => {
  const b = req.body || {};
  const { erros, dados } = lerKaizenDoCorpo(b);
  if (erros.length) return res.status(400).json({ error: erros[0], erros });
  const { idTipoKaizen, sgGm, urlGm, titulo, declaracaoProblema, metaObjetivo, descricaoAntes, descricaoDepois, idCategoria, idReplicacao, idUsuarioAprovador, idUsuarioLider, idsDesperdicio, urlImgAntes, urlImgDepois, urlReferencia, licoesAprendidas, comparacaoMeta, dataConclusao, geraResultadoFinanceiro, idMoeda, valorResultadoFinanceiro, geraResultadoOutros, idResultadoOutros, idResultadoFinanceiro, descricaoResultadoOutros, membros } = dados;

  try {
    // Título contra o tamanho REAL da coluna: enquanto o ALTER de 30
    // para 100 não rodar, um título longo daria erro de truncamento do
    // SQL Server na cara do usuário. Aqui vira recusa explicada.
    const maxTitulo = await limiteNmKaizen();
    if (titulo.length > maxTitulo) {
      return res.status(400).json({ error: `Título do Kaizen deve ter no máximo ${maxTitulo} caracteres.` });
    }

    // Quem está criando, sempre pelo servidor (X-Forwarded-Email) —
    // nunca aceito do corpo da requisição (ver idUsuarioLogado acima).
    // Duplicidade pelo NOME — só no cadastro novo. Na edição o próprio
    // registro seria a "duplicata", e bloquear a atualização por causa
    // disso é justamente o que não pode acontecer (ver PUT abaixo).
    if (await existeKaizenComMesmoNome(titulo, null)) {
      return res.status(409).json({ error: "Já existe um Kaizen cadastrado com este nome." });
    }

    const idUsuarioCadastro = await idUsuarioLogado(req);
    const idLider = idUsuarioLider || idUsuarioCadastro;
    if (!idLider) {
      return res.status(400).json({
        error: "Não foi possível identificar o líder do projeto (nem escolhido na busca, nem o usuário logado).",
      });
    }
    if (!(await ehValeAtivo(idLider))) return res.status(400).json({ error: ERRO_LIDER_VALE });

    const idAprovador = await idAprovadorPorUsuario(idUsuarioAprovador);
    if (idAprovador == null) {
      return res.status(400).json({ error: "O usuário escolhido como aprovador não está ativo em kzn_aprovador." });
    }

    const tipo = await conferirTipoKaizen(DB_PVC_TABLE, idTipoKaizen);
    if (tipo.erro) return res.status(400).json({ error: tipo.erro });
    const gm = await conferirGestaoMudanca(DB_PVC_TABLE, sgGm, urlGm);
    if (gm.erro) return res.status(400).json({ error: gm.erro });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // ID_KAIZEN não é identity (mesmo padrão das outras tabelas deste
      // banco — ver ISNULL(MAX(pk),0)+1 em registrarCadastroBilingue).
      // Dentro da transação para não colidir com outro POST simultâneo.
      const proximo = await new sql.Request(tx).query(
        `SELECT ISNULL(MAX(ID_KAIZEN), 0) + 1 AS PROXIMO FROM ${FULL_PVC_TABLE}`
      );
      const idKaizen = proximo.recordset[0].PROXIMO;

      // Agora que o ID_KAIZEN existe, as fotos ganham o nome definitivo
      // ("<ID>.<ext>", nas pastas 01 - Antes / 02 - Depois). Acontece
      // ANTES do INSERT para o banco já nascer apontando para o caminho
      // final — nunca para o provisório. É I/O no armazenamento dentro
      // da transação, que fica aberta um pouco mais; em troca não existe
      // o estado intermediário "linha gravada apontando para arquivo que
      // vai sumir". Se o armazenamento falhar, o caminho original é
      // mantido e o cadastro segue (ver renomearImagemParaId).
      const nomeadas = await nomearImagensDoKaizen({
        novoAntes: urlImgAntes,
        novoDepois: urlImgDepois,
        idKaizen,
      });
      const caminhoAntes = nomeadas.antes;
      const caminhoDepois = nomeadas.depois;

      const reqInsert = new sql.Request(tx);
      reqInsert.input("idKaizen", sql.Int, idKaizen);
      reqInsert.input("idUsuarioCadastro", sql.Int, idUsuarioCadastro ?? null);
      reqInsert.input("idUsuarioLider", sql.Int, idLider);
      reqInsert.input("nmKaizen", sql.NVarChar(maxTitulo), titulo);
      reqInsert.input("idCategoria", sql.Int, idCategoria);
      reqInsert.input("idReplicacao", sql.Int, idReplicacao);
      if (tipo.grava) reqInsert.input("idTipoKaizen", sql.Int, idTipoKaizen);
      if (gm.grava) {
        reqInsert.input("sgGm", sql.Char(1), sgGm);
        reqInsert.input("urlGm", sql.NVarChar(PVC_LIMITES.URL_GM), gm.url);
      }
      reqInsert.input("dsProblema", sql.NVarChar(PVC_LIMITES.DS_PROBLEMA), declaracaoProblema);
      reqInsert.input("dsObjetivo", sql.NVarChar(PVC_LIMITES.DS_OBJETIVO), metaObjetivo);
      // ID_STATUS só entra no comando quando há catálogo configurado;
      // sem ele a coluna nem é citada, e o Kaizen nasce sem status em vez
      // de com um número inventado.
      // Prioridade: a variável de ambiente; sem ela, busca pelo nome no
      // cadastro. Só fica sem status se nem o nome existir em kzn_status.
      const idStatusNovo = await idDoStatus("emAprovacao");
      const gravaStatus = idStatusNovo != null;
      if (gravaStatus) reqInsert.input("idStatus", sql.Int, idStatusNovo);
      reqInsert.input("idAprovador", sql.Int, idAprovador);
      reqInsert.input("urlImgAntes", sql.NVarChar(PVC_LIMITES.URL_IMG), caminhoAntes);
      reqInsert.input("dsEstadoAntes", sql.NVarChar(PVC_LIMITES.DS_ESTADO_ANTES), descricaoAntes);
      reqInsert.input("urlImgDepois", sql.NVarChar(PVC_LIMITES.URL_IMG), caminhoDepois);
      reqInsert.input("dsEstadoDepois", sql.NVarChar(PVC_LIMITES.DS_ESTADO_DEPOIS), descricaoDepois);
      reqInsert.input("urlReferencia", sql.NVarChar(PVC_LIMITES.URL_REFERENCIA), urlReferencia);
      reqInsert.input("dsLicoes", sql.NVarChar(PVC_LIMITES.DS_LICOES_APRENDIDAS), licoesAprendidas);
      reqInsert.input("vlResultado", sql.Decimal(18, 2), valorResultadoFinanceiro);
      reqInsert.input("idMoeda", sql.Int, idMoeda);
      // A Comparação com a Meta vai para DS_COMPARA_META, ou para
      // DS_RESULTADO_ESPERADO enquanto a coluna nova não existir. O
      // parâmetro é o mesmo; só o NOME DA COLUNA muda.
      const colComparaMeta = await colunaDaComparacaoMeta();
      reqInsert.input("dsComparaMeta", sql.NVarChar(PVC_LIMITES.DS_COMPARA_META), comparacaoMeta);
      // Coluna nova: só entra no comando se existir no banco (ver
      // temColunaDsResultado). Sem ela, o Kaizen grava igual e o log diz
      // por que a descrição ficou de fora.
      const gravaDsResultado = await temColunaDsResultado();
      if (gravaDsResultado) reqInsert.input("dsResultado", sql.NVarChar(100), descricaoResultadoOutros);
      // DT_CONCLUSAO é DATE. Vai como TEXTO "YYYY-MM-DD" e a conversão
      // fica com o banco (CONVERT ... 23), em vez de montar um Date no
      // Node: assim não há fuso no meio para empurrar a data um dia
      // para trás ou para frente. Só data, nunca hora.
      reqInsert.input("dtConclusao", sql.VarChar(10), dataConclusao);
      // Nome real da coluna de atualização — pode não ser mais
      // DT_ATUALIZACAO (ver colunaAtualizacaoPvc).
      const colAtualizacaoPvc = await colunaAtualizacaoPvc();

      await reqInsert.query(`
        INSERT INTO ${FULL_PVC_TABLE}
          (ID_KAIZEN, ID_USUARIO_CADASTRO, ID_USUARIO_LIDER, NM_KAIZEN, ID_CATEGORIA, ID_REPLICACAO,
           DS_PROBLEMA, DS_OBJETIVO,${gravaStatus ? " ID_STATUS," : ""} ID_APROVADOR, URL_IMG_ANTES, DS_ESTADO_ANTES,
           URL_IMG_DEPOIS, DS_ESTADO_DEPOIS, URL_REFERENCIA, DS_LICOES_APRENDIDAS,
           VL_RESULTADO_FINANCEIRO, ID_MOEDA, ${colComparaMeta},${gravaDsResultado ? " DS_RESULTADO_ALCANCADO," : ""} DT_CONCLUSAO, ${colAtualizacaoPvc},
           ID_USUARIO_ATUALIZACAO${tipo.grava ? ", ID_TIPO_KAIZEN" : ""}${gm.grava ? ", SG_GM, URL_GM" : ""})
        VALUES
          (@idKaizen, @idUsuarioCadastro, @idUsuarioLider, @nmKaizen, @idCategoria, @idReplicacao,
           @dsProblema, @dsObjetivo,${gravaStatus ? " @idStatus," : ""} @idAprovador, @urlImgAntes, @dsEstadoAntes,
           @urlImgDepois, @dsEstadoDepois, @urlReferencia, @dsLicoes,
           @vlResultado, @idMoeda, @dsComparaMeta,${gravaDsResultado ? " @dsResultado," : ""} CONVERT(DATE, @dtConclusao, 23), ${AGORA_BRASILIA},
           @idUsuarioCadastro${tipo.grava ? ", @idTipoKaizen" : ""}${gm.grava ? ", @sgGm, @urlGm" : ""})`);

      for (const idMembro of membros) {
        const reqM = new sql.Request(tx);
        reqM.input("idKaizen", sql.Int, idKaizen);
        reqM.input("idUsuario", sql.Int, idMembro);
        await reqM.query(
          `INSERT INTO ${FULL_MEMBROS_TABLE} (ID_KAIZEN, ID_USUARIO, DT_ATUALIZACAO)
           VALUES (@idKaizen, @idUsuario, ${AGORA_BRASILIA})`
        );
      }

      for (const idDesp of idsDesperdicio) {
        const reqD = new sql.Request(tx);
        reqD.input("idKaizen", sql.Int, idKaizen);
        reqD.input("idDesperdicio", sql.Int, idDesp);
        await reqD.query(
          `INSERT INTO ${FULL_KZ_DESPERDICIO_TABLE} (ID_KAIZEN, ID_DESPERDICIO, DT_ATUALIZACAO)
           VALUES (@idKaizen, @idDesperdicio, ${AGORA_BRASILIA})`
        );
      }

      // Vínculo Kaizen ↔ Resultado do CATÁLOGO, um por bloco ativo.
      //
      // O que havia aqui antes INSERIA UMA LINHA NOVA em kzn_resultados
      // (ID = MAX + 1, nos dois idiomas) usando a descrição como nome.
      // Três consequências: o catálogo crescia um registro por Kaizen,
      // o que o usuário ESCOLHEU no combo não era gravado como escolha
      // (ia para ID_TIPO_RESULTADO da linha nova), e reabrir o Kaizen
      // não devolvia a seleção. O catálogo agora é só lido.
      await gravarResultadosDoKaizen(tx, idKaizen, [
        geraResultadoFinanceiro ? idResultadoFinanceiro : null,
        geraResultadoOutros ? idResultadoOutros : null,
      ]);

      await tx.commit();

      // Fotografia da hierarquia do líder. Lê o ID_USUARIO_LIDER da
      // linha que acabou de ser gravada, não da variável daqui. Depois
      // do commit, pelo mesmo motivo dos comunicados abaixo — e porque a
      // FK de kzn_kaizen_hierarquia exige o Kaizen já gravado.
      await gravarHierarquiaDoKaizen(idKaizen);

      // Só depois do commit: antes disso o Kaizen ainda pode sumir no
      // rollback, e comunicar um cadastro que não existe é pior do que
      // não comunicar. Os comunicados vão MONTADOS na resposta; quem
      // entrega ao Graph é a tela, com o token de quem está logado
      // (ver js/envio-email.js).
      const avisos = await avisosDoCadastro(idKaizen, idUsuarioCadastro);
      res.status(201).json({ ok: true, ID_KAIZEN: idKaizen, ID_STATUS: idStatusNovo, AVISOS: avisos });
    } catch (errTx) {
      await tx.rollback().catch(() => {});
      throw errTx;
    }
  } catch (err) {
    console.error("[kaizens] erro ao criar:", err.message);
    // A mensagem "não está cadastrado nos dois idiomas" é dos cadastros
    // bilíngues (FK composta id+idioma) — não se aplica aqui, as FKs de
    // kzn_pedravisaoconsolidada são de coluna única. Em erro de FK (547),
    // mostra o texto cru do SQL Server: ele já cita o nome da constraint,
    // então dá pra saber exatamente qual campo (categoria, aprovador,
    // moeda, líder...) tem o ID inválido.
    res.status(err.number === 547 ? 409 : 500).json({ error: "Erro ao criar o Kaizen: " + err.message });
  }
});

// ------------------------------------------------------------------
// Biblioteca (biblioteca.html) — lista/detalhe/resumo de Kaizens já
// gravados. Antes era tudo mock estático no HTML; agora lê direto de
// kzn_pedravisaoconsolidada + as tabelas relacionadas.
// ------------------------------------------------------------------

// Monta o rótulo curto de ID mostrado nos cards: "KZN26-041" (2 últimos
// dígitos do ano de criação + ID_KAIZEN com 3 dígitos). Não existe
// coluna própria pra isso no DER — é só formatação de exibição.
function rotuloIdKaizen(idKaizen, dtCriacao) {
  // getUTCFullYear, não getFullYear: os componentes UTC do Date são o
  // relógio que está na coluna (ver relogioLocal). getFullYear usaria o
  // fuso do processo Node — hoje UTC, o que dava no mesmo por acaso,
  // mas bastaria definir TZ no app.yaml para o rótulo passar a errar o
  // ano nos Kaizens criados na virada.
  const ano = dtCriacao ? new Date(dtCriacao).getUTCFullYear() : new Date().getUTCFullYear();
  return `KZN${String(ano).slice(-2)}-${String(idKaizen).padStart(3, "0")}`;
}

// GET /kaizens — lista pra grade/tabela da Biblioteca. Filtros por
// querystring, TODOS opcionais: status, categoria (ID_CATEGORIA),
// estado (NM_ESTADO do líder, usado como "unidade" na tela), ano,
// q (busca por título/líder/ID).
//
// Sem ?status a rota devolve TODOS os Kaizens, de qualquer status.
// Antes o padrão era APROVADO, e a Biblioteca — única consumidora desta
// rota — nunca mandava o parâmetro: na prática os Kaizens em aprovação,
// reprovados e em rascunho não apareciam em lugar nenhum. O filtro de
// status virou escolha da tela, não um padrão escondido aqui.
apiRouter.get("/kaizens", async (req, res) => {
  try {
    const idIdioma = idIdiomaDaRequisicao(req);
    // Unidade, categoria, status e ano aceitam MÚLTIPLOS valores — um
    // parâmetro só, separado por vírgula (?status=3,5,6). Lista vazia é
    // "filtro não aplicado", igual ao null de antes.
    const idsStatus = listaIntOuVaziaGlobal(req.query.status);
    const idsCategoria = listaIntOuVaziaGlobal(req.query.categoria);
    const estado = textoOuNuloGlobal(req.query.estado);
    const sites = listaTextoOuVaziaGlobal(req.query.site);
    const lider = textoOuNuloGlobal(req.query.lider);
    const anos = listaIntOuVaziaGlobal(req.query.ano);
    const q = textoOuNuloGlobal(req.query.q);
    // Ordenação escolhida no menu da Biblioteca (?ordem=). Lista fechada:
    // o valor recebido só escolhe uma das expressões abaixo, nunca entra
    // no SQL. ID_KAIZEN no fim mantém a chave única da paginação.
    const ORDENACOES = {
      recentes: "p.ID_KAIZEN DESC",
      antigos: "p.ID_KAIZEN ASC",
      "nome-az": "p.NM_KAIZEN ASC, p.ID_KAIZEN DESC",
      "nome-za": "p.NM_KAIZEN DESC, p.ID_KAIZEN DESC",
    };
    const ordenacao = Object.hasOwn(ORDENACOES, String(req.query.ordem))
      ? ORDENACOES[req.query.ordem] : ORDENACOES.recentes;

    // Paginação no SERVIDOR. Antes a rota devolvia a tabela inteira e a
    // tela mostrava 6 por vez — com 2.000 Kaizens eram 1,1 MB de JSON
    // por abertura para desenhar 3,5 KB. O teto de 100 existe para que
    // um ?tamanho= grande na URL não recrie o problema.
    const pagina = Math.max(0, intOuNuloGlobal(req.query.pagina) || 0);
    const tamanho = Math.min(100, Math.max(1, intOuNuloGlobal(req.query.tamanho) || 24));
    // A Biblioteca lê atual + histórico. DT_REFERENCIA já vem pronta da
    // fonte unificada, então aqui é só a coluna — não mais a expressão.
    const fonteKaizens = await fonteBiblioteca();
    const dataRef = "p.DT_REFERENCIA";

    // Autorização por linha: a Biblioteca só mostra o lápis onde este
    // usuário pode mesmo editar. É a MESMA regra que a gravação aplica.
    const ctx = await contextoDeEdicao(req);
    // Mesma lógica para a lixeira: @ehAdmin/@idUsuarioLogado a
    // exclusão reaproveita de ctx.params; só os dois status que a
    // bloqueiam (Aprovado/Rejeitado) são exclusivos dela.
    const [statusAprovadoId, statusReprovadoId] = await Promise.all([
      idDoStatus("aprovado"),
      idDoStatus("reprovado"),
    ]);
    const params = [
      ["idIdioma", sql.Int, idIdioma],
      ...ctx.params,
      ["statusAprovado", sql.Int, statusAprovadoId ?? -1],
      ["statusReprovado", sql.Int, statusReprovadoId ?? -1],
    ];
    // "1 = 1" é a base para o WHERE nunca ficar vazio quando nenhum
    // filtro vier — o resto do comando segue exatamente igual.
    const filtros = ["1 = 1"];
    // O filtro passa a ser por ID_STATUS (o valor que a Biblioteca manda
    // vem do próprio kzn_status), não mais pelo literal antigo. IN (...)
    // com um ID_STATUS marcado, dois, ou todos os ativos — a query é a
    // mesma forma nos três casos.
    filtroEmLista(filtros, params, "p.ID_STATUS", "idStatus", idsStatus, sql.Int);
    filtroEmLista(filtros, params, "p.ID_CATEGORIA", "idCategoria", idsCategoria, sql.Int);
    if (estado) { filtros.push("lider.NM_ESTADO = @estado"); params.push(["estado", sql.NVarChar(100), estado]); }
    // Unidade e líder passaram a filtrar AQUI. Eram peneirados no
    // navegador, o que só funcionava porque a base inteira ia junto.
    filtroEmLista(filtros, params, "autor.NM_SITE", "site", sites, sql.NVarChar(200));
    // COLLATE ..._CI_AI: a peneira de usuário rodava no NAVEGADOR, com
    // normalizar() — minúsculas e SEM acento. Trazida para o SQL, ela
    // passaria a depender da collation do banco; a padrão do Azure SQL é
    // _CI_AS (acento-SENSÍVEL), e "Jose" deixaria de achar "José". O
    // COLLATE explícito devolve exatamente o comportamento anterior.
    // Não custa plano: LIKE com % à esquerda já não usa índice.
    if (lider) {
      filtros.push("lider.NM_USUARIO COLLATE Latin1_General_CI_AI LIKE @lider COLLATE Latin1_General_CI_AI");
      params.push(["lider", sql.NVarChar(255), termoContem(lider)]);
    }
    // Faixa de datas em vez de YEAR(coluna): função sobre a coluna
    // impede o uso de índice e obrigava a varrer a tabela mesmo com o
    // filtro de ano aplicado. Vários anos viram um OR de faixas — não dá
    // para expressar "2019 ou 2024" num IN sobre uma coluna calculada por
    // função, então cada ano marcado entra como a própria faixa dele.
    if (anos.length) {
      const trechos = anos.map((ano, i) => {
        // Limites como TEXTO 'AAAA-01-01' convertidos no próprio SQL: um
        // objeto Date passaria pelo fuso do driver e do servidor, e a
        // virada do ano poderia deslocar algumas horas — Kaizens do dia
        // 1º de janeiro cairiam no ano errado.
        params.push([`iniAno${i}`, sql.VarChar(10), `${ano}-01-01`]);
        params.push([`fimAno${i}`, sql.VarChar(10), `${ano + 1}-01-01`]);
        return `(${dataRef} >= CONVERT(DATETIME2, @iniAno${i}, 23) AND ${dataRef} < CONVERT(DATETIME2, @fimAno${i}, 23))`;
      });
      filtros.push(`(${trechos.join(" OR ")})`);
    }
    if (q) {
      // Mesma razão do filtro de líder: a busca era feita sem acento no
      // navegador e precisa continuar assim.
      filtros.push(
        "(p.NM_KAIZEN COLLATE Latin1_General_CI_AI LIKE @q COLLATE Latin1_General_CI_AI" +
        " OR lider.NM_USUARIO COLLATE Latin1_General_CI_AI LIKE @q COLLATE Latin1_General_CI_AI" +
        " OR CAST(p.ID_KAIZEN AS VARCHAR(20)) LIKE @q)"
      );
      params.push(["q", sql.NVarChar(255), termoContem(q)]);
    }
    params.push(["deslocamento", sql.Int, pagina * tamanho]);
    params.push(["tamanho", sql.Int, tamanho]);

    // Fonte ÚNICA para a listagem e para a contagem — as duas têm de
    // enxergar exatamente as mesmas linhas. Os dois OUTER APPLY entram
    // porque "site" e "líder" filtram por colunas que vêm deles; os dois
    // LEFT JOIN entram porque a listagem seleciona cat.NM_CATEGORIA e
    // st.NM_STATUS. São relações 1:1 (uma linha por ID e idioma), então
    // não alteram a contagem.
    // Pessoa (líder/autor) por origem: Kaizen histórico busca em
    // kzn_hist_mdm_vbm_terc, não no MDM atual — quem já saiu da empresa
    // não está mais lá. Cada branch só contribui linha quando p.ORIGEM
    // bate (mesmo padrão de fonteMembros/fonteDesperdicios).
    const fontePessoas = `(
         SELECT ID_USUARIO, NM_USUARIO, NM_ESTADO, NM_CIDADE, NM_SITE, ID_TIPO_USUARIO
           FROM ${FULL_MDM_TABLE} WHERE p.ORIGEM = 'A'
         UNION ALL
         SELECT ID_USUARIO, NM_USUARIO, NM_ESTADO, NM_CIDADE, NM_SITE, ID_TIPO_USUARIO
           FROM ${FULL_HIST_MDM_TABLE} WHERE p.ORIGEM = 'H'
       )`;
    const fonte = `FROM ${fonteKaizens} p
       LEFT JOIN ${FULL_CATEGORIA_TABLE} cat ON cat.ID_CATEGORIA = p.ID_CATEGORIA AND cat.ID_IDIOMA = @idIdioma
       LEFT JOIN ${FULL_STATUS_TABLE} st ON st.ID_STATUS = p.ID_STATUS AND st.ID_IDIOMA = @idIdioma
       OUTER APPLY (
         SELECT TOP (1) x.NM_USUARIO, x.NM_ESTADO, x.NM_CIDADE
           FROM ${fontePessoas} x
          WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
          ORDER BY x.ID_TIPO_USUARIO
       ) lider
       OUTER APPLY (
         SELECT TOP (1) y.NM_SITE
           FROM ${fontePessoas} y
          WHERE y.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
          ORDER BY y.ID_TIPO_USUARIO
       ) autor
       WHERE ${filtros.join(" AND ")}`;

    const result = await runQuery(
      `SELECT p.ID_KAIZEN, p.NM_KAIZEN, p.ID_STATUS, st.NM_STATUS, st.DS_STATUS,
              p.DT_ATUALIZACAO AS DT_CRIACAO, p.DT_CONCLUSAO,
              p.ID_CATEGORIA, cat.NM_CATEGORIA,
              lider.NM_USUARIO AS NM_LIDER, lider.NM_ESTADO, lider.NM_CIDADE,
              autor.NM_SITE,
              p.URL_IMG_ANTES, p.URL_IMG_DEPOIS,
              -- De qual tabela veio. Vai para a tela porque o card
              -- precisa saber: o lápis leva para a edição, e editar é
              -- na tabela de origem.
              p.ORIGEM,
              -- TODOS os desperdícios do Kaizen, não só o primeiro: cada
              -- um vira um balão próprio no card. STRING_AGG com um
              -- separador que não aparece em nome de cadastro.
              --
              -- O vínculo mora em DUAS tabelas, uma por origem, e o
              -- p.ORIGEM escolhe qual: unir as duas sem esse filtro
              -- misturaria os desperdícios de um Kaizen atual com os de
              -- um histórico de mesmo número, se um dia colidirem.
              (SELECT STRING_AGG(d.NM_DESPERDICIO, '§')
                 FROM (
                   SELECT ID_DESPERDICIO FROM ${FULL_KZ_DESPERDICIO_TABLE}
                    WHERE ID_KAIZEN = p.ID_KAIZEN AND p.ORIGEM = 'A'
                   UNION ALL
                   SELECT ID_DESPERDICIO FROM ${FULL_HIST_KZ_DESPERDICIO_TABLE}
                    WHERE ID_KAIZEN = p.ID_KAIZEN AND p.ORIGEM = 'H'
                 ) kd
                 JOIN ${FULL_DESPERDICIO_TABLE} d ON d.ID_DESPERDICIO = kd.ID_DESPERDICIO AND d.ID_IDIOMA = @idIdioma
              ) AS DESPERDICIOS,
              PODE_EDITAR = ${SQL_PODE_EDITAR("p")},
              STATUS_EDITAVEL = ${SQL_STATUS_EDITAVEL("p")},
              PODE_EXCLUIR = ${SQL_PODE_EXCLUIR("p")},
              STATUS_EXCLUIVEL = ${SQL_STATUS_EXCLUIVEL("p")}
       ${fonte}
       -- Do mais recente para o mais antigo, pelo ID_KAIZEN.
       --
       -- Antes a ordem era ISNULL(DT_CONCLUSAO, DT_ATUALIZACAO) DESC, e
       -- na tela ela não parecia ordem nenhuma: a Biblioteca mostra
       -- KZN26-004, 003, 007, 006, 005, 001, 002. O rótulo do card é o
       -- próprio ID_KAIZEN (ver rotuloIdKaizen), então ordenar por data
       -- de CONCLUSÃO embaralha a numeração que o usuário lê — e a data
       -- de conclusão é digitada no formulário, podendo ser anterior ao
       -- cadastro ou igual em vários Kaizens.
       --
       -- ID_KAIZEN é sequencial no cadastro e ÚNICO, então também
       -- estabiliza a paginação sozinho: com chave única no ORDER BY,
       -- nenhum Kaizen se repete ou some entre uma página e a próxima.
       -- O filtro por ano continua usando a expressão de data de
       -- referência — quem ordena e quem peneira são perguntas
       -- diferentes. Padrão ID DESC; ?ordem= troca (ver ORDENACOES).
       ORDER BY ${ordenacao}
       OFFSET @deslocamento ROWS FETCH NEXT @tamanho ROWS ONLY`,
      params
    );

    // Total só na PRIMEIRA página: é o que a tela precisa para o "N de
    // M" e para saber se ainda há o que carregar. Repetir o COUNT a cada
    // "Carregar mais" seria pagar duas vezes pela mesma informação.
    let total = null;
    if (pagina === 0) {
      const contagem = await runQuery(`SELECT COUNT(*) AS TOTAL ${fonte}`, params);
      total = contagem.recordset[0].TOTAL;
    }

    res.json({
      pagina,
      tamanho,
      total,
      itens: result.recordset.map((r) => ({
        ID_KAIZEN: r.ID_KAIZEN,
        // "A" = tabela atual, "H" = histórica. A tela precisa saber:
        // é o que distingue um Kaizen do ano corrente de um carregado
        // do histórico, e ambos aparecem na mesma lista.
        ORIGEM: r.ORIGEM,
        // Dois sinais, de propósito: PODE_EDITAR é a permissão da pessoa
        // (mostra ou esconde o botão) e EDICAO_LIBERADA junta a
        // permissão com o status (habilita ou desabilita).
        PODE_EDITAR: r.PODE_EDITAR === 1,
        EDICAO_LIBERADA: r.PODE_EDITAR === 1 && r.STATUS_EDITAVEL === 1,
        // Um só booleano, ao contrário do par acima: a lixeira ou existe
        // (dono/admin E status fora de Aprovado/Rejeitado) ou nem
        // renderiza — não há estado "desabilitado" para ela.
        PODE_EXCLUIR: r.PODE_EXCLUIR === 1 && r.STATUS_EXCLUIVEL === 1,
        ROTULO: rotuloIdKaizen(r.ID_KAIZEN, r.DT_CRIACAO),
        NM_KAIZEN: r.NM_KAIZEN,
        // O rótulo do status vem do cadastro (kzn_status), no idioma
        // pedido — a tela não decide mais o texto por conta própria.
        ID_STATUS: r.ID_STATUS,
        NM_STATUS: r.NM_STATUS,
        DS_STATUS: r.DS_STATUS,
        DT_CRIACAO: relogioLocal(r.DT_CRIACAO),
        DT_CONCLUSAO: relogioLocal(r.DT_CONCLUSAO),
        // ID_CATEGORIA acompanha o nome: o filtro de categoria da
        // Biblioteca guarda o ID (vem de /api/categorias) e sem ele a
        // comparação teria de ser por texto, que muda com o idioma.
        ID_CATEGORIA: r.ID_CATEGORIA,
        NM_CATEGORIA: r.NM_CATEGORIA,
        NM_LIDER: r.NM_LIDER,
        // Site do AUTOR, direto de kzn_mdm_hierarquia.NM_SITE — o card
        // mostrava NM_CIDADE, que é outro campo (por isso "Nova Lima").
        NM_SITE: r.NM_SITE,
        NM_ESTADO: r.NM_ESTADO,
        NM_CIDADE: r.NM_CIDADE,
        URL_IMG_ANTES: r.URL_IMG_ANTES,
        URL_IMG_DEPOIS: r.URL_IMG_DEPOIS,
        // Campos NOMEADOS, não uma lista posicional: categoria e
        // desperdício viajavam juntos em TAGS e a tela não tinha como
        // saber qual era qual para separar os balões.
        DESPERDICIOS: r.DESPERDICIOS ? String(r.DESPERDICIOS).split("§").filter(Boolean) : [],
      })),
    });
  } catch (err) {
    console.error("[kaizens] erro ao listar:", err.message);
    res.status(500).json(corpoErroSql("Erro ao consultar Kaizens: ", err));
  }
});

// GET /kaizens/resumo — contadores do painel "Resumo da Biblioteca"
// (hero da tela): total por ano de criação + total por status.
//
// Aceita os MESMOS 6 filtros de GET /kaizens (status, categoria, estado,
// site, lider, ano, q) — o painel passa a contar só o que a barra de
// filtros aprova, não mais a base inteira. Duplicado do mesmo jeito que
// /kaizens/exportar já duplica (ver comentário lá): mudança de filtro
// futura precisa vir nas três rotas.
apiRouter.get("/kaizens/resumo", async (req, res) => {
  try {
    const idIdioma = idIdiomaDaRequisicao(req);
    const idsStatus = listaIntOuVaziaGlobal(req.query.status);
    const idsCategoria = listaIntOuVaziaGlobal(req.query.categoria);
    const estado = textoOuNuloGlobal(req.query.estado);
    const sites = listaTextoOuVaziaGlobal(req.query.site);
    const lider = textoOuNuloGlobal(req.query.lider);
    const anos = listaIntOuVaziaGlobal(req.query.ano);
    const q = textoOuNuloGlobal(req.query.q);

    // O resumo é da BIBLIOTECA, então conta atual + histórico — os
    // mesmos Kaizens que a lista logo abaixo mostra. Se contasse só a
    // tabela atual, o painel diria um número e a lista mostraria outro.
    const fonteKaizens = await fonteBiblioteca();
    const dataRef = "p.DT_REFERENCIA";
    const params = [];
    const filtros = ["1 = 1"];
    filtroEmLista(filtros, params, "p.ID_STATUS", "idStatus", idsStatus, sql.Int);
    filtroEmLista(filtros, params, "p.ID_CATEGORIA", "idCategoria", idsCategoria, sql.Int);
    if (estado) { filtros.push("lider.NM_ESTADO = @estado"); params.push(["estado", sql.NVarChar(100), estado]); }
    filtroEmLista(filtros, params, "autor.NM_SITE", "site", sites, sql.NVarChar(200));
    if (lider) {
      filtros.push("lider.NM_USUARIO COLLATE Latin1_General_CI_AI LIKE @lider COLLATE Latin1_General_CI_AI");
      params.push(["lider", sql.NVarChar(255), termoContem(lider)]);
    }
    if (anos.length) {
      const trechos = anos.map((ano, i) => {
        params.push([`iniAno${i}`, sql.VarChar(10), `${ano}-01-01`]);
        params.push([`fimAno${i}`, sql.VarChar(10), `${ano + 1}-01-01`]);
        return `(${dataRef} >= CONVERT(DATETIME2, @iniAno${i}, 23) AND ${dataRef} < CONVERT(DATETIME2, @fimAno${i}, 23))`;
      });
      filtros.push(`(${trechos.join(" OR ")})`);
    }
    if (q) {
      filtros.push(
        "(p.NM_KAIZEN COLLATE Latin1_General_CI_AI LIKE @q COLLATE Latin1_General_CI_AI" +
        " OR lider.NM_USUARIO COLLATE Latin1_General_CI_AI LIKE @q COLLATE Latin1_General_CI_AI" +
        " OR CAST(p.ID_KAIZEN AS VARCHAR(20)) LIKE @q)"
      );
      params.push(["q", sql.NVarChar(255), termoContem(q)]);
    }

    // Pessoa (líder/autor) por origem — ver comentário em fontePessoas
    // de GET /kaizens. Só para FILTRAR aqui (estado/site/líder); nenhum
    // nome de pessoa é devolvido pelo resumo.
    const fontePessoas = `(
         SELECT ID_USUARIO, NM_ESTADO, NM_SITE, NM_USUARIO, ID_TIPO_USUARIO
           FROM ${FULL_MDM_TABLE} WHERE p.ORIGEM = 'A'
         UNION ALL
         SELECT ID_USUARIO, NM_ESTADO, NM_SITE, NM_USUARIO, ID_TIPO_USUARIO
           FROM ${FULL_HIST_MDM_TABLE} WHERE p.ORIGEM = 'H'
       )`;
    const fonte = `FROM ${fonteKaizens} p
       OUTER APPLY (
         SELECT TOP (1) x.NM_USUARIO, x.NM_ESTADO
           FROM ${fontePessoas} x
          WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
          ORDER BY x.ID_TIPO_USUARIO
       ) lider
       OUTER APPLY (
         SELECT TOP (1) y.NM_SITE
           FROM ${fontePessoas} y
          WHERE y.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
          ORDER BY y.ID_TIPO_USUARIO
       ) autor
       WHERE ${filtros.join(" AND ")}`;

    // Ano da MESMA data que o filtro de ano usa (DT_REFERENCIA = criação).
    // Por DT_ATUALIZACAO, filtrar 2024 mostrava "Total 2026" (histórico
    // carregado em 2026) e o painel não batia com a barra.
    const porAno = await runQuery(
      `SELECT YEAR(${dataRef}) AS ANO, COUNT(*) AS QTD ${fonte} GROUP BY YEAR(${dataRef})`,
      params
    );
    // Total por status, casado por ID_STATUS (não por NM_STATUS — ver
    // nota histórica abaixo), já dentro dos filtros da barra.
    //
    // Era agrupado por NM_STATUS e o painel da Biblioteca casava o nome
    // sem acento contra uma lista escrita à mão ('em aprovacao',
    // 'aguardando'). O cadastro diz "Aguardando aprovação", que não está
    // nessa lista — e o painel mostrava 0 tendo Kaizen aguardando.
    // Renomear um status na Administração quebrava a conta de novo. ID
    // não depende de como o status foi escrito nem do idioma.
    const porStatus = await runQuery(
      `SELECT p.ID_STATUS, COUNT(*) AS QTD ${fonte} GROUP BY p.ID_STATUS`,
      params
    );
    // Um item por status CADASTRADO, no idioma pedido, com a contagem do
    // ano — inclusive os que ficaram em zero, para o painel não esconder
    // um status só porque ninguém o usou ainda. LEFT JOIN a partir de
    // kzn_status, não da PVC, é o que garante isso.
    //
    // Sem filtro de ano na barra: mostra só o ano CORRENTE, como sempre
    // mostrou (os cartões "Total <ano>" acima já cobrem os demais). Com
    // filtro de ano aplicado, usa os MESMOS anos escolhidos ali — não
    // mais o corrente sozinho.
    const paramsStatusAno = params.slice();
    const filtrosStatusAno = filtros.concat(["p.ID_STATUS = st.ID_STATUS"]);
    if (!anos.length) {
      filtrosStatusAno.push(`YEAR(${dataRef}) = @anoPadrao`);
      paramsStatusAno.push(["anoPadrao", sql.Int, new Date().getUTCFullYear()]);
    }
    paramsStatusAno.push(["idIdioma", sql.Int, idIdioma]);
    const statusAno = await runQuery(
      `SELECT st.ID_STATUS, st.NM_STATUS,
              QTD = (SELECT COUNT(*)
                       FROM ${fonteKaizens} p
                       OUTER APPLY (
                         SELECT TOP (1) x.NM_USUARIO, x.NM_ESTADO
                           FROM ${fontePessoas} x
                          WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
                          ORDER BY x.ID_TIPO_USUARIO
                       ) lider
                       OUTER APPLY (
                         SELECT TOP (1) y.NM_SITE
                           FROM ${fontePessoas} y
                          WHERE y.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
                          ORDER BY y.ID_TIPO_USUARIO
                       ) autor
                      WHERE ${filtrosStatusAno.join(" AND ")})
         FROM ${FULL_STATUS_TABLE} st
        WHERE st.ID_IDIOMA = @idIdioma AND st.SG_ATIVO IN ${SG_ATIVO_SIM_SQL}
        ORDER BY st.ID_STATUS`,
      paramsStatusAno
    );

    // Taxa = aprovados / (aprovados + reprovados) do ano. Os dois IDs
    // saem do mesmo idDoStatus() do resto do sistema — nada fixo aqui.
    // Sem nenhum dos dois no ano, devolve null: dividir por zero daria
    // NaN, e "não há o que medir" não é 0%.
    const porId = new Map(statusAno.recordset.map((r) => [r.ID_STATUS, r.QTD]));
    const idAprovado = await idDoStatus("aprovado");
    const idReprovado = await idDoStatus("reprovado");
    const qtdAprovados = idAprovado != null ? porId.get(idAprovado) || 0 : 0;
    const qtdReprovados = idReprovado != null ? porId.get(idReprovado) || 0 : 0;
    const decididos = qtdAprovados + qtdReprovados;

    res.json({
      porAno: Object.fromEntries(porAno.recordset.map((r) => [r.ANO, r.QTD])),
      // Chave = ID_STATUS (como texto, porque é chave de objeto JSON).
      // Quem lê monta a lista a partir de statusAno — que traz os status
      // CADASTRADOS, no idioma da tela — e busca aqui o total de todos
      // os anos. Assim o painel mostra os mesmos itens do filtro, na
      // mesma ordem, sem nome literal no meio do caminho.
      totalPorStatus: Object.fromEntries(
        porStatus.recordset.map((r) => [String(r.ID_STATUS == null ? "" : r.ID_STATUS), r.QTD])
      ),
      // Ano(s) que statusAno de fato contou: os da barra de filtros,
      // quando aplicados, senão o corrente (mesma regra de filtrosStatusAno).
      ano: anos.length ? anos : [new Date().getUTCFullYear()],
      statusAno: statusAno.recordset.map((r) => ({
        ID_STATUS: r.ID_STATUS, NM_STATUS: r.NM_STATUS, QTD: r.QTD,
      })),
      taxaAprovacao: decididos > 0 ? Math.round((qtdAprovados / decididos) * 100) : null,
    });
  } catch (err) {
    console.error("[kaizens/resumo] erro:", err.message);
    res.status(500).json(corpoErroSql("Erro ao consultar resumo: ", err));
  }
});

// GET /kaizens/titulo-existe?titulo=&id= — o título já está em uso por
// OUTRO Kaizen?
//
// Usado pela Etapa 1 do Novo Kaizen antes de liberar o avanço: dois
// Kaizens com o mesmo nome são indistinguíveis na Biblioteca e na fila
// de aprovação.
//
// ?id= é o ID_KAIZEN em edição (o hidden id_kaizen do formulário).
// Com ele, o próprio registro sai da busca — sem isso, editar um Kaizen
// sem trocar o título era barrado pelo seu próprio nome ao passar da
// Etapa 1 para a Etapa 2. Sem ?id=, o fluxo é cadastro novo e qualquer
// título repetido bloqueia, como antes.
//
// A regra é a MESMA de existeKaizenComMesmoNome(), usada na gravação:
// se a tela e o salvamento comparassem de jeitos diferentes, um deixaria
// passar o que o outro recusa.
//
// Registrada ANTES de /kaizens/:id, senão ":id" capturaria a rota.
apiRouter.get("/kaizens/titulo-existe", async (req, res) => {
  try {
    const titulo = String(req.query.titulo || "").trim();
    if (!titulo) return res.json({ existe: false });
    const idEmEdicao = parseInt(req.query.id, 10);

    const existe = await existeKaizenComMesmoNome(
      titulo,
      Number.isInteger(idEmEdicao) && idEmEdicao > 0 ? idEmEdicao : null
    );
    res.json({ existe });
  } catch (err) {
    console.error("[kaizens/titulo-existe] erro:", err.message);
    res.status(500).json({ error: "Erro ao verificar o título: " + err.message });
  }
});

// GET /kaizens/filtros — o que preenche os combos da Biblioteca que
// NÃO vêm de um cadastro próprio: Unidades e Anos.
//
// Categoria e Status já têm rota (/categorias e /status, sobre
// kzn_categoria e kzn_status) e a tela usa aquelas — não há nada aqui
// para elas. Os dois que faltavam saíam dos registros JÁ CARREGADOS na
// tela, o que fazia a lista depender do que estava na página: uma
// unidade sem Kaizen sumia do filtro, e um ano idem.
//
// Registrada ANTES de /kaizens/:id, senão "filtros" seria lido como um
// ID (mesmo cuidado de /kaizens/resumo e /kaizens/titulo-existe).
apiRouter.get("/kaizens/filtros", async (req, res) => {
  try {
    const fonteKaizens = await fonteBiblioteca();
    const [unidades, anos] = await Promise.all([
      // Todas as unidades da hierarquia, não só as dos terceiros.
      opcoesDistintasDoMdm("NM_SITE", { todosOsTipos: true, incluirHistorico: true }),
      // O ano da Biblioteca é o de CRIAÇÃO do Kaizen — a mesma expressão
      // (DT_REFERENCIA) que o filtro ?ano= usa mais acima e que ordena a
      // lista. Não é DT_CONCLUSAO: essa é só um dado do registro (pode
      // nem existir ainda), e usá-la aqui faria o combo de anos e o
      // filtro casarem datas diferentes das mostradas no card.
      runQuery(
        // Sobre DT_REFERENCIA quando ela existir: YEAR(coluna) ainda é
        // função sobre coluna e impede o uso de índice — obriga a
        // varrer a tabela para montar um combo de meia dúzia de anos.
        // Os anos oferecidos no filtro têm de cobrir o histórico
        // também: sem isso a Biblioteca mostraria Kaizens de 2019 e não
        // deixaria filtrar por 2019.
        `SELECT DISTINCT YEAR(p.DT_REFERENCIA) AS ANO
           FROM ${fonteKaizens} p
          WHERE p.DT_REFERENCIA IS NOT NULL
          ORDER BY ANO DESC`
      ),
    ]);
    res.json({ unidades, anos: anos.recordset.map((r) => r.ANO) });
  } catch (err) {
    console.error("[kaizens/filtros] erro:", err.message);
    res.status(500).json(corpoErroSql("Erro ao consultar os filtros: ", err));
  }
});

// GET /kaizens/exportar — Excel com TODOS os registros que os filtros da
// Biblioteca aprovam, não só a página exibida na tela. Mesmos parâmetros
// de GET /kaizens (q, lider, site, categoria, status, ano) e a MESMA
// fonte unificada (atual + histórico), sem OFFSET/FETCH: uma consulta só,
// nunca dentro de laço. Permissão de acesso é a mesma da Biblioteca — a
// listagem não esconde Kaizen nenhum por linha, só o lápis de editar
// (PODE_EDITAR), que não faz sentido numa planilha.
//
// Conjunto e ordem de colunas definidos junto com o time (planilha de
// referência): sem Origem/Descrição do Status/Estado e Cidade do
// Líder/Imagem Antes e Depois; com Membros VBM 1/2 e Membros Externos
// (kzn_membros_equipe + kzn_hist_membros_equipe, distinguidos pelo
// ID_TIPO_USUARIO do MDM — ver ID_TIPO_USUARIO_TERCEIRO). A última
// coluna (DT_ATUALIZACAO) não é mais a data de cadastro — vem do LOG de
// gravações (kzn_log_pedravisaoconsolidada.DT_OPERACAO), a última
// atualização de verdade do registro.
apiRouter.get("/kaizens/exportar", async (req, res) => {
  try {
    const idIdioma = idIdiomaDaRequisicao(req);
    const dataRef = "p.DT_REFERENCIA";

    // Os mesmos seis filtros de GET /kaizens, na mesma forma — ver ali
    // os comentários de cada um (COLLATE, faixa de datas em vez de
    // YEAR(), etc.). Duplicado em vez de extraído para não arriscar a
    // rota já estável; qualquer mudança de filtro futura precisa vir
    // nas duas rotas.
    const idsStatus = listaIntOuVaziaGlobal(req.query.status);
    const idsCategoria = listaIntOuVaziaGlobal(req.query.categoria);
    const estado = textoOuNuloGlobal(req.query.estado);
    const sites = listaTextoOuVaziaGlobal(req.query.site);
    const lider = textoOuNuloGlobal(req.query.lider);
    const anos = listaIntOuVaziaGlobal(req.query.ano);
    const q = textoOuNuloGlobal(req.query.q);

    const params = [["idIdioma", sql.Int, idIdioma]];
    const filtros = ["1 = 1"];
    filtroEmLista(filtros, params, "p.ID_STATUS", "idStatus", idsStatus, sql.Int);
    filtroEmLista(filtros, params, "p.ID_CATEGORIA", "idCategoria", idsCategoria, sql.Int);
    if (estado) { filtros.push("lider.NM_ESTADO = @estado"); params.push(["estado", sql.NVarChar(100), estado]); }
    filtroEmLista(filtros, params, "autor.NM_SITE", "site", sites, sql.NVarChar(200));
    if (lider) {
      filtros.push("lider.NM_USUARIO COLLATE Latin1_General_CI_AI LIKE @lider COLLATE Latin1_General_CI_AI");
      params.push(["lider", sql.NVarChar(255), termoContem(lider)]);
    }
    if (anos.length) {
      const trechos = anos.map((ano, i) => {
        params.push([`iniAno${i}`, sql.VarChar(10), `${ano}-01-01`]);
        params.push([`fimAno${i}`, sql.VarChar(10), `${ano + 1}-01-01`]);
        return `(${dataRef} >= CONVERT(DATETIME2, @iniAno${i}, 23) AND ${dataRef} < CONVERT(DATETIME2, @fimAno${i}, 23))`;
      });
      filtros.push(`(${trechos.join(" OR ")})`);
    }
    if (q) {
      filtros.push(
        "(p.NM_KAIZEN COLLATE Latin1_General_CI_AI LIKE @q COLLATE Latin1_General_CI_AI" +
        " OR lider.NM_USUARIO COLLATE Latin1_General_CI_AI LIKE @q COLLATE Latin1_General_CI_AI" +
        " OR CAST(p.ID_KAIZEN AS VARCHAR(20)) LIKE @q)"
      );
      params.push(["q", sql.NVarChar(255), termoContem(q)]);
    }

    params.push(["tipoTerceiro", sql.Int, ID_TIPO_USUARIO_TERCEIRO]);

    // DUAS consultas completas e um UNION ALL: a do HISTÓRICO usa só as
    // tabelas kzn_hist_* (PVC, membros, desperdício, aprovador e pessoas
    // em kzn_hist_mdm_vbm_terc) e a dos Kaizens ATUAIS só as tabelas
    // atuais. Cada consulta é montada por montarConsultaExportacao() com
    // as tabelas da própria origem — nenhum JOIN cruza origem, e não há
    // mais subquery gated por p.ORIGEM. Os filtros são os mesmos nas
    // duas (mesmos aliases p/lider/autor e mesmos parâmetros nomeados).
    const [fonteHist, fonteAtual] = await Promise.all([fonteBiblioteca("H"), fonteBiblioteca("A")]);

    const montarConsultaExportacao = (origem) => {
      const h = origem === "H";
      const tab = tabelasDaOrigem(origem);
      const tabAprovador = h ? FULL_HIST_APROVADOR_TABLE : FULL_TABLE_NAME;
      const tabPessoas = h ? FULL_HIST_MDM_TABLE : FULL_MDM_TABLE;
      // Só a tabela ATUAL tem log de gravações; histórico é arquivo
      // fechado, então a última atualização sai NULL para ele.
      const ultimaOperacao = h
        ? "CAST(NULL AS DATETIME2(3))"
        : `(SELECT MAX(lg.DT_OPERACAO) FROM ${FULL_LOG_PVC_TABLE} lg WHERE lg.ID_KAIZEN = p.ID_KAIZEN)`;
      return `
      SELECT p.ID_KAIZEN, p.ORIGEM, p.NM_KAIZEN,
             cat.NM_CATEGORIA, st.NM_STATUS,
             lider.NM_USUARIO AS NM_LIDER,
             membroVale1.NM_USUARIO AS NM_MEMBRO_VALE_1,
             membroVale2.NM_USUARIO AS NM_MEMBRO_VALE_2,
             (SELECT STRING_AGG(mv3.NM_USUARIO, ', ')
                FROM ${tab.membros} me3
                LEFT JOIN ${tabPessoas} mv3 ON mv3.ID_USUARIO = me3.ID_USUARIO
               WHERE me3.ID_KAIZEN = p.ID_KAIZEN AND mv3.ID_TIPO_USUARIO = @tipoTerceiro
             ) AS NM_MEMBROS_EXTERNOS,
             autor.NM_SITE, autor.NM_USUARIO AS NM_CADASTRO,
             aprov.NM_USUARIO AS NM_APROVADOR,
             repl.NM_REPLICACAO,
             moeda.SG_MOEDA, moeda.NM_MOEDA,
             p.DS_PROBLEMA, p.DS_OBJETIVO,
             p.DS_ESTADO_ANTES, p.DS_ESTADO_DEPOIS,
             p.URL_REFERENCIA, p.DS_LICOES_APRENDIDAS,
             p.DS_COMPARA_META, p.DS_RESULTADO_ALCANCADO,
             p.VL_RESULTADO_FINANCEIRO,
             p.DT_CONCLUSAO, p.DT_ATUALIZACAO AS DT_CRIACAO,
             p.DS_MOTIVO,
             (SELECT STRING_AGG(d.NM_DESPERDICIO, '§')
                FROM ${tab.desperdicio} kd
                JOIN ${FULL_DESPERDICIO_TABLE} d ON d.ID_DESPERDICIO = kd.ID_DESPERDICIO AND d.ID_IDIOMA = @idIdioma
               WHERE kd.ID_KAIZEN = p.ID_KAIZEN
             ) AS DESPERDICIOS,
             ${ultimaOperacao} AS DT_ULTIMA_OPERACAO
        FROM ${h ? fonteHist : fonteAtual} p
        LEFT JOIN ${FULL_CATEGORIA_TABLE} cat ON cat.ID_CATEGORIA = p.ID_CATEGORIA AND cat.ID_IDIOMA = @idIdioma
        LEFT JOIN ${FULL_STATUS_TABLE} st ON st.ID_STATUS = p.ID_STATUS AND st.ID_IDIOMA = @idIdioma
        LEFT JOIN ${FULL_REPLICACAO_TABLE} repl ON repl.ID_REPLICACAO = p.ID_REPLICACAO AND repl.ID_IDIOMA = @idIdioma
        LEFT JOIN ${FULL_MOEDA_TABLE} moeda ON moeda.ID_MOEDA = p.ID_MOEDA
        OUTER APPLY (
          SELECT TOP (1) ap.ID_USUARIO, ap.CD_MATRICULA
            FROM ${tabAprovador} ap
           WHERE ap.ID_APROVADOR = p.ID_APROVADOR
        ) aprovFk
        OUTER APPLY (
          SELECT TOP (1) x.NM_USUARIO, x.NM_ESTADO
            FROM ${tabPessoas} x
           WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
           ORDER BY x.ID_TIPO_USUARIO
        ) lider
        OUTER APPLY (
          SELECT TOP (1) y.NM_SITE, y.NM_USUARIO
            FROM ${tabPessoas} y
           WHERE y.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
           ORDER BY y.ID_TIPO_USUARIO
        ) autor
        -- Aprovador: pela MATRÍCULA (PESSOA_DO_APROVADOR), não por
        -- aprovFk.ID_USUARIO — nas linhas novas de kzn_aprovador esse
        -- campo é QUEM CONCEDEU o direito, não quem aprova. A comparação
        -- ignora zero à esquerda (1487847 = 01487847).
        OUTER APPLY (
          SELECT TOP (1) x.NM_USUARIO
            FROM ${tabPessoas} x
           WHERE ${PESSOA_DO_APROVADOR("aprovFk")}
           ORDER BY ${ORDEM_PESSOA_DO_APROVADOR("aprovFk")}
        ) aprov
        OUTER APPLY (
          SELECT TOP (1) mv.NM_USUARIO
            FROM ${tab.membros} me
            LEFT JOIN ${tabPessoas} mv ON mv.ID_USUARIO = me.ID_USUARIO
           WHERE me.ID_KAIZEN = p.ID_KAIZEN AND ISNULL(mv.ID_TIPO_USUARIO, 0) <> @tipoTerceiro
           ORDER BY me.ID_USUARIO
        ) membroVale1
        OUTER APPLY (
          SELECT mv2.NM_USUARIO
            FROM ${tab.membros} me2
            LEFT JOIN ${tabPessoas} mv2 ON mv2.ID_USUARIO = me2.ID_USUARIO
           WHERE me2.ID_KAIZEN = p.ID_KAIZEN AND ISNULL(mv2.ID_TIPO_USUARIO, 0) <> @tipoTerceiro
           ORDER BY me2.ID_USUARIO
           OFFSET 1 ROWS FETCH NEXT 1 ROWS ONLY
        ) membroVale2
       WHERE ${filtros.join(" AND ")}`;
    };

    // Uma consulta só, sem OFFSET/FETCH: a exportação traz TODAS as
    // linhas que os filtros aprovam, não a página que está na tela.
    // Histórico primeiro no UNION; a ordem final é por ID_KAIZEN.
    const result = await runQuery(
      `SELECT * FROM (
         ${montarConsultaExportacao("H")}
         UNION ALL
         ${montarConsultaExportacao("A")}
       ) u
       ORDER BY u.ID_KAIZEN DESC`,
      params
    );

    // Sem teto: a exportação sempre traz tudo que o filtro aprova (ver
    // comentário no topo da rota). Só um alerta no log acima de um
    // volume que hoje seria incomum (~6.000 linhas no total) — visível
    // ANTES de virar timeout/estouro de memória, sem truncar nada nem
    // mudar a resposta pra quem chamou.
    const LIMIAR_ALERTA_EXPORTACAO = 20000;
    if (result.recordset.length > LIMIAR_ALERTA_EXPORTACAO) {
      console.warn(`[kaizens/exportar] ${result.recordset.length} linhas — acima do volume esperado ` +
        `(${LIMIAR_ALERTA_EXPORTACAO}). Considere revisar memória/timeout do Node antes que isso vire incidente.`);
    }

    const workbook = new ExcelJS.Workbook();
    // "Kaizens" é o mesmo termo nos dois idiomas em todo o app (ver
    // dicionários pt-BR/en do front) — nome da aba não precisa variar.
    const planilha = workbook.addWorksheet("Kaizens");
    // Fonte e cor: as mesmas do site (Poppins, ver css/vbm-app.css, e o
    // azul --vbm-blue-light #3CB5E5 do cabeçalho da Biblioteca) — não a
    // "Vale Sans" do arquivo de referência, que é a fonte corporativa,
    // não a da aplicação.
    const FONTE_PADRAO = "Poppins";
    // Cabeçalhos das colunas: rótulo por idioma (mesmo idIdioma da
    // requisição, que já decide NM_CATEGORIA/NM_STATUS acima) — só o
    // texto muda; key/width são os mesmos nos dois idiomas.
    const CABECALHOS_COLUNA = {
      ID_KAIZEN: ["ID Kaizen", "Kaizen ID"],
      ROTULO: ["Rótulo", "Label"],
      NM_KAIZEN: ["Título", "Title"],
      DS_PROBLEMA: ["Declaração do Problema", "Problem Statement"],
      DS_OBJETIVO: ["Meta/Objetivo", "Goal/Objective"],
      NM_CATEGORIA: ["Categoria", "Category"],
      NM_STATUS: ["Status", "Status"],
      NM_LIDER: ["Líder", "Leader"],
      NM_MEMBRO_VALE_1: ["Membros VBM 1", "VBM Members 1"],
      NM_MEMBRO_VALE_2: ["Membros VBM 2", "VBM Members 2"],
      NM_MEMBROS_EXTERNOS: ["Membros Externos", "External Members"],
      NM_SITE: ["Site", "Site"],
      NM_APROVADOR: ["Aprovador", "Approver"],
      NM_REPLICACAO: ["Replicação", "Replication"],
      DS_ESTADO_ANTES: ["Descrição Antes", "Before Description"],
      DS_ESTADO_DEPOIS: ["Descrição Depois", "After Description"],
      URL_REFERENCIA: ["Link de Referência", "Reference Link"],
      DS_LICOES_APRENDIDAS: ["Lições Aprendidas", "Lessons Learned"],
      DS_COMPARA_META: ["Comparação com a Meta", "Comparison with the Goal"],
      DS_RESULTADO_ALCANCADO: ["Resultado Alcançado", "Achieved Result"],
      VL_RESULTADO_FINANCEIRO: ["Valor do Resultado Financeiro", "Financial Result Value"],
      SG_MOEDA: ["Moeda", "Currency"],
      DESPERDICIOS: ["Redução de Desperdícios", "Waste Reduction"],
      DS_MOTIVO: ["Motivo (reprovação/ajuste)", "Reason (rejection/adjustment)"],
      NM_CADASTRO: ["Cadastrado por", "Registered by"],
      DT_CONCLUSAO: ["Data de Conclusão", "Completion Date"],
      DT_CRIACAO: ["Data de cadastro", "Registration Date"],
      DT_ULTIMA_OPERACAO: ["DT_ATUALIZACAO", "DT_ATUALIZACAO"],
    };
    const LARGURA_COLUNA = {
      ID_KAIZEN: 12, ROTULO: 14, NM_KAIZEN: 40, DS_PROBLEMA: 40, DS_OBJETIVO: 40,
      NM_CATEGORIA: 20, NM_STATUS: 20, NM_LIDER: 26, NM_MEMBRO_VALE_1: 26,
      NM_MEMBRO_VALE_2: 26, NM_MEMBROS_EXTERNOS: 26, NM_SITE: 18, NM_APROVADOR: 26,
      NM_REPLICACAO: 16, DS_ESTADO_ANTES: 40, DS_ESTADO_DEPOIS: 40, URL_REFERENCIA: 30,
      DS_LICOES_APRENDIDAS: 40, DS_COMPARA_META: 40, DS_RESULTADO_ALCANCADO: 40,
      VL_RESULTADO_FINANCEIRO: 20, SG_MOEDA: 10, DESPERDICIOS: 30, DS_MOTIVO: 30,
      NM_CADASTRO: 26, DT_CONCLUSAO: 16, DT_CRIACAO: 18, DT_ULTIMA_OPERACAO: 18,
    };
    const idxIdioma = idIdioma === ID_IDIOMA_EN ? 1 : 0;
    planilha.columns = Object.keys(CABECALHOS_COLUNA).map((key) => ({
      header: CABECALHOS_COLUNA[key][idxIdioma],
      key,
      width: LARGURA_COLUNA[key],
    }));

    // Título: altura 30, fundo azul do site, texto branco, centralizado
    // — mesma identidade visual da Biblioteca, não o estilo do arquivo
    // de referência (que usava a fonte corporativa "Vale Sans").
    planilha.getRow(1).height = 30;
    planilha.getRow(1).eachCell((celula) => {
      celula.font = { name: FONTE_PADRAO, size: 10, color: { argb: "FFFFFFFF" } };
      celula.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3CB5E5" } };
      celula.alignment = { horizontal: "center", vertical: "middle" };
    });

    result.recordset.forEach((r) => {
      planilha.addRow({
        ID_KAIZEN: r.ID_KAIZEN,
        ROTULO: rotuloIdKaizen(r.ID_KAIZEN, r.DT_CRIACAO),
        NM_KAIZEN: r.NM_KAIZEN,
        DS_PROBLEMA: r.DS_PROBLEMA,
        DS_OBJETIVO: r.DS_OBJETIVO,
        NM_CATEGORIA: r.NM_CATEGORIA,
        NM_STATUS: r.NM_STATUS,
        NM_LIDER: r.NM_LIDER,
        NM_MEMBRO_VALE_1: r.NM_MEMBRO_VALE_1,
        NM_MEMBRO_VALE_2: r.NM_MEMBRO_VALE_2,
        NM_MEMBROS_EXTERNOS: r.NM_MEMBROS_EXTERNOS,
        NM_SITE: r.NM_SITE,
        NM_APROVADOR: r.NM_APROVADOR,
        NM_REPLICACAO: r.NM_REPLICACAO,
        DS_ESTADO_ANTES: r.DS_ESTADO_ANTES,
        DS_ESTADO_DEPOIS: r.DS_ESTADO_DEPOIS,
        URL_REFERENCIA: r.URL_REFERENCIA,
        DS_LICOES_APRENDIDAS: r.DS_LICOES_APRENDIDAS,
        DS_COMPARA_META: r.DS_COMPARA_META,
        DS_RESULTADO_ALCANCADO: r.DS_RESULTADO_ALCANCADO,
        VL_RESULTADO_FINANCEIRO: r.VL_RESULTADO_FINANCEIRO,
        SG_MOEDA: r.SG_MOEDA,
        DESPERDICIOS: r.DESPERDICIOS ? String(r.DESPERDICIOS).split("§").filter(Boolean).join(", ") : "",
        DS_MOTIVO: r.DS_MOTIVO,
        NM_CADASTRO: r.NM_CADASTRO,
        DT_CONCLUSAO: r.DT_CONCLUSAO,
        DT_CRIACAO: r.DT_CRIACAO,
        DT_ULTIMA_OPERACAO: r.DT_ULTIMA_OPERACAO,
      });
    });
    // Linhas de dado: mesma fonte do site, tamanho 9, centralizadas na
    // horizontal e no meio na vertical — só o título leva a cor de
    // destaque. includeEmpty: sem ele, célula com valor nulo (Membros
    // VBM 2 vazio, DT_ATUALIZACAO sem log) não é nem visitada — ficaria
    // no padrão do ExcelJS (Calibri 11, sem alinhamento) em vez de
    // seguir o resto da linha.
    for (let linha = 2; linha <= planilha.rowCount; linha++) {
      planilha.getRow(linha).eachCell({ includeEmpty: true }, (celula) => {
        celula.font = { name: FONTE_PADRAO, size: 9 };
        celula.alignment = { horizontal: "center", vertical: "middle" };
      });
    }
    planilha.getColumn("DT_CONCLUSAO").numFmt = "dd/mm/yyyy";
    planilha.getColumn("DT_CRIACAO").numFmt = "dd/mm/yyyy hh:mm";
    planilha.getColumn("DT_ULTIMA_OPERACAO").numFmt = "dd/mm/yyyy hh:mm";

    const nomeArquivo = `biblioteca-kaizen-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo}"`);
    await workbook.xlsx.write(res);
    res.end();
    console.log(`[kaizens/exportar] ${result.recordset.length} linha(s) exportada(s).`);
  } catch (err) {
    console.error("[kaizens/exportar] erro:", err.message);
    if (!res.headersSent) res.status(500).json(corpoErroSql("Erro ao exportar Kaizens: ", err));
  }
});

// GET /kaizens/:id — detalhe completo pro modal (Declaração do
// Problema, Antes/Depois, Resultados, Aprendizados). :id é ID_KAIZEN.
apiRouter.get("/kaizens/:id", async (req, res) => {
  try {
    const idKaizen = parseInt(req.params.id, 10);
    if (!Number.isInteger(idKaizen)) return res.status(400).json({ error: "ID inválido." });
    const idIdioma = idIdiomaDaRequisicao(req);
    const fonteKaizens = await fonteBiblioteca();

    // Pessoa (líder/autor/aprovador) por origem — ver comentário em
    // fontePessoas de GET /kaizens.
    const fontePessoas = `(
         SELECT ID_USUARIO, CD_MATRICULA, NM_USUARIO, NM_ESTADO, NM_CIDADE, NM_SITE, ID_TIPO_USUARIO
           FROM ${FULL_MDM_TABLE} WHERE p.ORIGEM = 'A'
         UNION ALL
         SELECT ID_USUARIO, CD_MATRICULA, NM_USUARIO, NM_ESTADO, NM_CIDADE, NM_SITE, ID_TIPO_USUARIO
           FROM ${FULL_HIST_MDM_TABLE} WHERE p.ORIGEM = 'H'
       )`;
    // O ID_APROVADOR de um Kaizen histórico só existe em kzn_hist_aprovador.
    const fonteAprovadores = `(
         SELECT ID_APROVADOR, ID_USUARIO, CD_MATRICULA
           FROM ${FULL_TABLE_NAME} WHERE p.ORIGEM = 'A'
         UNION ALL
         SELECT ID_APROVADOR, ID_USUARIO, CD_MATRICULA
           FROM ${FULL_HIST_APROVADOR_TABLE} WHERE p.ORIGEM = 'H'
       )`;
    const principal = await runQuery(
      `SELECT p.*, p.DT_ATUALIZACAO AS DT_CRIACAO, cat.NM_CATEGORIA, repl.NM_REPLICACAO, moeda.SG_MOEDA, moeda.NM_MOEDA,
              st.NM_STATUS, st.DS_STATUS,
              lider.NM_USUARIO AS NM_LIDER, lider.NM_ESTADO, lider.NM_CIDADE,
              autor.NM_SITE,
              aprov.NM_USUARIO AS NM_APROVADOR
       FROM ${fonteKaizens} p
       LEFT JOIN ${FULL_CATEGORIA_TABLE} cat ON cat.ID_CATEGORIA = p.ID_CATEGORIA AND cat.ID_IDIOMA = @idIdioma
       LEFT JOIN ${FULL_REPLICACAO_TABLE} repl ON repl.ID_REPLICACAO = p.ID_REPLICACAO AND repl.ID_IDIOMA = @idIdioma
       LEFT JOIN ${FULL_STATUS_TABLE} st ON st.ID_STATUS = p.ID_STATUS AND st.ID_IDIOMA = @idIdioma
       LEFT JOIN ${FULL_MOEDA_TABLE} moeda ON moeda.ID_MOEDA = p.ID_MOEDA
       -- fontePessoas é correlacionada (referencia p.ORIGEM por dentro),
       -- então tem de entrar por APPLY — um LEFT JOIN comum não permite
       -- a subquery do lado direito enxergar p.
       OUTER APPLY (
         SELECT TOP (1) x.NM_USUARIO, x.NM_ESTADO, x.NM_CIDADE
           FROM ${fontePessoas} x
          WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
          ORDER BY x.ID_TIPO_USUARIO
       ) lider
       -- Unidade do Kaizen: NM_SITE de quem cadastrou (sem cadastrante,
       -- o líder). MESMO OUTER APPLY de GET /kaizens, para o modal e o
       -- card mostrarem a mesma unidade. O TOP(1) + ORDER BY existe
       -- porque a mesma pessoa pode ter mais de uma linha no MDM.
       OUTER APPLY (
         SELECT TOP (1) y.NM_SITE
           FROM ${fontePessoas} y
          WHERE y.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
          ORDER BY y.ID_TIPO_USUARIO
       ) autor
       OUTER APPLY (
         SELECT TOP (1) ap.ID_USUARIO, ap.CD_MATRICULA
           FROM ${fonteAprovadores} ap
          WHERE ap.ID_APROVADOR = p.ID_APROVADOR
       ) aprovFk
       -- Aprovador pela MATRÍCULA (PESSOA_DO_APROVADOR): aprovFk.ID_USUARIO
       -- é quem concedeu o direito nas linhas novas, não quem aprova.
       OUTER APPLY (
         SELECT TOP (1) x.NM_USUARIO
           FROM ${fontePessoas} x
          WHERE ${PESSOA_DO_APROVADOR("aprovFk")}
          ORDER BY ${ORDEM_PESSOA_DO_APROVADOR("aprovFk")}
       ) aprov
       WHERE p.ID_KAIZEN = @idKaizen`,
      [["idKaizen", sql.Int, idKaizen], ["idIdioma", sql.Int, idIdioma]]
    );
    if (!principal.recordset.length) return res.status(404).json({ error: "Kaizen não encontrado." });
    const k = principal.recordset[0];
    const ehHistorico = k.ORIGEM === "H";

    const [membros, desperdicios, resultados] = await Promise.all([
      // Membros, desperdícios e resultados moram em DUAS tabelas cada,
      // uma por origem. A do Kaizen aberto foi resolvida acima (k.ORIGEM),
      // então cada consulta vai direto à tabela certa — nada de unir as
      // duas e torcer para os IDs não colidirem.
      runQuery(
        `SELECT m.NM_USUARIO, m.NM_POSICAO
           FROM ${ehHistorico ? FULL_HIST_MEMBROS_TABLE : FULL_MEMBROS_TABLE} me
           LEFT JOIN ${ehHistorico ? FULL_HIST_MDM_TABLE : FULL_MDM_TABLE} m ON m.ID_USUARIO = me.ID_USUARIO
          WHERE me.ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen]]
      ),
      runQuery(
        `SELECT d.NM_DESPERDICIO
           FROM ${ehHistorico ? FULL_HIST_KZ_DESPERDICIO_TABLE : FULL_KZ_DESPERDICIO_TABLE} kd
           JOIN ${FULL_DESPERDICIO_TABLE} d ON d.ID_DESPERDICIO = kd.ID_DESPERDICIO AND d.ID_IDIOMA = @idIdioma
          WHERE kd.ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen], ["idIdioma", sql.Int, idIdioma]]
      ),
      runQuery(
        `SELECT r.NM_RESULTADO, r.DS_RESULTADO
           FROM ${ehHistorico ? FULL_HIST_RESULTADO_KAIZEN_TABLE : FULL_RESULTADO_KAIZEN_TABLE} rk
           JOIN ${FULL_RESULTADOS_TABLE} r ON r.ID_RESULTADO = rk.ID_RESULTADO AND r.ID_IDIOMA = @idIdioma
          WHERE rk.ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen], ["idIdioma", sql.Int, idIdioma]]
      ),
    ]);

    res.json({
      ID_KAIZEN: k.ID_KAIZEN,
      ROTULO: rotuloIdKaizen(k.ID_KAIZEN, k.DT_CRIACAO),
      NM_KAIZEN: k.NM_KAIZEN,
      ID_STATUS: k.ID_STATUS,
      NM_STATUS: k.NM_STATUS,
      DS_STATUS: k.DS_STATUS,
      DT_CRIACAO: relogioLocal(k.DT_CRIACAO),
      DT_CONCLUSAO: relogioLocal(k.DT_CONCLUSAO),
      NM_CATEGORIA: k.NM_CATEGORIA,
      NM_REPLICACAO: k.NM_REPLICACAO,
      NM_LIDER: k.NM_LIDER,
      // Unidade do Kaizen (kzn_mdm_hierarquia.NM_SITE do autor) — é o que
      // o cabeçalho do modal mostra, a mesma unidade do card da lista.
      NM_SITE: k.NM_SITE,
      NM_ESTADO: k.NM_ESTADO,
      NM_CIDADE: k.NM_CIDADE,
      NM_APROVADOR: k.NM_APROVADOR,
      DS_PROBLEMA: k.DS_PROBLEMA,
      DS_OBJETIVO: k.DS_OBJETIVO,
      URL_IMG_ANTES: k.URL_IMG_ANTES,
      DS_ESTADO_ANTES: k.DS_ESTADO_ANTES,
      URL_IMG_DEPOIS: k.URL_IMG_DEPOIS,
      DS_ESTADO_DEPOIS: k.DS_ESTADO_DEPOIS,
      URL_REFERENCIA: k.URL_REFERENCIA,
      DS_LICOES_APRENDIDAS: k.DS_LICOES_APRENDIDAS,
      // A "Comparação com a Meta Inicial". O nome do campo na RESPOSTA
      // fica como estava para não mexer em quem consome (o modal e o
      // relatório A4); o que mudou foi de onde ele vem — a fonte
      // unificada resolve a coluna dos dois lados do UNION.
      DS_RESULTADO_ESPERADO: k.DS_COMPARA_META,
      VL_RESULTADO_FINANCEIRO: k.VL_RESULTADO_FINANCEIRO,
      SG_MOEDA: k.SG_MOEDA,
      NM_MOEDA: k.NM_MOEDA,
      MEMBROS: membros.recordset,
      DESPERDICIOS: desperdicios.recordset.map((r) => r.NM_DESPERDICIO),
      RESULTADOS: resultados.recordset,
    });
  } catch (err) {
    console.error("[kaizens/:id] erro:", err.message);
    res.status(500).json(corpoErroSql("Erro ao consultar o Kaizen: ", err));
  }
});

// ------------------------------------------------------------------
// Aprovação (aprovacao.html) — fila pessoal + aprovar/reprovar. Só
// aparece pro usuário logado se ele for o ID_APROVADOR do Kaizen (via
// kzn_aprovador.ID_USUARIO), nunca por cargo/admin geral.
// ------------------------------------------------------------------

// GET /aprovacoes — fila de pendentes (ID_STATUS do status configurado) do
// aprovador logado.
// GET /aprovacoes/contagem — só o número, pro badge laranja do menu
// (Aprovação) em todas as telas. Ver js/vbm-app.js.
apiRouter.get("/aprovacoes/contagem", async (req, res) => {
  try {
    const idUsuario = await idUsuarioLogado(req);
    if (!idUsuario) return res.json({ qtd: 0 });
    const idsFila = await idsNaFilaDeAprovacao();
    const r = await runQuery(
      `SELECT COUNT(*) AS QTD FROM ${FULL_PVC_TABLE} p
       JOIN ${FULL_TABLE_NAME} a ON a.ID_APROVADOR = p.ID_APROVADOR AND a.ID_USUARIO = @idUsuario
       WHERE ${filtroPendente(idsFila)}`,
      paramsComPendente([["idUsuario", sql.Int, idUsuario]], idsFila)
    );
    res.json({ qtd: r.recordset[0].QTD });
  } catch (err) {
    console.error("[aprovacoes/contagem] erro:", err.message);
    res.json({ qtd: 0 });
  }
});

apiRouter.get("/aprovacoes", async (req, res) => {
  try {
    const idUsuario = await idUsuarioLogado(req);
    if (!idUsuario) return res.status(401).json({ error: "Não foi possível identificar o usuário logado." });
    const idIdioma = idIdiomaDaRequisicao(req);
    const idsFila = await idsNaFilaDeAprovacao();
    const colAtualizacaoPvc = await colunaAtualizacaoPvc();

    const result = await runQuery(
      `SELECT p.ID_KAIZEN, p.NM_KAIZEN, p.${colAtualizacaoPvc} AS DT_CRIACAO, cat.NM_CATEGORIA,
              lider.NM_USUARIO AS NM_LIDER, lider.NM_ESTADO, lider.NM_CIDADE,
              p.ID_STATUS, st.NM_STATUS
       FROM ${FULL_PVC_TABLE} p
       LEFT JOIN ${FULL_STATUS_TABLE} st ON st.ID_STATUS = p.ID_STATUS AND st.ID_IDIOMA = @idIdioma
       JOIN ${FULL_TABLE_NAME} a ON a.ID_APROVADOR = p.ID_APROVADOR AND a.ID_USUARIO = @idUsuario
       LEFT JOIN ${FULL_CATEGORIA_TABLE} cat ON cat.ID_CATEGORIA = p.ID_CATEGORIA AND cat.ID_IDIOMA = @idIdioma
       LEFT JOIN ${FULL_MDM_TABLE} lider ON lider.ID_USUARIO = p.ID_USUARIO_LIDER
       WHERE ${filtroPendente(idsFila)}
       ORDER BY p.${colAtualizacaoPvc} ASC`,
      paramsComPendente([["idUsuario", sql.Int, idUsuario], ["idIdioma", sql.Int, idIdioma]], idsFila)
    );
    res.json(result.recordset.map((r) => ({
      ID_KAIZEN: r.ID_KAIZEN,
      ROTULO: rotuloIdKaizen(r.ID_KAIZEN, r.DT_CRIACAO),
      NM_KAIZEN: r.NM_KAIZEN,
      DT_CRIACAO: relogioLocal(r.DT_CRIACAO),
      NM_CATEGORIA: r.NM_CATEGORIA,
      NM_LIDER: r.NM_LIDER,
      NM_ESTADO: r.NM_ESTADO,
      NM_CIDADE: r.NM_CIDADE,
      // A fila tem dois status agora; a tela precisa distinguir o
      // Kaizen novo do que voltou revisado.
      ID_STATUS: r.ID_STATUS,
      NM_STATUS: r.NM_STATUS,
    })));
  } catch (err) {
    console.error("[aprovacoes] erro ao listar:", err.message);
    res.status(500).json(corpoErroSql("Erro ao consultar aprovações: ", err));
  }
});

/** Situação do Kaizen diante de quem está tentando decidir.
 *
 *  Antes isto era um booleano ("sou o aprovador?"), e três situações
 *  MUITO diferentes caíam na mesma resposta: o Kaizen não existe, a
 *  pessoa não é a aprovadora dele, ou ele já foi decidido. O aprovador
 *  legítimo que clicava duas vezes lia "você não é o aprovador
 *  designado" — mensagem errada, que manda investigar permissão quando
 *  o problema é que a decisão já está gravada.
 *
 *  Uma consulta só, pela chave única, devolvendo os três fatos: existe,
 *  é o aprovador designado, e em que status está. O critério de "é o
 *  aprovador" é IDÊNTICO ao da fila (kzn_aprovador.ID_APROVADOR +
 *  ID_USUARIO) de propósito: o que aparece na fila tem de poder ser
 *  decidido, sem um segundo critério para divergir. Admin não entra —
 *  só o aprovador designado decide. */
async function situacaoDaDecisao(idKaizen, idUsuario) {
  const idsFila = await idsNaFilaDeAprovacao();
  const r = await runQuery(
    `SELECT p.ID_STATUS,
            EH_APROVADOR = CASE WHEN EXISTS (
              SELECT 1 FROM ${FULL_TABLE_NAME} a
               WHERE a.ID_APROVADOR = p.ID_APROVADOR AND a.ID_USUARIO = @idUsuario
            ) THEN 1 ELSE 0 END
       FROM ${FULL_PVC_TABLE} p
      WHERE p.ID_KAIZEN = @idKaizen`,
    [["idKaizen", sql.Int, idKaizen], ["idUsuario", sql.Int, idUsuario]]
  );
  const linha = r.recordset[0];
  if (!linha) return { existe: false, autorizado: false, pendente: false, idStatus: null };
  // Mesma regra da fila: aguardando aprovação OU revisado. Se aparece
  // na fila, tem de poder ser decidido — um segundo critério aqui faria
  // o aprovador ver um Kaizen que não consegue aprovar.
  const pendente = idsFila.length ? idsFila.includes(linha.ID_STATUS) : linha.ID_STATUS == null;
  return {
    existe: true,
    autorizado: linha.EH_APROVADOR === 1,
    pendente,
    idStatus: linha.ID_STATUS == null ? null : linha.ID_STATUS,
  };
}

/** REGRA ÚNICA de quem pode editar um Kaizen:
 *
 *      podeEditar = ORIGEM atual E (autor OU aprovador designado OU administrador)
 *
 *  Um lugar só, usado pela listagem (para a Biblioteca decidir se mostra
 *  o ícone), pela carga do formulário e pela gravação. Front escondendo
 *  o ícone não é controle: o navegador manda o que quiser, então TODA
 *  rota de edição chama esta função antes de ler ou gravar.
 *
 *  Nada de comparar nome. As chaves são as oficiais:
 *    · autor      → ID_USUARIO_CADASTRO (líder como reserva nos Kaizens
 *                   antigos, quando a coluna está nula);
 *    · aprovador  → kzn_aprovador.CD_MATRICULA, comparada pela mesma
 *                   MATRICULA_IGUAL do resto do sistema (cobre matrícula
 *                   numérica x texto, com zero à esquerda ou letra);
 *    · admin      → perfilDeAcesso(req), a mesma verificação de kzn_admin
 *                   já usada pelo gate da API.
 *
 *  Kaizen histórico (ORIGEM = 'H') nunca é editável, nem por admin: são
 *  registros arquivados, e o aprovador da época costuma já estar
 *  inativo — apurar autor/aprovador/admin para ele só produziria falsos
 *  positivos ("Aprovador indisponível") num vínculo que não deveria
 *  poder mudar. A checagem some ANTES das outras, e não junto: assim
 *  nenhuma condição do OR consegue reabrir a edição para um histórico.
 *
 *  O SQL abaixo é o mesmo usado na listagem, para a decisão da tela e a
 *  do servidor não poderem divergir. */
const SQL_PODE_EDITAR = (aliasPvc) => `
  CASE WHEN ${aliasPvc}.ORIGEM = 'A' AND (
         @ehAdmin = 1
         OR ISNULL(${aliasPvc}.ID_USUARIO_CADASTRO, ${aliasPvc}.ID_USUARIO_LIDER) = @idUsuarioLogado
         OR EXISTS (
              SELECT 1 FROM ${FULL_TABLE_NAME} ae
               WHERE ae.ID_APROVADOR = ${aliasPvc}.ID_APROVADOR
                 AND ae.SG_ATIVO IN ${SG_ATIVO_SIM_SQL}
                 AND EXISTS (SELECT 1 FROM ${FULL_MDM_TABLE} me
                              WHERE me.ID_USUARIO = @idUsuarioLogado
                                AND ${MATRICULA_IGUAL("me.CD_MATRICULA", "ae.CD_MATRICULA")})
            )
       ) THEN 1 ELSE 0 END`;

/** Status em que o Kaizen ainda pode ser editado: "Aguardando
 *  aprovação" e "Solicitado alterações" — 3 e 4 no cadastro atual.
 *
 *  Resolvidos pelo mesmo idDoStatus() do resto do sistema, e não fixos
 *  no código, para acompanharem o cadastro. Os números da regra ficam
 *  como reserva: se a resolução falhar, a edição não pode passar a
 *  aceitar qualquer status. A comparação é sempre por ID — nome
 *  traduzido não decide nada. */
const ID_STATUS_EDITAVEIS_PADRAO = [3, 4];

async function idsStatusEditaveis() {
  const [aguardando, alteracao] = await Promise.all([
    idDoStatus("emAprovacao"),
    idDoStatus("alteracao"),
  ]);
  const ids = [aguardando, alteracao].filter((x) => Number.isInteger(x));
  return ids.length ? ids : ID_STATUS_EDITAVEIS_PADRAO;
}

/** Contexto de autorização do usuário logado: os parâmetros que o
 *  SQL_PODE_EDITAR e o SQL_STATUS_EDITAVEL precisam. Resolvido no
 *  servidor, nunca recebido do navegador. */
async function contextoDeEdicao(req) {
  const perfil = await perfilDeAcesso(req);
  const idUsuario = await idUsuarioLogado(req);
  const editaveis = await idsStatusEditaveis();
  return {
    idUsuario,
    admin: !!perfil.admin,
    editaveis,
    params: [
      ["ehAdmin", sql.Bit, perfil.admin ? 1 : 0],
      ["idUsuarioLogado", sql.Int, idUsuario ?? -1],
      ["statusEdit1", sql.Int, editaveis[0] ?? -1],
      ["statusEdit2", sql.Int, editaveis[1] ?? editaveis[0] ?? -1],
    ],
  };
}

/** Status permite editar? Parametrizado, nunca com o número no SQL. */
const SQL_STATUS_EDITAVEL = (aliasPvc) =>
  `CASE WHEN ${aliasPvc}.ID_STATUS IN (@statusEdit1, @statusEdit2) THEN 1 ELSE 0 END`;

/** REGRA ÚNICA de quem pode EXCLUIR um Kaizen: dono OU administrador —
 *  sem o aprovador, que SQL_PODE_EDITAR inclui e este não. Mesma exigência
 *  de ORIGEM='A' do PODE_EDITAR e pelo mesmo motivo: histórico é acervo
 *  arquivado, nunca alvo de exclusão pela tela (nem para admin). */
const SQL_PODE_EXCLUIR = (aliasPvc) => `
  CASE WHEN ${aliasPvc}.ORIGEM = 'A' AND (
         @ehAdmin = 1
         OR ISNULL(${aliasPvc}.ID_USUARIO_CADASTRO, ${aliasPvc}.ID_USUARIO_LIDER) = @idUsuarioLogado
       ) THEN 1 ELSE 0 END`;

/** Status permite excluir? "Aprovado" e "Rejeitado" (= NOMES_DO_STATUS.
 *  reprovado) são os dois únicos que bloqueiam — qualquer outro libera. */
const SQL_STATUS_EXCLUIVEL = (aliasPvc) =>
  `CASE WHEN ${aliasPvc}.ID_STATUS NOT IN (@statusAprovado, @statusReprovado) THEN 1 ELSE 0 END`;

/** Resposta direta para UM Kaizen: existe? e este usuário pode editar? */
async function podeEditarKaizen(req, idKaizen, origem) {
  const ctx = await contextoDeEdicao(req);
  // A mesma regra de autorização vale para atual e histórico. Quem
  // decide a TABELA é a origem que veio da tela, conferida aqui: o
  // registro tem de existir NAQUELA tabela.
  //
  // Com origem informada — é o caso normal: edição, PUT e o upload de
  // imagem já mandam a origem —, fonteBiblioteca(origem) devolve só
  // aquele lado, e o comando SQL não cita a outra tabela: não precisa
  // WHERE para "não olhar" a tabela errada, porque ela nem aparece no
  // texto do comando.
  //
  // Sem origem (só se a tela mandar algo inválido no upload de
  // imagem), olha as duas; se o mesmo ID estiver nas duas, é AMBÍGUO e
  // a resposta é "não pode": gravar por cima do Kaizen errado é pior
  // do que recusar.
  const fonteKaizens = await fonteBiblioteca(origem || undefined);
  const params = ctx.params.concat([["idKaizen", sql.Int, idKaizen]]);
  const r = await runQuery(
    `SELECT PODE_EDITAR = ${SQL_PODE_EDITAR("p")},
            STATUS_EDITAVEL = ${SQL_STATUS_EDITAVEL("p")},
            p.ID_STATUS, p.ORIGEM
       FROM ${fonteKaizens} p WHERE p.ID_KAIZEN = @idKaizen`,
    params
  );
  if (!r.recordset.length) return { existe: false, pode: false, statusPermite: false, idUsuario: ctx.idUsuario };
  if (r.recordset.length > 1) {
    console.warn(`[edicao] ID_KAIZEN=${idKaizen} existe nas DUAS tabelas e a origem não foi informada — recusado.`);
    return { existe: true, pode: false, ambigua: true, statusPermite: false, idUsuario: ctx.idUsuario };
  }
  const linha = r.recordset[0];
  return {
    existe: true,
    pode: linha.PODE_EDITAR === 1,
    statusPermite: linha.STATUS_EDITAVEL === 1,
    idStatus: linha.ID_STATUS,
    origem: linha.ORIGEM,
    idUsuario: ctx.idUsuario,
  };
}

// Mesma recusa nos dois pontos que leem/gravam a edição: o status é
// conferido de novo no servidor, então mudar de status entre abrir a
// tela e salvar barra a gravação em vez de deixá-la passar.
const ERRO_STATUS_NAO_EDITAVEL =
  "Este Kaizen não pode mais ser editado: o status atual não permite edição.";

/** Resposta direta para UM Kaizen: existe (na tabela ATUAL)? e este
 *  usuário pode excluir? Mesma dupla checagem de podeEditarKaizen — o
 *  botão escondido no front não é controle, então DELETE /kaizens/:id
 *  chama esta função antes de apagar qualquer linha. */
async function podeExcluirKaizen(req, idKaizen) {
  const perfil = await perfilDeAcesso(req);
  const idUsuario = await idUsuarioLogado(req);
  const [statusAprovadoId, statusReprovadoId] = await Promise.all([
    idDoStatus("aprovado"),
    idDoStatus("reprovado"),
  ]);
  const params = [
    ["ehAdmin", sql.Bit, perfil.admin ? 1 : 0],
    ["idUsuarioLogado", sql.Int, idUsuario ?? -1],
    ["statusAprovado", sql.Int, statusAprovadoId ?? -1],
    ["statusReprovado", sql.Int, statusReprovadoId ?? -1],
    ["idKaizen", sql.Int, idKaizen],
  ];
  // ORIGEM não é coluna física — só existe dentro de fonteBiblioteca(),
  // que a calcula ('A'/'H') para o UNION. SQL_PODE_EXCLUIR referencia
  // p.ORIGEM, então a fonte tem de ser essa, nunca a tabela física direto
  // (era o bug: "Invalid column name 'ORIGEM'").
  const r = await runQuery(
    `SELECT PODE_EXCLUIR = ${SQL_PODE_EXCLUIR("p")},
            STATUS_EXCLUIVEL = ${SQL_STATUS_EXCLUIVEL("p")},
            p.NM_KAIZEN
       FROM ${await fonteBiblioteca("A")} p WHERE p.ID_KAIZEN = @idKaizen`,
    params
  );
  if (!r.recordset.length) return { existe: false, pode: false, idUsuario };
  const linha = r.recordset[0];
  return {
    existe: true,
    pode: linha.PODE_EXCLUIR === 1,
    statusPermite: linha.STATUS_EXCLUIVEL === 1,
    nome: linha.NM_KAIZEN,
    idUsuario,
  };
}

/** Dados do Kaizen + destinatários, do jeito que os comunicados pedem.
 *
 *  Relê a linha do banco em vez de reaproveitar o que veio da tela: o
 *  comunicado tem de descrever o que ficou gravado, não o que alguém
 *  digitou.
 *
 *  Dono do Kaizen: ID_USUARIO_CADASTRO (o líder é a reserva nos Kaizens
 *  antigos, quando a coluna está nula). Participantes: kzn_membros_equipe.
 *  Aprovador: kzn_aprovador pela CD_MATRICULA — é ela que diz QUEM
 *  recebeu o direito (ID_USUARIO nessa tabela é quem concedeu).
 *
 *  Categoria e status vêm nos DOIS idiomas, porque o e-mail é bilíngue. */
async function dadosDoComunicado(idKaizen, idUsuarioAcao) {
  const colAtualizacaoPvc = await colunaAtualizacaoPvc();
  const r = await runQuery(
    `SELECT p.ID_KAIZEN, p.NM_KAIZEN, p.DS_MOTIVO, p.ID_STATUS, p.${colAtualizacaoPvc} AS DT_ATUALIZACAO,
            autor.NM_USUARIO AS NM_AUTOR, autor.CD_EMAIL AS EMAIL_AUTOR,
            autor.NM_SITE, autor.NM_CIDADE, autor.NM_ESTADO,
            aprov.NM_USUARIO AS NM_APROVADOR, aprov.CD_EMAIL AS EMAIL_APROVADOR,
            acao.NM_USUARIO AS NM_ACAO,
            catPt.NM_CATEGORIA AS CATEGORIA_PT, catEn.NM_CATEGORIA AS CATEGORIA_EN,
            stPt.NM_STATUS AS STATUS_PT, stEn.NM_STATUS AS STATUS_EN
       FROM ${FULL_PVC_TABLE} p
       OUTER APPLY (
         SELECT TOP (1) x.NM_USUARIO, x.CD_EMAIL, x.NM_SITE, x.NM_CIDADE, x.NM_ESTADO
           FROM ${FULL_MDM_TABLE} x
          WHERE x.ID_USUARIO = ISNULL(p.ID_USUARIO_CADASTRO, p.ID_USUARIO_LIDER)
          ORDER BY x.ID_TIPO_USUARIO
       ) autor
       OUTER APPLY (
         SELECT TOP (1) x.NM_USUARIO, x.CD_EMAIL
           FROM ${FULL_TABLE_NAME} a
           JOIN ${FULL_MDM_TABLE} x ON ${PESSOA_DO_APROVADOR("a")}
          WHERE a.ID_APROVADOR = p.ID_APROVADOR
          ORDER BY ${ORDEM_PESSOA_DO_APROVADOR("a")}
       ) aprov
       OUTER APPLY (
         SELECT TOP (1) y.NM_USUARIO FROM ${FULL_MDM_TABLE} y
          WHERE y.ID_USUARIO = @idUsuarioAcao ORDER BY y.ID_TIPO_USUARIO
       ) acao
       LEFT JOIN ${FULL_CATEGORIA_TABLE} catPt ON catPt.ID_CATEGORIA = p.ID_CATEGORIA AND catPt.ID_IDIOMA = @idPt
       LEFT JOIN ${FULL_CATEGORIA_TABLE} catEn ON catEn.ID_CATEGORIA = p.ID_CATEGORIA AND catEn.ID_IDIOMA = @idEn
       LEFT JOIN ${FULL_STATUS_TABLE} stPt ON stPt.ID_STATUS = p.ID_STATUS AND stPt.ID_IDIOMA = @idPt
       LEFT JOIN ${FULL_STATUS_TABLE} stEn ON stEn.ID_STATUS = p.ID_STATUS AND stEn.ID_IDIOMA = @idEn
      WHERE p.ID_KAIZEN = @idKaizen`,
    [["idKaizen", sql.Int, idKaizen], ["idUsuarioAcao", sql.Int, idUsuarioAcao],
     ["idPt", sql.Int, ID_IDIOMA_PT], ["idEn", sql.Int, ID_IDIOMA_EN]]
  );
  const k = r.recordset[0];
  if (!k) return null;

  const equipe = await runQuery(
    `SELECT DISTINCT m.CD_EMAIL FROM ${FULL_MEMBROS_TABLE} me
       JOIN ${FULL_MDM_TABLE} m ON m.ID_USUARIO = me.ID_USUARIO
      WHERE me.ID_KAIZEN = @idKaizen AND m.CD_EMAIL IS NOT NULL`,
    [["idKaizen", sql.Int, idKaizen]]
  );

  return {
    // Dono + participantes: é a lista dos quatro comunicados de equipe.
    equipe: [k.EMAIL_AUTOR, ...equipe.recordset.map((m) => m.CD_EMAIL)],
    emailAprovador: k.EMAIL_APROVADOR,
    dados: {
      idKaizen: k.ID_KAIZEN,
      idStatus: k.ID_STATUS,
      codigo: rotuloIdKaizen(k.ID_KAIZEN, k.DT_ATUALIZACAO),
      titulo: k.NM_KAIZEN,
      site: k.NM_SITE || k.NM_CIDADE || k.NM_ESTADO,
      nomeAutor: k.NM_AUTOR,
      // Dois nomes diferentes de propósito: no comunicado de decisão o
      // "Aprovador" é quem decidiu; no do cadastro é o designado, que
      // ainda não decidiu nada. Quem escolhe é cada chamador.
      nomeDecisor: k.NM_ACAO,
      nomeAprovadorDesignado: k.NM_APROVADOR,
      categoriaPt: k.CATEGORIA_PT,
      categoriaEn: k.CATEGORIA_EN || k.CATEGORIA_PT,
      statusPt: k.STATUS_PT,
      statusEn: k.STATUS_EN || k.STATUS_PT,
      dataDecisao: k.DT_ATUALIZACAO,
      motivo: k.DS_MOTIVO,
    },
  };
}

/** Comunicados de uma DECISÃO: um só, para o dono e os participantes. */
async function avisosDaDecisao(momento, idKaizen, idUsuario) {
  try {
    const c = await dadosDoComunicado(idKaizen, idUsuario);
    if (!c) {
      console.warn(`[email] ID_KAIZEN=${idKaizen} não encontrado para montar o comunicado.`);
      return [{ erro: "Kaizen não encontrado" }];
    }
    const dados = { ...c.dados, nomeAprovador: c.dados.nomeDecisor || c.dados.nomeAprovadorDesignado };
    return [montarAviso(momento, c.equipe, dados)];
  } catch (err) {
    console.error(`[email] falha ao montar o comunicado de ID_KAIZEN=${idKaizen}: ${err.message}`);
    return [{ erro: err.message }];
  }
}

/** Comunicado da REVISÃO: o aprovador designado é avisado de que o
 *  Kaizen voltou revisado. Reusa o mesmo template do cadastro — para
 *  quem aprova, a ação pedida é a mesma: analisar o Kaizen. */
async function avisosDaRevisao(idKaizen, idUsuario) {
  try {
    const c = await dadosDoComunicado(idKaizen, idUsuario);
    if (!c) return [{ erro: "Kaizen não encontrado" }];
    const dados = { ...c.dados, nomeAprovador: c.dados.nomeAprovadorDesignado };
    return [montarAviso("pendenteAprovacao", [c.emailAprovador], dados)];
  } catch (err) {
    console.error(`[email] falha ao montar o aviso da revisão de ID_KAIZEN=${idKaizen}: ${err.message}`);
    return [{ erro: err.message }];
  }
}

/** Comunicados do CADASTRO: um para o dono e os participantes, outro
 *  para quem vai aprovar — com o link da fila. São dois e-mails porque
 *  são dois públicos com pedidos diferentes. */
async function avisosDoCadastro(idKaizen, idUsuario) {
  try {
    const c = await dadosDoComunicado(idKaizen, idUsuario);
    if (!c) {
      console.warn(`[email] ID_KAIZEN=${idKaizen} não encontrado para montar o comunicado.`);
      return [{ erro: "Kaizen não encontrado" }];
    }
    // No cadastro o "Aprovador" do texto é o designado, não quem cadastrou.
    const dados = { ...c.dados, nomeAprovador: c.dados.nomeAprovadorDesignado };
    return [
      montarAviso("cadastrado", c.equipe, dados),
      montarAviso("pendenteAprovacao", [c.emailAprovador], dados),
    ];
  } catch (err) {
    console.error(`[email] falha ao montar o comunicado de ID_KAIZEN=${idKaizen}: ${err.message}`);
    return [{ erro: err.message }];
  }
}

/** Registra uma decisão do aprovador. Aprovar, reprovar e solicitar
 *  alteração só diferem em três coisas — o status gravado, se o motivo
 *  é obrigatório e se a decisão encerra o Kaizen —, então dividem o
 *  mesmo caminho: validação, permissão, limite de texto e gravação em
 *  um lugar só. */
async function registrarDecisao(req, res, opcoes) {
  try {
    const idKaizen = parseInt(req.params.id, 10);
    if (!Number.isInteger(idKaizen) || idKaizen <= 0) {
      return res.status(400).json({ error: "Kaizen inválido." });
    }
    const motivo = String((req.body && req.body.motivo) || "").trim();

    if (opcoes.motivoObrigatorio && !motivo) {
      return res.status(400).json({ error: opcoes.erroMotivo });
    }
    // Limite conferido contra a coluna real, não contra o DER.
    const limiteMotivo = await limiteDsMotivo();
    if (motivo.length > limiteMotivo) {
      return res.status(400).json({
        error: `Motivo deve ter no máximo ${limiteMotivo} caracteres.`,
      });
    }

    const idUsuario = await idUsuarioLogado(req);
    if (!idUsuario) return res.status(401).json({ error: "Não foi possível identificar o usuário logado." });

    // Uma validação só para as três decisões, com uma resposta
    // diferente por causa: cada mensagem manda a pessoa para o lugar
    // certo em vez de sugerir falta de permissão em todos os casos.
    const situacao = await situacaoDaDecisao(idKaizen, idUsuario);
    if (!situacao.existe) {
      console.warn(`[decisao] ID_KAIZEN=${idKaizen} não existe (usuário ${idUsuario}, momento ${opcoes.momento})`);
      return res.status(404).json({ error: "Kaizen não encontrado." });
    }
    if (!situacao.autorizado) {
      console.warn(`[decisao] usuário ${idUsuario} não é o aprovador de ID_KAIZEN=${idKaizen} (momento ${opcoes.momento})`);
      return res.status(403).json({ error: "Usuário não autorizado para decidir este Kaizen." });
    }
    if (!situacao.pendente) {
      console.warn(`[decisao] ID_KAIZEN=${idKaizen} já decidido (ID_STATUS=${situacao.idStatus}); usuário ${idUsuario}, momento ${opcoes.momento}`);
      return res.status(409).json({ error: "Este Kaizen já possui uma decisão registrada." });
    }

    const idStatus = await idDoStatus(opcoes.momento);
    if (idStatus == null) return res.status(503).json({ error: ERRO_STATUS_NAO_CONFIGURADO });

    // DS_MOTIVO:
    //   · com texto  -> grava o texto (parametrizado);
    //   · APROVADO sem texto -> grava NULL, limpando o motivo de uma
    //     decisão anterior (reprovação ou pedido de alteração) que não
    //     vale mais depois da aprovação. NULL literal no comando, não
    //     parâmetro vazio: string vazia e espaço em branco não podem
    //     chegar à coluna;
    //   · demais momentos sem texto -> a coluna nem entra no SET (na
    //     prática não acontece: reprovar e solicitar alteração exigem
    //     motivo antes de chegar aqui).
    //
    // `motivo` já veio com trim, então "   " conta como vazio.
    const gravaMotivo = motivo.length > 0;
    const limpaMotivo = !gravaMotivo && opcoes.momento === "aprovado";
    const setMotivo = gravaMotivo ? ", DS_MOTIVO = @motivo" : (limpaMotivo ? ", DS_MOTIVO = NULL" : "");
    const params = [
      ["idKaizen", sql.Int, idKaizen], ["idUsuario", sql.Int, idUsuario],
      ["idStatus", sql.Int, idStatus],
    ];
    if (gravaMotivo) params.push(["motivo", sql.NVarChar(limiteMotivo), motivo]);

    // DT_CONCLUSAO na aprovação: só preenche quando está VAZIA. A data
    // de conclusão agora é informada pelo autor na Etapa 4, e ela é a
    // data em que o Kaizen ficou pronto — não a data em que o aprovador
    // clicou. Sobrescrever apagaria o que o autor registrou. Quando o
    // campo veio vazio, o comportamento antigo continua valendo: a
    // aprovação carimba a data do dia.
    const setConclusao = opcoes.conclui
      ? `, DT_CONCLUSAO = ISNULL(DT_CONCLUSAO, CAST(${AGORA_BRASILIA} AS DATE))`
      : "";

    // Status e DS_MOTIVO saem no MESMO UPDATE, sempre parametrizado e
    // sempre pela chave única ID_KAIZEN. Um único comando é atômico no
    // SQL Server: ou as duas colunas gravam, ou nenhuma — não existe o
    // estado intermediário "reprovado sem motivo". Dividir em dois
    // comandos é que exigiria transação explícita.
    const colAtualizacaoPvc = await colunaAtualizacaoPvc();
    const gravacao = await runQuery(
      `UPDATE ${FULL_PVC_TABLE}
       SET ID_STATUS = @idStatus${setMotivo}${setConclusao},
           ${colAtualizacaoPvc} = ${AGORA_BRASILIA}, ID_USUARIO_ATUALIZACAO = @idUsuario
       WHERE ID_KAIZEN = @idKaizen`,
      params
    );
    // Zero linhas = o Kaizen sumiu entre a checagem e a gravação.
    // Responder ok aqui faria a tela comemorar uma decisão que não foi
    // gravada em lugar nenhum.
    const linhas = gravacao.rowsAffected ? gravacao.rowsAffected[0] : 1;
    if (!linhas) {
      console.error(`[${opcoes.momento}] nenhuma linha atualizada para ID_KAIZEN=${idKaizen}`);
      return res.status(409).json({ error: "Não foi possível gravar a decisão: o Kaizen não está mais disponível." });
    }

    // Só aqui: a gravação terminou e afetou a linha. Antes disso não há
    // decisão para avisar, e um erro no caminho acima devolve sem
    // chegar nesta linha. O aviso vai MONTADO na resposta; quem entrega
    // ao Graph é a tela, com o token do aprovador logado (ver
    // js/envio-email.js). Montar aqui mantém o conteúdo preso ao que
    // está gravado no banco.
    const avisos = await avisosDaDecisao(opcoes.momento, idKaizen, idUsuario);
    res.json({ ok: true, ID_STATUS: idStatus, AVISOS: avisos });
  } catch (err) {
    console.error(`[${opcoes.momento}] erro:`, err.message);
    res.status(500).json({ error: "Erro ao registrar a decisão: " + err.message });
  }
}

// Aprovar — motivo OPCIONAL (é um comentário, não uma justificativa).
apiRouter.post("/kaizens/:id/aprovar", (req, res) =>
  registrarDecisao(req, res, { momento: "aprovado", motivoObrigatorio: false, conclui: true }));

// Reprovar — motivo obrigatório; o texto vai direto para PVC.DS_MOTIVO.
//
// Antes o motivo virava uma linha nova em kzn_motivo_reprovacao, nos 2
// idiomas, e o Kaizen guardava só o ID_MOTIVO. Essa tabela saiu do DER.
apiRouter.post("/kaizens/:id/reprovar", (req, res) =>
  registrarDecisao(req, res, {
    momento: "reprovado", motivoObrigatorio: true, conclui: false,
    erroMotivo: "Motivo da reprovação é obrigatório.",
  }));

// Solicitar alteração — devolve o Kaizen ao autor com o que corrigir.
// Não conclui: o Kaizen volta a andar depois do ajuste.
apiRouter.post("/kaizens/:id/solicitar-alteracao", (req, res) =>
  registrarDecisao(req, res, {
    momento: "alteracao", motivoObrigatorio: true, conclui: false,
    erroMotivo: "Descreva o que precisa ser corrigido.",
  }));

// PUT /kaizens/:id — EDIÇÃO. Nunca cria: quem tem ID entra por aqui e
// sai por aqui, com UPDATE pela chave única. O ID_KAIZEN e o código
// (derivado dele) ficam intocados, e o status vira "Revisado" — decidido
// no servidor, nunca aceito do corpo da requisição.
apiRouter.put("/kaizens/:id", async (req, res) => {
  const idKaizen = parseInt(req.params.id, 10);
  if (!Number.isInteger(idKaizen) || idKaizen <= 0) {
    return res.status(400).json({ error: "Kaizen inválido." });
  }
  const b = req.body || {};
  const { erros, dados } = lerKaizenDoCorpo(b);
  if (erros.length) return res.status(400).json({ error: erros[0], erros });

  // A ORIGEM que a tela recebeu no /edicao volta aqui, e é obrigatória:
  // ela decide em qual conjunto de tabelas o UPDATE cai. Ausente ou
  // inválida, nada é gravado — o servidor não adivinha a tabela pelo
  // ID, porque o mesmo número pode existir nas duas.
  const origem = origemValida(b.ORIGEM);
  if (!origem) {
    console.warn(`[edicao] PUT ID_KAIZEN=${idKaizen} sem origem válida (${JSON.stringify(b.ORIGEM)}) — recusado.`);
    return res.status(400).json({ error: "Origem do Kaizen não informada. Abra a edição pela Biblioteca e tente de novo." });
  }

  try {
    // 1. registro existe NA ORIGEM informada?  2. este usuário pode
    // editar?  Nesta ordem, e antes de qualquer gravação.
    const autoriz = await podeEditarKaizen(req, idKaizen, origem);
    if (!autoriz.existe) return res.status(404).json({ error: "Kaizen não encontrado." });
    if (!autoriz.pode) {
      console.warn(`[edicao] usuário ${autoriz.idUsuario} sem permissão para gravar ID_KAIZEN=${idKaizen}`);
      return res.status(403).json({ error: "Usuário não autorizado a editar este Kaizen." });
    }
    if (!autoriz.statusPermite) {
      console.warn(`[edicao] gravação recusada: ID_KAIZEN=${idKaizen} está em ID_STATUS=${autoriz.idStatus}`);
      return res.status(409).json({ error: ERRO_STATUS_NAO_EDITAVEL });
    }
    const idUsuario = autoriz.idUsuario;
    if (!idUsuario) return res.status(401).json({ error: "Não foi possível identificar o usuário logado." });

    /* Kaizen histórico é editado na TABELA DELE. Sem isto o UPDATE iria
       para a tabela atual, que não tem a linha: zero linhas afetadas,
       nenhum erro, alteração perdida em silêncio — e, se um dia os IDs
       colidirem, gravada por cima de outro Kaizen. As quatro tabelas
       andam juntas: cabeçalho, membros, desperdícios e resultados. */
    const ehHistorico = origem === "H";
    const tab = tabelasDaOrigem(origem);
    const tabelaPvc = tab.pvc;
    const tabelaMembros = tab.membros;
    const tabelaDesperdicio = tab.desperdicio;
    const tabelaResultado = tab.resultado;
    if (ehHistorico) console.log(`[edicao] ID_KAIZEN=${idKaizen} é HISTÓRICO — gravando em ${tabelaPvc}.`);

    // Mesma conferência do cadastro: o título é medido contra o tamanho
    // REAL da coluna, não contra o número do DER (ver limiteNmKaizen).
    const maxTitulo = await limiteNmKaizen();
    if (dados.titulo.length > maxTitulo) {
      return res.status(400).json({ error: `Título do Kaizen deve ter no máximo ${maxTitulo} caracteres.` });
    }

    // O nome NÃO pode barrar a atualização do próprio registro: a busca
    // ignora o ID que está sendo editado.
    if (await existeKaizenComMesmoNome(dados.titulo, idKaizen, origem)) {
      return res.status(409).json({ error: "Já existe outro Kaizen cadastrado com este nome." });
    }

    const revisado = await idStatusRevisado();
    if (revisado.erro) return res.status(503).json({ error: revisado.erro });

    const idAprovador = await idAprovadorPorUsuario(dados.idUsuarioAprovador);
    if (idAprovador == null) {
      return res.status(400).json({ error: "O usuário escolhido como aprovador não está ativo em kzn_aprovador." });
    }
    if (dados.idUsuarioLider && !(await ehValeAtivo(dados.idUsuarioLider))) {
      return res.status(400).json({ error: ERRO_LIDER_VALE });
    }

    const tipo = await conferirTipoKaizen(ehHistorico ? DB_HIST_PVC_TABLE : DB_PVC_TABLE, dados.idTipoKaizen);
    if (tipo.erro) return res.status(400).json({ error: tipo.erro });
    const gm = await conferirGestaoMudanca(ehHistorico ? DB_HIST_PVC_TABLE : DB_PVC_TABLE, dados.sgGm, dados.urlGm);
    if (gm.erro) return res.status(400).json({ error: gm.erro });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const r = new sql.Request(tx);
      r.input("idKaizen", sql.Int, idKaizen);
      r.input("idStatus", sql.Int, revisado.id);
      r.input("idUsuario", sql.Int, idUsuario);
      r.input("nmKaizen", sql.NVarChar(maxTitulo), dados.titulo);
      r.input("idCategoria", sql.Int, dados.idCategoria);
      r.input("idReplicacao", sql.Int, dados.idReplicacao);
      r.input("idAprovador", sql.Int, idAprovador);
      r.input("idUsuarioLider", sql.Int, dados.idUsuarioLider || idUsuario);
      if (tipo.grava) r.input("idTipoKaizen", sql.Int, dados.idTipoKaizen);
      if (gm.grava) {
        r.input("sgGm", sql.Char(1), dados.sgGm);
        r.input("urlGm", sql.NVarChar(PVC_LIMITES.URL_GM), gm.url);
      }
      r.input("dsProblema", sql.NVarChar(PVC_LIMITES.DS_PROBLEMA), dados.declaracaoProblema);
      r.input("dsObjetivo", sql.NVarChar(PVC_LIMITES.DS_OBJETIVO), dados.metaObjetivo);
      r.input("dsEstadoAntes", sql.NVarChar(PVC_LIMITES.DS_ESTADO_ANTES), dados.descricaoAntes);
      r.input("dsEstadoDepois", sql.NVarChar(PVC_LIMITES.DS_ESTADO_DEPOIS), dados.descricaoDepois);
      r.input("urlReferencia", sql.NVarChar(PVC_LIMITES.URL_REFERENCIA), dados.urlReferencia);
      r.input("dsLicoes", sql.NVarChar(PVC_LIMITES.DS_LICOES_APRENDIDAS), dados.licoesAprendidas);
      // Mesma troca de coluna do cadastro (ver colunaDaComparacaoMeta).
      const colComparaMeta = await colunaDaComparacaoMeta();
      r.input("dsComparaMeta", sql.NVarChar(PVC_LIMITES.DS_COMPARA_META), dados.comparacaoMeta);
      r.input("vlResultado", sql.Decimal(18, 2), dados.valorResultadoFinanceiro);
      r.input("idMoeda", sql.Int, dados.idMoeda);
      // Mesma coluna opcional do cadastro. Desligar o bloco "Outros" na
      // edição grava NULL de volta — é uma troca por completo, não um
      // acréscimo.
      const gravaDsResultado = await temColunaDsResultado();
      if (gravaDsResultado) r.input("dsResultado", sql.NVarChar(100), dados.descricaoResultadoOutros);
      // Mesma regra do cadastro: texto "YYYY-MM-DD" convertido pelo
      // banco. Limpar o campo na edição grava NULL de volta.
      r.input("dtConclusao", sql.VarChar(10), dados.dataConclusao);
      // Imagem só é trocada quando veio URL nova. Sem arquivo novo, a
      // coluna nem entra no SET: apagar a foto de quem só corrigiu um
      // texto seria perder o "antes" que ninguém consegue refazer.
      const trocaAntes = dados.urlImgAntes != null;
      const trocaDepois = dados.urlImgDepois != null;
      // Na edição a tela manda o ?id= no upload, então o arquivo já
      // nasce com o nome certo e a chamada abaixo não faz nada — nem uma
      // ida ao armazenamento. Ela existe para o caso de chegar um caminho
      // fora do padrão (uma aba aberta desde antes desta versão, por
      // exemplo): o nome é acertado em vez de entrar torto no banco.
      const nomeadas = await nomearImagensDoKaizen({
        novoAntes: trocaAntes ? dados.urlImgAntes : null,
        novoDepois: trocaDepois ? dados.urlImgDepois : null,
        idKaizen,
      });
      const novoAntes = nomeadas.antes;
      const novoDepois = nomeadas.depois;
      if (trocaAntes) r.input("urlImgAntes", sql.NVarChar(PVC_LIMITES.URL_IMG), novoAntes);
      if (trocaDepois) r.input("urlImgDepois", sql.NVarChar(PVC_LIMITES.URL_IMG), novoDepois);
      // Carimbo que a tela recebeu ao abrir. Se a linha mudou desde
      // então, outra pessoa gravou no meio e este UPDATE não acha nada.
      const carimbo = String(b.DT_ATUALIZACAO || "").trim();
      if (carimbo) r.input("carimbo", sql.NVarChar(40), carimbo);
      // Nome real da coluna nesta tabela — a histórica não foi tocada
      // pela renomeação da atual (ver colunaAtualizacaoPvc).
      const colAtualizacaoDestino = ehHistorico ? await colunaAtualizacaoHist() : await colunaAtualizacaoPvc();

      // FK_KZN_KAIZEN_HIERARQUIA_LIDER: a foto da hierarquia referencia
      // (ID_KAIZEN, ID_USUARIO_LIDER) da PVC, então trocar o líder no UPDATE
      // abaixo com a foto antiga ainda lá viola a FK (erro 547). Só quando
      // o líder muda, a foto sai aqui, na mesma transação; o
      // gravarHierarquiaDoKaizen pós-commit (logo abaixo) a recria com o
      // líder novo. Rollback devolve a foto antiga se algo falhar.
      const rHier = new sql.Request(tx);
      rHier.input("idKaizen", sql.Int, idKaizen);
      rHier.input("idUsuarioLider", sql.Int, dados.idUsuarioLider || idUsuario);
      await rHier.query(
        `DELETE FROM ${tab.hierarquia}
          WHERE ID_KAIZEN = @idKaizen AND ID_USUARIO_LIDER <> @idUsuarioLider`
      );

      const gravacao = await r.query(
        `UPDATE ${tabelaPvc}
            SET NM_KAIZEN = @nmKaizen,
                ID_CATEGORIA = @idCategoria,
                ID_REPLICACAO = @idReplicacao,
                ID_APROVADOR = @idAprovador,
                ID_USUARIO_LIDER = @idUsuarioLider,
${tipo.grava ? "                ID_TIPO_KAIZEN = @idTipoKaizen,\n" : ""}${gm.grava ? "                SG_GM = @sgGm, URL_GM = @urlGm,\n" : ""}                DS_PROBLEMA = @dsProblema,
                DS_OBJETIVO = @dsObjetivo,
                DS_ESTADO_ANTES = @dsEstadoAntes,
                DS_ESTADO_DEPOIS = @dsEstadoDepois,
                URL_REFERENCIA = @urlReferencia,
                DS_LICOES_APRENDIDAS = @dsLicoes,
                ${colComparaMeta} = @dsComparaMeta,
                VL_RESULTADO_FINANCEIRO = @vlResultado,
                ID_MOEDA = @idMoeda,${gravaDsResultado ? "\n                DS_RESULTADO_ALCANCADO = @dsResultado," : ""}
                DT_CONCLUSAO = CONVERT(DATE, @dtConclusao, 23),${trocaAntes ? "\n                URL_IMG_ANTES = @urlImgAntes," : ""}${trocaDepois ? "\n                URL_IMG_DEPOIS = @urlImgDepois," : ""}
                ID_STATUS = @idStatus,
                ${colAtualizacaoDestino} = ${AGORA_BRASILIA},
                ID_USUARIO_ATUALIZACAO = @idUsuario
          WHERE ID_KAIZEN = @idKaizen${carimbo ? `\n            AND CONVERT(VARCHAR(19), ${colAtualizacaoDestino}, 126) = @carimbo` : ""}`
      );

      const linhas = gravacao.rowsAffected ? gravacao.rowsAffected[0] : 0;
      // Exatamente UMA linha. Zero = alguém gravou antes (ou o Kaizen
      // sumiu); mais de uma seria WHERE errado e não pode passar.
      if (linhas !== 1) {
        await tx.rollback().catch(() => {});
        console.warn(`[edicao] ID_KAIZEN=${idKaizen}: ${linhas} linha(s) afetada(s) — nada gravado.`);
        return res.status(409).json({
          error: linhas === 0
            ? "Este Kaizen foi alterado por outra pessoa depois que você abriu a tela. Recarregue e refaça a edição."
            : "A atualização atingiria mais de um registro e foi cancelada.",
        });
      }

      // Equipe e desperdícios: listas de junção, trocadas por completo
      // dentro da MESMA transação — some tudo, entra o que veio da tela.
      const reqDelM = new sql.Request(tx);
      reqDelM.input("idKaizen", sql.Int, idKaizen);
      await reqDelM.query(`DELETE FROM ${tabelaMembros} WHERE ID_KAIZEN = @idKaizen`);
      for (const idMembro of dados.membros) {
        const reqM = new sql.Request(tx);
        reqM.input("idKaizen", sql.Int, idKaizen);
        reqM.input("idUsuario", sql.Int, idMembro);
        await reqM.query(
          `INSERT INTO ${tabelaMembros} (ID_KAIZEN, ID_USUARIO, DT_ATUALIZACAO)
           VALUES (@idKaizen, @idUsuario, ${AGORA_BRASILIA})`
        );
      }

      const reqDelD = new sql.Request(tx);
      reqDelD.input("idKaizen", sql.Int, idKaizen);
      await reqDelD.query(`DELETE FROM ${tabelaDesperdicio} WHERE ID_KAIZEN = @idKaizen`);
      for (const idDesp of dados.idsDesperdicio) {
        const reqD = new sql.Request(tx);
        reqD.input("idKaizen", sql.Int, idKaizen);
        reqD.input("idDesperdicio", sql.Int, idDesp);
        await reqD.query(
          `INSERT INTO ${tabelaDesperdicio} (ID_KAIZEN, ID_DESPERDICIO, DT_ATUALIZACAO)
           VALUES (@idKaizen, @idDesperdicio, ${AGORA_BRASILIA})`
        );
      }

      // Resultados: a MESMA troca por completo que membros e
      // desperdícios acabaram de fazer. Sem isto, mudar o resultado na
      // edição não gravava — o PUT nem tocava em kzn_resultado_kaizen, e
      // reabrir devolvia a escolha antiga.
      const quantosResultados = await gravarResultadosDoKaizen(tx, idKaizen, [
        dados.geraResultadoFinanceiro ? dados.idResultadoFinanceiro : null,
        dados.geraResultadoOutros ? dados.idResultadoOutros : null,
      ], tabelaResultado);

      await tx.commit();
      console.log(`[edicao] ID_KAIZEN=${idKaizen} atualizado por ${idUsuario}; ID_STATUS=${revisado.id}; ` +
        `${quantosResultados} resultado(s) vinculado(s).`);

      // Refaz a fotografia da hierarquia: o líder pode ter mudado nesta
      // edição, e a hierarquia dele pode ter mudado no MDM desde a
      // gravação anterior. O líder sai da própria linha, já atualizada
      // pelo UPDATE acima. Depois do commit, como no cadastro.
      await gravarHierarquiaDoKaizen(idKaizen, origem);

      // Reencaminha ao fluxo: o aprovador designado é avisado de novo,
      // pelo mesmo caminho do cadastro.
      const avisos = await avisosDaRevisao(idKaizen, idUsuario);
      res.json({ ok: true, ID_KAIZEN: idKaizen, ID_STATUS: revisado.id, AVISOS: avisos });
    } catch (errTx) {
      await tx.rollback().catch(() => {});
      throw errTx;
    }
  } catch (err) {
    console.error(`[edicao] erro ao atualizar ID_KAIZEN=${idKaizen}:`, err.message);
    res.status(err.number === 547 ? 409 : 500).json({ error: "Erro ao atualizar o Kaizen: " + err.message });
  }
});

// DELETE /kaizens/:id — exclusão. Só a tabela ATUAL: PODE_EXCLUIR já nega
// ORIGEM='H' (ver SQL_PODE_EXCLUIR), então nunca cai no histórico. Mesma
// dupla checagem de PUT /kaizens/:id — dono ou admin, e status fora de
// Aprovado/Rejeitado —, revalidada aqui: o botão escondido no front não é
// controle nenhum, e a chamada pode vir direto na API.
apiRouter.delete("/kaizens/:id", async (req, res) => {
  const idKaizen = parseInt(req.params.id, 10);
  if (!Number.isInteger(idKaizen) || idKaizen <= 0) {
    return res.status(400).json({ error: "Kaizen inválido." });
  }
  try {
    const autoriz = await podeExcluirKaizen(req, idKaizen);
    if (!autoriz.existe) return res.status(404).json({ error: "Kaizen não encontrado." });
    if (!autoriz.pode) {
      console.warn(`[exclusao] usuário ${autoriz.idUsuario} sem permissão para excluir ID_KAIZEN=${idKaizen}`);
      return res.status(403).json({ error: "Usuário não autorizado a excluir este Kaizen." });
    }
    if (!autoriz.statusPermite) {
      console.warn(`[exclusao] recusada: ID_KAIZEN=${idKaizen} está em status Aprovado/Rejeitado.`);
      return res.status(409).json({ error: "Este Kaizen não pode mais ser excluído: o status atual não permite exclusão." });
    }

    // Filhos (equipe, desperdícios, resultados) e cabeçalho, na mesma
    // transação — igual à troca de listas de junção que a edição já faz.
    const tab = tabelasDaOrigem("A");
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // Erro 547 confirmado em produção: FULL_LOG_PVC_DETALHE_TABLE tem FK
      // para FULL_LOG_PVC_TABLE (coluna ID_LOG) — precisa sumir ANTES do
      // log, via subconsulta (não tem ID_KAIZEN direto, só ID_LOG).
      const rDelDetalhe = new sql.Request(tx);
      rDelDetalhe.input("idKaizen", sql.Int, idKaizen);
      await rDelDetalhe.query(
        `DELETE FROM ${FULL_LOG_PVC_DETALHE_TABLE}
          WHERE ID_LOG IN (SELECT ID_LOG FROM ${FULL_LOG_PVC_TABLE} WHERE ID_KAIZEN = @idKaizen)`
      );
      // tabelasDaOrigem() devolve CINCO tabelas — tab.hierarquia
      // (kzn_kaizen_hierarquia, gravada a cada save por
      // gravarHierarquiaDoKaizen) também precisa sumir antes do
      // cabeçalho. FULL_LOG_PVC_TABLE (auditoria) idem, agora sem o
      // detalhe na frente bloqueando.
      for (const tabela of [tab.membros, tab.desperdicio, tab.resultado, tab.hierarquia, FULL_LOG_PVC_TABLE]) {
        const rDel = new sql.Request(tx);
        rDel.input("idKaizen", sql.Int, idKaizen);
        await rDel.query(`DELETE FROM ${tabela} WHERE ID_KAIZEN = @idKaizen`);
      }
      const rPvc = new sql.Request(tx);
      rPvc.input("idKaizen", sql.Int, idKaizen);
      const exclusao = await rPvc.query(`DELETE FROM ${tab.pvc} WHERE ID_KAIZEN = @idKaizen`);
      const linhas = exclusao.rowsAffected ? exclusao.rowsAffected[0] : 0;
      if (linhas !== 1) {
        await tx.rollback().catch(() => {});
        console.warn(`[exclusao] ID_KAIZEN=${idKaizen}: ${linhas} linha(s) afetada(s) — nada excluído.`);
        return res.status(409).json({ error: "Este Kaizen foi alterado por outra pessoa. Recarregue a Biblioteca e tente de novo." });
      }
      await tx.commit();
      console.log(`[exclusao] ID_KAIZEN=${idKaizen} (${autoriz.nome}) excluído por ${autoriz.idUsuario}.`);
      res.json({ ok: true, ID_KAIZEN: idKaizen });
    } catch (errTx) {
      await tx.rollback().catch(() => {});
      throw errTx;
    }
  } catch (err) {
    // Detalhe técnico completo só no log (ID_KAIZEN, origem, usuário,
    // número/mensagem do erro do banco) — a resposta ao navegador não
    // cita coluna/tabela nenhuma.
    console.error(
      `[exclusao] erro ao excluir ID_KAIZEN=${idKaizen} origem=A usuario=${req.get("X-Forwarded-Email") || "?"} ` +
      `sqlNumber=${err.number} sqlState=${err.state}:`, err.message
    );
    res.status(err.number === 547 ? 409 : 500).json({ error: "Não foi possível excluir o Kaizen. Tente novamente ou contate o administrador." });
  }
});

// GET /kaizens/:id/edicao — o registro completo para PREENCHER o
// formulário de cadastro em modo de edição. Rota separada da /kaizens/:id
// (que serve o detalhe de leitura) porque esta exige autorização de
// edição: é aqui que o acesso direto pela URL é barrado, não no front.
apiRouter.get("/kaizens/:id/edicao", async (req, res) => {
  try {
    const idKaizen = parseInt(req.params.id, 10);
    if (!Number.isInteger(idKaizen) || idKaizen <= 0) {
      return res.status(400).json({ error: "Kaizen inválido." });
    }
    // A ORIGEM vem da Biblioteca junto com o ID (kaizen-novo.html?id=&origem=)
    // e é obrigatória: é ela que diz em qual tabela ler — e, depois, em
    // qual gravar. Sem ela a rota não escolhe sozinha.
    const origem = origemValida(req.query.origem);
    if (!origem) {
      return res.status(400).json({ error: "Origem do Kaizen não informada. Abra a edição pela Biblioteca." });
    }
    const autoriz = await podeEditarKaizen(req, idKaizen, origem);
    if (!autoriz.existe) return res.status(404).json({ error: "Kaizen não encontrado." });
    if (!autoriz.pode) {
      console.warn(`[edicao] usuário ${autoriz.idUsuario} sem permissão para editar ID_KAIZEN=${idKaizen}`);
      return res.status(403).json({ error: "Usuário não autorizado a editar este Kaizen." });
    }
    if (!autoriz.statusPermite) {
      console.warn(`[edicao] ID_KAIZEN=${idKaizen} com ID_STATUS=${autoriz.idStatus} não permite edição`);
      return res.status(409).json({ error: ERRO_STATUS_NAO_EDITAVEL });
    }

    const idIdioma = idIdiomaDaRequisicao(req);
    // fonteBiblioteca(origem) — não fonteBiblioteca() — porque a
    // origem já é conhecida e obrigatória neste ponto (checada acima).
    // Com o argumento, o comando SQL só cita a tabela daquele lado: um
    // Kaizen ATUAL abre sem o texto do comando mencionar em nenhum
    // momento kzn_hist_pedravisaoconsolidada. Mesmas colunas nos dois
    // casos (p.* devolve a mesma lista, com DS_COMPARA_META e
    // DS_RESULTADO_ALCANCADO já resolvidas), só a tabela muda.
    const fonteKaizens = await fonteBiblioteca(origem);
    const tab = tabelasDaOrigem(origem);
    const [principal, membros, desperdicios, resultados] = await Promise.all([
      runQuery(
        // O aprovador do formulário é o ID_USUARIO da PESSOA (é o que a
        // lista /api/aprovadores devolve e o que o salvamento espera).
        // Na PVC está gravado o ID_APROVADOR, que é o registro do
        // vínculo — a ponte entre os dois é a CD_MATRICULA, que é quem
        // de fato recebeu o direito. Sem essa conversão o select abria
        // vazio, porque nenhuma opção tem o ID_APROVADOR como valor.
        `SELECT p.*, p.DT_ATUALIZACAO AS DT_CRIACAO,
                lider.NM_USUARIO AS NM_LIDER, lider.NM_SITE, lider.NM_ESTADO, lider.NM_CIDADE,
                autor.NM_USUARIO AS NM_AUTOR,
                st.NM_STATUS,
                apr.SG_ATIVO AS APROVADOR_ATIVO,
                aprPessoa.ID_USUARIO AS ID_USUARIO_APROVADOR,
                aprPessoa.NM_USUARIO AS NM_APROVADOR
           FROM ${fonteKaizens} p
           LEFT JOIN ${FULL_MDM_TABLE} lider ON lider.ID_USUARIO = p.ID_USUARIO_LIDER
           LEFT JOIN ${FULL_MDM_TABLE} autor ON autor.ID_USUARIO = p.ID_USUARIO_CADASTRO
           LEFT JOIN ${FULL_TABLE_NAME} apr ON apr.ID_APROVADOR = p.ID_APROVADOR
           OUTER APPLY (
             SELECT TOP (1) x.ID_USUARIO, x.NM_USUARIO
               FROM ${FULL_MDM_TABLE} x
              WHERE ${PESSOA_DO_APROVADOR("apr")}
              ORDER BY ${ORDEM_PESSOA_DO_APROVADOR("apr")}
           ) aprPessoa
           LEFT JOIN ${FULL_STATUS_TABLE} st ON st.ID_STATUS = p.ID_STATUS AND st.ID_IDIOMA = @idIdioma
          WHERE p.ID_KAIZEN = @idKaizen AND p.ORIGEM = @origem`,
        [["idKaizen", sql.Int, idKaizen], ["idIdioma", sql.Int, idIdioma], ["origem", sql.Char(1), origem]]
      ),
      // Os vínculos saem das tabelas da MESMA origem (ver tabelasDaOrigem).
      runQuery(
        `SELECT me.ID_USUARIO, m.NM_USUARIO, m.CD_MATRICULA, m.ID_TIPO_USUARIO
           FROM ${tab.membros} me
           LEFT JOIN ${FULL_MDM_TABLE} m ON m.ID_USUARIO = me.ID_USUARIO
          WHERE me.ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen]]
      ),
      runQuery(
        `SELECT ID_DESPERDICIO FROM ${tab.desperdicio} WHERE ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen]]
      ),
      runQuery(
        `SELECT rk.ID_RESULTADO, r.NM_RESULTADO, r.DS_RESULTADO, r.ID_TIPO_RESULTADO
           FROM ${tab.resultado} rk
           LEFT JOIN ${FULL_RESULTADOS_TABLE} r ON r.ID_RESULTADO = rk.ID_RESULTADO AND r.ID_IDIOMA = @idIdioma
          WHERE rk.ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen], ["idIdioma", sql.Int, idIdioma]]
      ),
    ]);

    const k = principal.recordset[0];
    // A autorização passou, mas a linha pode ter sumido entre as duas
    // consultas. Sem esta guarda o erro era "Cannot read properties of
    // undefined (reading 'ID_KAIZEN')" — um 500 que a tela mostrava
    // cru, no lugar de um 404 que diz o que houve.
    if (!k) return res.status(404).json({ error: "Kaizen não encontrado." });
    // Fora de fonteBiblioteca() (lista de colunas fixa, comum às duas
    // tabelas): só lê se a coluna existir na tabela desta origem.
    const tabelaOrigem = origem === "H" ? DB_HIST_PVC_TABLE : DB_PVC_TABLE;
    const colsNovas = [];
    for (const c of ["ID_TIPO_KAIZEN", "SG_GM", "URL_GM"]) {
      if (await temColunaNaPvc(tabelaOrigem, c)) colsNovas.push(c);
    }
    let extras = {};
    if (colsNovas.length) {
      const t = await runQuery(`SELECT ${colsNovas.join(", ")} FROM ${tab.pvc} WHERE ID_KAIZEN = @idKaizen`,
        [["idKaizen", sql.Int, idKaizen]]);
      extras = t.recordset[0] || {};
    }
    const idTipoKaizen = extras.ID_TIPO_KAIZEN ?? null;
    res.json({
      ID_KAIZEN: k.ID_KAIZEN,
      // Volta para a tela e vem de volta no PUT. É o que amarra o
      // "carreguei daqui" ao "gravei ali".
      ORIGEM: origem,
      ROTULO: rotuloIdKaizen(k.ID_KAIZEN, k.DT_CRIACAO),
      titulo: k.NM_KAIZEN,
      NM_AUTOR: k.NM_AUTOR,
      NM_LIDER: k.NM_LIDER,
      NM_SITE: k.NM_SITE, NM_ESTADO: k.NM_ESTADO, NM_CIDADE: k.NM_CIDADE,
      id_usuario_lider: k.ID_USUARIO_LIDER,
      id_categoria: k.ID_CATEGORIA,
      id_replicacao: k.ID_REPLICACAO,
      id_tipo_kaizen: idTipoKaizen,
      sg_gm: extras.SG_GM ?? null,
      url_gm: extras.URL_GM ?? null,
      // ID da PESSOA (para o select) + o ID do vínculo (rastreabilidade).
      id_usuario_aprovador: k.ID_USUARIO_APROVADOR,
      ID_APROVADOR: k.ID_APROVADOR,
      NM_APROVADOR: k.NM_APROVADOR,
      // Avisa a tela quando o vínculo existe mas não dá para selecionar:
      // aprovador inativo ou sem pessoa correspondente no MDM. O vínculo
      // NÃO é apagado — só é sinalizado.
      APROVADOR_INDISPONIVEL: k.ID_APROVADOR != null
        && (k.ID_USUARIO_APROVADOR == null || String(k.APROVADOR_ATIVO || "").toUpperCase() !== "S"),
      declaracao_problema: k.DS_PROBLEMA,
      meta_objetivo: k.DS_OBJETIVO,
      descricao_antes: k.DS_ESTADO_ANTES,
      descricao_depois: k.DS_ESTADO_DEPOIS,
      url_imagem_antes: k.URL_IMG_ANTES,
      url_imagem_depois: k.URL_IMG_DEPOIS,
      links_documentos: k.URL_REFERENCIA,
      licoes_aprendidas: k.DS_LICOES_APRENDIDAS,
      // DS_COMPARA_META é o destino novo; DS_RESULTADO_ESPERADO é onde
      // o texto está nos Kaizens gravados até aqui. O SELECT é p.*, então
      // as duas vêm e a escolha é feita aqui: reabrir um Kaizen antigo
      // continua mostrando o que a pessoa escreveu, com ou sem o ALTER
      // TABLE aplicado e com ou sem a cópia dos dados.
      comparacao_meta_inicial: k.DS_COMPARA_META ?? k.DS_RESULTADO_ESPERADO ?? null,
      // DATE puro, do jeito que o <input type="date"> espera.
      data_conclusao: somenteData(k.DT_CONCLUSAO),
      valor_resultado_financeiro: k.VL_RESULTADO_FINANCEIRO,
      id_moeda: k.ID_MOEDA,
      // Os dois blocos da etapa 4, prontos para a tela repor sem ter de
      // adivinhar qual vínculo é de qual: quem separa é o
      // ID_TIPO_RESULTADO do catálogo (1 = financeiro, 2 = outros).
      id_resultado_financeiro: (resultados.recordset.find((x) => x.ID_TIPO_RESULTADO === 1) || {}).ID_RESULTADO ?? null,
      id_resultado_outros: (resultados.recordset.find((x) => x.ID_TIPO_RESULTADO === 2) || {}).ID_RESULTADO ?? null,
      // Mesma leitura tolerante da Comparação: DS_RESULTADO_ALCANCADO é
      // o destino; DS_RESULTADO só aparece em quem chegou a rodar o
      // script anterior, e é lida como reserva para nada sumir da tela.
      descricao_resultado_outros: k.DS_RESULTADO_ALCANCADO ?? k.DS_RESULTADO ?? null,
      ID_STATUS: k.ID_STATUS,
      NM_STATUS: k.NM_STATUS,
      // Carimbo da última gravação: volta no salvamento para o servidor
      // recusar sobrescrever alteração feita por outra pessoa no meio.
      DT_ATUALIZACAO: relogioLocal(k.DT_ATUALIZACAO),
      membros: membros.recordset.map((m) => m.ID_USUARIO),
      MEMBROS: membros.recordset,
      ids_desperdicio: desperdicios.recordset.map((d) => d.ID_DESPERDICIO),
      RESULTADOS: resultados.recordset,
    });
  } catch (err) {
    console.error("[edicao] erro ao carregar:", err.message);
    res.status(500).json({ error: "Erro ao carregar o Kaizen: " + err.message });
  }
});

// Resultado do envio do aviso, informado pela tela depois de entregar a
// mensagem ao Graph. Existe só para o log ficar no servidor, junto com
// o das demais etapas — o envio em si acontece no navegador, com o
// token do aprovador (ver js/envio-email.js). Não grava nada e não
// muda a decisão, que a esta altura já está persistida.
apiRouter.post("/kaizens/:id/aviso", (req, res) => {
  const idKaizen = parseInt(req.params.id, 10);
  const chave = String((req.body && req.body.chave) || "").slice(0, 60);
  const enviado = !!(req.body && req.body.enviado);
  const motivo = String((req.body && req.body.motivo) || "").slice(0, 300);
  if (enviado) {
    console.log(`[email] ${chave || idKaizen}: enviado pela tela (perfil do aprovador).`);
  } else {
    console.error(`[email] ${chave || idKaizen}: NAO enviado — ${motivo || "sem detalhe"}`);
  }
  res.json({ ok: true });
});

/* Medição por requisição: total, tempo de banco e número de consultas.

   Vai para o CABEÇALHO Server-Timing, que o navegador já sabe ler — na
   aba Rede, coluna "Tempo", cada chamada mostra a fatia de banco sem
   ninguém precisar abrir log de servidor. E vai para o log também, para
   quem estiver olhando pelo Databricks.

   COMO LER: `fora` é total menos banco. Se `sql` domina, o gargalo é o
   Azure SQL (consulta pesada) ou a distância até ele (muitas idas, cada
   uma pagando a latência). Se `fora` domina, o gargalo está deste lado
   — aplicação, leitura de imagem no volume, serialização.

   Só em /api: arquivo estático não consulta banco e o cabeçalho só faria
   volume. */
app.use("/api", (req, res, next) => {
  const medida = { sqlMs: 0, sqlQtd: 0 };
  const inicio = process.hrtime.bigint();
  res.on("finish", () => {
    const total = Number(process.hrtime.bigint() - inicio) / 1e6;
    const fora = Math.max(0, total - medida.sqlMs);
    // Lento = acima de meio segundo. Abaixo disso o log só atrapalharia
    // a leitura do que importa.
    if (total >= 500) {
      console.warn(`[lento] ${req.method} ${req.originalUrl} — total ${total.toFixed(0)}ms, ` +
        `banco ${medida.sqlMs.toFixed(0)}ms em ${medida.sqlQtd} consulta(s), fora do banco ${fora.toFixed(0)}ms`);
    }
  });
  // O cabeçalho precisa sair ANTES do corpo; res.on('finish') seria
  // tarde demais. writeHead é o último ponto em que ainda dá.
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    const total = Number(process.hrtime.bigint() - inicio) / 1e6;
    try {
      res.setHeader("Server-Timing",
        `sql;desc="banco (${medida.sqlQtd} consultas)";dur=${medida.sqlMs.toFixed(1)},` +
        `fora;desc="fora do banco";dur=${Math.max(0, total - medida.sqlMs).toFixed(1)},` +
        `total;dur=${total.toFixed(1)}`);
    } catch (e) { /* cabeçalho já enviado: não vale derrubar a resposta */ }
    return writeHead.apply(this, args);
  };
  medicaoRequisicao.run(medida, next);
});

app.use("/api", apiRouter);

// ------------------------------------------------------------------
// Fallback de rota principal
// ------------------------------------------------------------------
kaizenWeb.get("/", (req, res) => {
  // Mesmo critério do index.html servido pelo express.static acima:
  // revalida sempre (deploy aparece na hora), mas aproveita 304.
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use(kaizenWeb);

// Auditoria na subida: cada arquivo local que as telas referenciam
// (href/src relativos) precisa existir em VBM-Kaizen-App/. Deploy
// incompleto (pasta css/, js/ ou uma página faltando) aparece no log,
// em vez de virar tela sem estilo ou "Cannot GET".
function auditarArquivosDasTelas() {
  const fs = require("fs");
  const faltando = new Set();
  const paginas = ["index.html", "admin.html", "aprovacao.html", "biblioteca.html", "kaizen-novo.html"];
  for (const pagina of paginas) {
    const arquivo = path.join(__dirname, pagina);
    if (!fs.existsSync(arquivo)) { faltando.add(pagina); continue; }
    const html = fs.readFileSync(arquivo, "utf8");
    for (const m of html.matchAll(/\b(?:href|src)="([^"#?:]+)(?:[?#][^"]*)?"/g)) {
      const ref = m[1];
      if (ref.startsWith("/") || ref.startsWith("//")) continue; // absolutos/API
      if (!fs.existsSync(path.join(__dirname, ref))) faltando.add(ref + " (em " + pagina + ")");
    }
  }
  if (faltando.size) console.error(`[kaizen] ARQUIVOS FALTANDO em ${__dirname}: ${[...faltando].join(", ")}`);
  else console.log(`[kaizen] auditoria de arquivos das telas: OK`);
}

const PORT = process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000;
// Bind explícito em 0.0.0.0: sem isso, o Node pode escutar só em IPv6
// (::) dependendo do ambiente, e o proxy do Databricks Apps às vezes
// não consegue rotear certas conexões até lá — na prática aparece
// como falhas ALEATÓRIAS em alguns assets (CSS/JS/imagens), com o
// HTML principal carregando normalmente. 0.0.0.0 aceita conexões
// IPv4 de forma explícita e resolve isso.
// Diagnósticos de subida (arquivos, banco, credenciais, conexão). Chamado
// por quem sobe o processo: este arquivo sozinho ou o portal da raiz.
function aoIniciar() {
  auditarArquivosDasTelas();
  console.log(`[kaizen] tabela alvo: ${FULL_TABLE_NAME} @ ${DB_SERVER || "(AZURE_SQL_SERVER não configurado)"} / ${DB_NAME || "(KAIZEN_AZURE_SQL_DATABASE não configurado)"}`);
  // Teste de conexão na subida — evidência de que as credenciais vindas
  // dos Databricks Secrets (valueFrom no app.yaml) funcionam. Só loga
  // presença/resultado, nunca o valor.
  console.log(`[kaizen] credenciais: AZURE_SQL_USER ${DB_USER ? "presente" : "AUSENTE"}, ` +
    `AZURE_SQL_PASSWORD ${DB_PASSWORD ? "presente" : "AUSENTE"}, ` +
    `AZURE_STORAGE_SAS_TOKEN ${process.env.AZURE_STORAGE_SAS_TOKEN ? "presente" : "AUSENTE"}`);
  // Diagnóstico do valueFrom: só NOMES de variáveis (nunca valores). Mostra
  // se o runtime injetou os segredos com outro nome (ex.: a chave do
  // resource) e se chegou o NOME do segredo (catalogo.schema.segredo) no
  // lugar do valor.
  const nomesAmbiente = Object.keys(process.env)
    .filter((n) => /azure|sql|sas|secret|senha|password/i.test(n) && n !== "DATABRICKS_CLIENT_SECRET");
  console.log(`[kaizen] variáveis de ambiente relacionadas (só nomes): ${nomesAmbiente.join(", ") || "(nenhuma)"}`);
  ["AZURE_SQL_USER", "AZURE_SQL_PASSWORD", "AZURE_STORAGE_SAS_TOKEN"].forEach((n) => {
    if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(process.env[n] || "")) {
      console.warn(`[kaizen] ${n} recebeu um NOME de segredo (catalogo.schema.segredo), não o valor.`);
    }
  });
  getPool()
    .then(() => console.log("[kaizen] teste de conexão Azure SQL: OK"))
    .catch((err) => console.error(`[kaizen] teste de conexão Azure SQL: FALHOU (${err.code || "sem código"}) ${err.message}`));
}

// Aplicação montável: o portal da raiz faz require() e monta em
// /VBM-Kaizen-App. Rodando direto (node VBM-Kaizen-App/server.js, testes),
// sobe sozinha na raiz.
module.exports = { app, aoIniciar };
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[kaizen] servidor rodando em 0.0.0.0:${PORT}`);
    aoIniciar();
  });
}
