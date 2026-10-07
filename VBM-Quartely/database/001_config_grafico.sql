/* ════════════════════════════════════════════════════════════════════
   VBM-Quartely — configuração dos gráficos (painel de edição)
   Banco: BDIBPBMSA_PRD  (QUARTELY_AZURE_SQL_DATABASE no app.yaml)

   Não havia tabela de configuração para o Quartely; esta é a única
   estrutura nova. Guarda SÓ apresentação (título, casas decimais,
   unidade/escala e cores) em JSON — nenhum dado de negócio é alterado.

   Usada por GET/PUT /VBM-Quartely/api/config-graficos (quartely-api.js).
   Outro nome/esquema: declarar QUARTELY_CONFIG_TABLE='ESQUEMA.TABELA'
   no app.yaml.
   ════════════════════════════════════════════════════════════════════ */
IF OBJECT_ID(N'IBP.QUARTELY_CONFIG_GRAFICO', N'U') IS NULL
BEGIN
  CREATE TABLE IBP.QUARTELY_CONFIG_GRAFICO (
    ID_CONFIG            INT IDENTITY(1,1) NOT NULL,
    NM_GRAFICO           NVARCHAR(100)     NOT NULL,   -- "Nome do gráfico" (limite repetido em quartely-api.js: NOME_MAX)
    DS_CONFIG            NVARCHAR(MAX)     NOT NULL,   -- JSON normalizado pelo servidor
    DT_CRIACAO           DATETIME2(0)      NOT NULL CONSTRAINT DF_QUARTELY_CONFIG_GRAFICO_CRIACAO DEFAULT SYSUTCDATETIME(),
    DT_ATUALIZACAO       DATETIME2(0)      NOT NULL CONSTRAINT DF_QUARTELY_CONFIG_GRAFICO_ATUALIZACAO DEFAULT SYSUTCDATETIME(),
    CD_EMAIL_ATUALIZACAO NVARCHAR(200)     NULL,       -- X-Forwarded-Email de quem salvou (só servidor)
    CONSTRAINT PK_QUARTELY_CONFIG_GRAFICO PRIMARY KEY (ID_CONFIG),
    CONSTRAINT UQ_QUARTELY_CONFIG_GRAFICO_NOME UNIQUE (NM_GRAFICO),
    CONSTRAINT CK_QUARTELY_CONFIG_GRAFICO_NOME CHECK (LEN(NM_GRAFICO) > 0),
    CONSTRAINT CK_QUARTELY_CONFIG_GRAFICO_JSON CHECK (ISJSON(DS_CONFIG) = 1)
  );
END
GO

/* Permissão mínima para o login do app (o mesmo de db-user/db-password).
   Sem DELETE: o painel não exclui configurações.

GRANT SELECT, INSERT, UPDATE ON IBP.QUARTELY_CONFIG_GRAFICO TO [<usuario-do-app>];
*/
