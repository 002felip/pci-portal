/* ════════════════════════════════════════════════════════════════════
   VBM-Performance-Hub — dashboards gravados no banco
   Banco: BDIBPBMSA_PRD  (PERFORMANCEHUB_AZURE_SQL_DATABASE no app.yaml)

   IBP.PHUB_PS_SETUP   um registro por dashboard (gráficos em JSON)
   IBP.PHUB_PS_ACESSO  editores escolhidos pelo dono (e-mails da IBP.USERS)

   Regras:
     - Dono (NM_USUARIO_CRIACAO): altera, ativa/desativa, exclui e define editores.
     - Editor (linha em PHUB_PS_ACESSO): altera e reutiliza.
     - Demais usuários do Performance Hub: só visualizam os dashboards ativos.
     - Desativar = SG_ATIVO 'N' (some para os outros; o dono ainda vê "Inativo").
     - Excluir = DELETE da linha; os editores saem junto (ON DELETE CASCADE).
   DT_REF = mês de referência = DT_REF da carga em IBP.PHUB_PERFORMANCESTUDIO.
   Sem relação com IBP.DASHBOARD.
   ════════════════════════════════════════════════════════════════════ */
IF OBJECT_ID(N'IBP.PHUB_PS_SETUP', N'U') IS NULL
BEGIN
  CREATE TABLE IBP.PHUB_PS_SETUP (
    ID_DASHBOARD        INT IDENTITY(1,1) NOT NULL,
    NM_DASHBOARD        NVARCHAR(100)     NOT NULL,  -- ex.: VBM Performance Hub - September 2026
    DS_DASHBOARD        NVARCHAR(500)     NULL,      -- descrição (opcional)
    CD_VISAO            VARCHAR(40)       NOT NULL,  -- visão da tela: VBM_PRODUCTION_ANALYTICS
    DT_REF              DATE              NOT NULL,  -- mês de referência (dia 1) = fim do YTD
    DS_LAYOUT           NVARCHAR(MAX)     NOT NULL,  -- JSON dos gráficos: filtros, configuração, cores, posição, tamanho
    SG_ATIVO            CHAR(1)           NOT NULL CONSTRAINT DF_PHUB_PS_SETUP_ATIVO DEFAULT 'S',  -- S ativo | N inativo
    NM_USUARIO_CRIACAO  NVARCHAR(200)     NOT NULL,  -- dono: e-mail do login (X-Forwarded-Email)
    DT_CRIACAO          DATETIME2(0)      NOT NULL CONSTRAINT DF_PHUB_PS_SETUP_CRIACAO DEFAULT SYSUTCDATETIME(),
    NM_USUARIO          NVARCHAR(200)     NULL,      -- quem alterou por último
    DT_ATUALIZACAO      DATETIME2(0)      NOT NULL CONSTRAINT DF_PHUB_PS_SETUP_ATUALIZACAO DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_PHUB_PS_SETUP PRIMARY KEY (ID_DASHBOARD),
    CONSTRAINT CK_PHUB_PS_SETUP_NOME   CHECK (LEN(NM_DASHBOARD) > 0),
    CONSTRAINT CK_PHUB_PS_SETUP_DT_REF CHECK (DAY(DT_REF) = 1),
    CONSTRAINT CK_PHUB_PS_SETUP_ATIVO  CHECK (SG_ATIVO IN ('S', 'N')),
    CONSTRAINT CK_PHUB_PS_SETUP_LAYOUT CHECK (ISJSON(DS_LAYOUT) = 1)
  );
  -- Nome único entre os dashboards ATIVOS de um mesmo dono
  CREATE UNIQUE INDEX UQ_PHUB_PS_SETUP_NOME
    ON IBP.PHUB_PS_SETUP (NM_USUARIO_CRIACAO, NM_DASHBOARD) WHERE SG_ATIVO = 'S';
END
GO

IF OBJECT_ID(N'IBP.PHUB_PS_ACESSO', N'U') IS NULL
BEGIN
  CREATE TABLE IBP.PHUB_PS_ACESSO (
    ID_DASHBOARD  INT           NOT NULL,
    NM_USUARIO    NVARCHAR(200) NOT NULL,  -- e-mail do editor (minúsculas; existe em IBP.USERS)
    DT_CRIACAO    DATETIME2(0)  NOT NULL CONSTRAINT DF_PHUB_PS_ACESSO_CRIACAO DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_PHUB_PS_ACESSO PRIMARY KEY (ID_DASHBOARD, NM_USUARIO),
    CONSTRAINT FK_PHUB_PS_ACESSO_DASHBOARD FOREIGN KEY (ID_DASHBOARD)
      REFERENCES IBP.PHUB_PS_SETUP (ID_DASHBOARD) ON DELETE CASCADE  -- excluir o dashboard leva os editores
  );
END
GO

/* Permissões do login do app (o mesmo de db-user/db-password):

GRANT SELECT, INSERT, UPDATE, DELETE ON IBP.PHUB_PS_SETUP  TO [<usuario-do-app>];
GRANT SELECT, INSERT, DELETE         ON IBP.PHUB_PS_ACESSO TO [<usuario-do-app>];
*/

/* Conferência depois de criar:

SELECT ID_DASHBOARD, NM_DASHBOARD, CD_VISAO, DT_REF, SG_ATIVO, NM_USUARIO_CRIACAO, DT_ATUALIZACAO
FROM IBP.PHUB_PS_SETUP ORDER BY NM_DASHBOARD;

SELECT A.ID_DASHBOARD, D.NM_DASHBOARD, A.NM_USUARIO
FROM IBP.PHUB_PS_ACESSO A
INNER JOIN IBP.PHUB_PS_SETUP D ON D.ID_DASHBOARD = A.ID_DASHBOARD;
*/
