# Estrutura do projeto — VBM Kaizen

Organização física dos arquivos. A arquitetura funcional não mudou:
continua sendo um app Node/Express servindo HTML estático + uma API REST
que fala direto com o Azure SQL.

```
/
├── *.html                  telas (index, admin, kaizen-novo, biblioteca, aprovacao)
├── server.js               Express: estáticos + API REST + pool do Azure SQL
├── email-kaizen.js         templates dos comunicados (monta; não envia)
├── azure-blob.js           upload/leitura das fotos no Azure Blob
├── databricks-fs.js        leitura das fotos ANTIGAS (Volume do Databricks)
├── app.yaml                config do Databricks App (env vars)
├── package.json
│
├── css/
│   ├── vbm-app.css         Design System (tokens --vbm-*, componentes)
│   ├── poppins.css         a família Poppins EMBUTIDA em base64 (ver nota)
│   └── vendor/             CSS de terceiros (Font Awesome)
│
├── js/
│   ├── vbm-app.js          comportamento compartilhado (modais, abas, toasts)
│   ├── aprovadores.js      aba Aprovadores
│   ├── usuarios.js         aba Usuários (somente leitura)
│   ├── cadastro-bilingue.js  motor dos cadastros PT/EN
│   ├── categorias.js       aba Categorias (autossuficiente, ver nota)
│   ├── replicacao.js       aba Pot. Replicação    ─┐
│   ├── desperdicios.js     aba Red. Desperdícios   │
│   ├── resultados.js       aba Resultados          ├─ usam cadastro-bilingue.js
│   ├── tiporesultados.js   aba Tipo Resultados     │
│   ├── status.js           aba Status Kaizen      ─┘
│   ├── msal-config.js      login Microsoft (clientId/authority do Entra)
│   ├── usuario-graph.js    perfil de quem está logado (Microsoft Graph)
│   └── envio-email.js      entrega dos comunicados pelo navegador (Graph)
│
├── assets/
│   ├── images/             fundos, logos e fotos (svg, webp)
│   ├── icons/              favicon + SVGs por aba (ver nota)
│   └── fonts/              Font Awesome solid + os .woff2 de origem da Poppins
│
├── database/
│   ├── DER_VBM_Kaizen_CI.html   modelo de dados (tabelas, colunas, limites)
│   └── *.sql                    scripts operacionais, rodados À MÃO no SSMS
│
└── docs/
    └── ESTRUTURA.md        este arquivo
```

A pasta `lixo/`, que versões anteriores deste documento listavam, **não
existe mais**. Ver a última nota: o CSS do Font Awesome ainda aponta
para ela.

## Convenções

**Nomes com hash** (`e5e202e3c8995079_all.min.css`, `1f0189e087fcefbf_…woff2`):
o hash faz parte do nome, então conteúdo novo gera nome novo. O
`server.js` detecta esse padrão e serve esses arquivos com
`Cache-Control: immutable` (1 ano) — zero requisição em navegações
seguintes. **Não renomeie esses arquivos**: perderiam o cache agressivo.

**Todo o resto** (HTML, `css/vbm-app.css`, `js/*.js`, fundos) é servido
com `no-cache` + ETag: revalida sempre — deploy aparece na hora — mas
responde `304` sem corpo quando nada mudou.

**API** (`/api/*`): sempre `no-store`. Dado nunca vem de cache.

## Notas

- `js/categorias.js` é **autossuficiente de propósito** — não depende de
  `cadastro-bilingue.js`. Um deploy em que esse arquivo compartilhado não
  chegou ao ambiente derrubou a aba inteira; a duplicação é intencional
  para que Categorias não dependa de um segundo arquivo estático.
- As abas do admin carregam **sob demanda**: só a visível consulta o
  banco no load; as demais na primeira vez que são abertas.
- `database/DER_VBM_Kaizen_CI.html` não é carregado em runtime — é a
  referência de schema (nomes de tabelas/colunas e tamanhos de campo)
  usada ao escrever as queries do `server.js`.
- `database/*.sql` também não são carregados pelo app: são scripts
  rodados **à mão** no SSMS. Aparecerem "sem referência" numa varredura
  automática é o esperado, **não** sinal de obsolescência.
- **`css/poppins.css` embute as 16 faces em base64.** Por isso os
  `.woff2` em `assets/fonts/poppins/` não são baixados pelo navegador —
  eles ficam como ARQUIVO DE ORIGEM, para regerar o CSS. Apagá-los não
  quebra nada hoje, mas inviabiliza a regeneração.
- **Os SVGs repetidos entre `assets/icons/<aba>/` são intencionais.** O
  caminho do ícone fica gravado no BANCO (`URL_ICONE`), por aba. Unificar
  os arquivos iguais quebraria as linhas já cadastradas.
- `server.js` NÃO serve arquivos do servidor ao navegador: `app.yaml`,
  qualquer `.js` da raiz, `node_modules/`, `database/` e `docs/` voltam
  404 (ver `ARQUIVOS_DO_SERVIDOR`). Todo script de tela vive em `js/`.
- O CSS do Font Awesome (`css/vendor/…all.min.css`) tem `@font-face` de
  **brands** e **regular** apontando para `../webfonts/` e `../../lixo/`,
  que não existem. Sem impacto em runtime: nenhuma tela usa `fa-brands`
  nem `fa-regular`, e o navegador só busca a fonte quando um glifo dela
  é pedido. Só a variante **solid** é usada, e essa existe.
