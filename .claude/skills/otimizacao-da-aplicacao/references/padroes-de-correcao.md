# Padrões de correção validados

Cada padrão mantém o funcionamento: mesmo resultado para o usuário, mesmos padrões de configuração. Aplicados e testados no COO Business Units Dashboard (Node/Express 5, `mssql`, página em JS puro).

## 1. Cliente de API: sem fallback para outra aplicação, sem retry em erro do servidor, com timeout

Problema: lista de caminhos com `.catch(tentar)` em qualquer erro → queda do banco vira N consultas e chamada à API de outro app.

```js
var API_BASES = ['api/', '/<Hub>/<App>/api/']; // só caminhos DESTA aplicação
var API_TIMEOUT_MS = 75000;                     // acima do requestTimeout do banco
function apiGet(recurso) {
  var bases = apiBase ? [apiBase] : API_BASES, i = 0;
  function tentar() {
    if (i >= bases.length) return Promise.reject(new Error('API unavailable'));
    var b = bases[i++], ctrl = window.AbortController ? new AbortController() : null;
    var limite = ctrl ? setTimeout(function () { ctrl.abort(); }, API_TIMEOUT_MS) : null;
    return fetch(new URL(recurso, new URL(b, location.href)), { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        clearTimeout(limite);
        if (r.status === 404 && !apiBase) return tentar();          // caminho errado: próximo
        if (!r.ok) throw new Error(recurso + ' → ' + r.status);      // 5xx/403/429: resposta final
        return r.json().then(function (j) { apiBase = b; return j; });
      }, function (err) {
        clearTimeout(limite);
        if (err && err.name === 'AbortError') throw new Error(recurso + ' → timeout');
        return tentar();                                              // rede: próximo
      });
  }
  return tentar();
}
```
Teste: banco simulado fora → 1 chamada por recurso e nenhuma fora dos caminhos do app.

## 2. Cache no servidor: deduplicação, refresh do usuário e dado anterior em falha

```js
const cache = new Map(), emAndamento = new Map();
function comCache(chave, buscar, fresco) {
  const item = cache.get(chave);
  const valido = item && item.expiraEm > Date.now() && !(fresco && Date.now() - item.lidoEm > FRESCO_MS);
  if (valido) return Promise.resolve(item.dados);
  if (emAndamento.has(chave)) return emAndamento.get(chave);      // pedidos simultâneos: 1 ida ao banco
  const inicio = Date.now();
  const p = Promise.resolve().then(buscar).then(dados => {
    cache.set(chave, { dados, lidoEm: Date.now(), expiraEm: Date.now() + CACHE_TTL_MS, desatualizado: false });
    console.log(`leitura ${chave}: ${dados.length} linhas em ${Date.now() - inicio} ms`);
    return dados;
  }, err => {
    if (item && Date.now() - item.lidoEm < DESATUALIZADO_MAX_MS) {  // banco fora: último resultado
      item.desatualizado = true;
      item.expiraEm = Date.now() + 60 * 1000;                       // tenta de novo em 1 min
      return item.dados;
    }
    throw err;
  }).finally(() => emAndamento.delete(chave));
  emAndamento.set(chave, p);
  return p;
}
```
- A resposta leva `geradoEm` = hora real da leitura (`lidoEm`) e `desatualizado`; a tela mostra um selo ("banco indisponível: últimos dados lidos").
- O primeiro pedido da carga da página manda `?fresco=1`: alteração no banco aparece no refresh, com no máximo 1 releitura a cada `FRESCO_MS`.
- Tempos por variável de ambiente com o padrão antigo: `segundos(process.env.X_TTL_S, 300)`.

## 3. Índice do resultado por chave de consulta (uma vez por leitura)

```js
const indices = new WeakMap(); // some quando o array do cache é trocado
function linhasDe(linhas, { site, ano, mes }) {
  let idx = indices.get(linhas);
  if (!idx) { idx = new Map(); for (const l of linhas) { const k = `${l.ID_SITE}|${ano(l)}|${mes(l)}`; (idx.get(k) || idx.set(k, []).get(k)).push(l); } indices.set(linhas, idx); }
  return idx.get(`${site}|${ano}|${mes}`) || [];
}
```

## 4. Junção por `CONCAT` sem colisão, preservando o resultado

`CONCAT(a, b, c) = CONCAT(x, y, z)` colide (`1,1,15` × `11,1,5`). Trocar por `CONCAT(a, '|', b, '|', c)`: mesmo tratamento de `NULL` (vira texto vazio), sem colisão. Aplicar só em linhas ativas (não em comentários) e conferir com teste que todas as junções têm separador. A troca para coluna a coluna (`a = x AND b = y …`) é mais rápida, mas muda o resultado quando há `NULL` → recomendar ao dono da SQL com a consulta de colisão:

```sql
SELECT CONCAT(ID_SITE, ID_OPERACAO, ID_KPI) AS CHAVE, COUNT(DISTINCT CONCAT(ID_SITE,'-',ID_OPERACAO,'-',ID_KPI)) AS COMBINACOES
FROM <tabela_cadastro> GROUP BY CONCAT(ID_SITE, ID_OPERACAO, ID_KPI)
HAVING COUNT(DISTINCT CONCAT(ID_SITE,'-',ID_OPERACAO,'-',ID_KPI)) > 1;
```

## 5. Aviso de duplicidade somada em silêncio

Ao agregar, guardar a chave única da série (`op|kpi|série`) e contar repetições; logar uma linha por pedido com o site/período. Não muda o valor; dá evidência para corrigir o cadastro.

## 6. Rotas de diagnóstico fechadas por padrão

Rotas que devolvem o resultado inteiro e a interface não usa: registrar só com `APP_DIAGNOSTICO=1`. A interface continua igual; extração em massa deixa de ser possível.

## 7. Health mínimo e avisos de ambiente

- Health responde só `{ status }`; servidor/base ficam no log.
- Ao cair no padrão de produção por falta de variável, `console.warn` explícito (não falhar — evita derrubar produção).
- Identidade simulada (header de proxy) só com `NODE_ENV=development` e fora da plataforma; com a variável presente fora disso, avisar e ignorar.

## 8. Limite de pedidos por usuário

```js
const contagem = new Map(); let janela = Date.now();
router.use((req, res, next) => {
  if (Date.now() - janela > 60000) { contagem.clear(); janela = Date.now(); }
  const quem = String(req.get('X-Forwarded-Email') || req.ip || '').toLowerCase();
  const n = (contagem.get(quem) || 0) + 1; contagem.set(quem, n);
  if (n > LIMITE_POR_MINUTO) return res.status(429).json({ error: 'Too many requests.' });
  next();
});
```
Escolher o limite bem acima da navegação normal (contar pedidos por ação na interface).

## 9. Testes com banco simulado (`node --test`, sem dependência nova)

```js
const app = express(); app.use('/api', criarRouter({ runQuery: async () => ({ recordset: DADOS }) }));
const s = await new Promise(ok => { const x = app.listen(0, () => ok(x)); });
const r = await fetch(`http://127.0.0.1:${s.address().port}/api/indicadores?site=6&ano=2026&mes=8`);
```
Cobrir: troca de parâmetros na SQL (quantidade exata), agregação, filtros, parâmetros inválidos → 400 (incluindo parâmetro repetido), rotas fechadas → 404, simultâneos → 1 leitura, banco fora com/sem leitura anterior, refresh, 429, erro sem texto do banco. Variáveis de tempo curtas no topo do teste (`process.env.X_TTL_S = '1'`) ANTES do `require`. `"test": "node --test tests/*.test.js"`.

## 10. Estado da tela no endereço

Filtros e opções dos seletores em `?a=…&sel=id.opcao,…` com `history.replaceState`; ler uma vez na carga e validar contra os dados recebidos (valor inválido → padrão). Links antigos para telas removidas → redirecionar para a tela que substituiu.
