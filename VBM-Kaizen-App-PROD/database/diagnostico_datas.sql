/* =====================================================================
   AÇÃO 1 — o lado do BANCO da auditoria de DT_ATUALIZACAO
   ---------------------------------------------------------------------
   O código da aplicação já foi lido; isto cobre o que só o servidor SQL
   pode responder: em que fuso ele roda, se alguma coluna de data tem
   DEFAULT ou trigger próprios, e o que está gravado de verdade.

   TUDO AQUI É SÓ LEITURA. Nenhuma correção.
   ===================================================================== */

SET NOCOUNT ON;

/* =====================================================================
   1.1 — Em que fuso o servidor SQL roda?
   ---------------------------------------------------------------------
   Se o Azure SQL estiver em UTC (o normal), GETDATE() devolve UTC e
   DIFERENCA_HORAS vem 3 (ou 2 no horário de verão). É essa diferença
   que aparece nos registros.
   ===================================================================== */
SELECT  RELOGIO_DO_SERVIDOR   = GETDATE(),
        RELOGIO_UTC           = GETUTCDATE(),
        RELOGIO_BRASILIA      = CAST((SYSDATETIMEOFFSET()
                                  AT TIME ZONE 'E. South America Standard Time') AS DATETIME2),
        OFFSET_DO_SERVIDOR    = SYSDATETIMEOFFSET(),
        DIFERENCA_HORAS       = DATEDIFF(HOUR, GETUTCDATE(), GETDATE()),
        VEREDITO =
            CASE WHEN DATEDIFF(MINUTE, GETUTCDATE(), GETDATE()) BETWEEN -1 AND 1
                 THEN 'Servidor em UTC - GETDATE() grava 3h a frente do Brasil'
                 ELSE 'Servidor NAO esta em UTC - conferir'
            END;

/* Existe o fuso usado pela aplicação neste servidor? (deve retornar 1 linha) */
SELECT  name, current_utc_offset, is_currently_dst
FROM    sys.time_zone_info
WHERE   name = 'E. South America Standard Time';

/* =====================================================================
   1.2 — O banco acrescenta alguma conversão por conta própria?
   ---------------------------------------------------------------------
   DEFAULT em coluna de data e TRIGGER de UPDATE são os dois jeitos de o
   banco gravar uma data que a aplicação não mandou. Se vier vazio, todo
   valor de DT_ATUALIZACAO vem do INSERT/UPDATE da aplicação.
   ===================================================================== */
SELECT  TABELA     = OBJECT_SCHEMA_NAME(c.object_id) + '.' + OBJECT_NAME(c.object_id),
        COLUNA     = c.name,
        TIPO       = ty.name,
        DEFAULT_   = dc.definition
FROM        sys.columns c
INNER JOIN  sys.types   ty ON ty.user_type_id = c.user_type_id
LEFT JOIN   sys.default_constraints dc ON dc.parent_object_id = c.object_id
                                      AND dc.parent_column_id = c.column_id
WHERE       c.name LIKE 'DT[_]%'
  AND       OBJECT_NAME(c.object_id) LIKE 'kzn[_]%'
ORDER BY    CASE WHEN dc.definition IS NULL THEN 1 ELSE 0 END, TABELA, COLUNA;

SELECT  TABELA  = OBJECT_SCHEMA_NAME(t.parent_id) + '.' + OBJECT_NAME(t.parent_id),
        TRIGGER_ = t.name,
        DESABILITADO = t.is_disabled,
        CORPO   = m.definition
FROM        sys.triggers t
LEFT JOIN   sys.sql_modules m ON m.object_id = t.object_id
WHERE       OBJECT_NAME(t.parent_id) LIKE 'kzn[_]%';

/* Procedures/funções que mexem em data (a aplicação não chama nenhuma —
   se aparecer alguma, é escrita por fora do sistema). */
SELECT  OBJETO = OBJECT_SCHEMA_NAME(m.object_id) + '.' + OBJECT_NAME(m.object_id),
        TIPO   = o.type_desc
FROM        sys.sql_modules m
INNER JOIN  sys.objects    o ON o.object_id = m.object_id
WHERE       (m.definition LIKE '%GETDATE%' OR m.definition LIKE '%SYSDATETIME%'
             OR m.definition LIKE '%DT_ATUALIZACAO%')
  AND       o.type IN ('P', 'FN', 'IF', 'TF');

/* =====================================================================
   1.3 — O que está gravado, de fato
   ---------------------------------------------------------------------
   Compara o último DT_ATUALIZACAO de cada tabela com o relógio de
   Brasília. Linhas gravadas pelas abas já corrigidas ficam próximas de
   0; as gravadas por Novo Kaizen/Aprovação ficam ~3h à frente.
   ===================================================================== */
;WITH ultimos AS (
    SELECT TABELA = 'kzn_aprovador',        DT = MAX(DT_ATUALIZACAO) FROM [ci].[kzn_aprovador]
    UNION ALL SELECT 'kzn_mdm_hierarquia',       MAX(DT_ATUALIZACAO) FROM [ci].[kzn_mdm_hierarquia]
    UNION ALL SELECT 'kzn_categoria',            MAX(DT_ATUALIZACAO) FROM [ci].[kzn_categoria]
    UNION ALL SELECT 'kzn_replicacao',           MAX(DT_ATUALIZACAO) FROM [ci].[kzn_replicacao]
    UNION ALL SELECT 'kzn_desperdicio',          MAX(DT_ATUALIZACAO) FROM [ci].[kzn_desperdicio]
    UNION ALL SELECT 'kzn_resultados',           MAX(DT_ATUALIZACAO) FROM [ci].[kzn_resultados]
    UNION ALL SELECT 'kzn_tipo_resultado',       MAX(DT_ATUALIZACAO) FROM [ci].[kzn_tipo_resultado]
    UNION ALL SELECT 'kzn_motivo_reprovacao',    MAX(DT_ATUALIZACAO) FROM [ci].[kzn_motivo_reprovacao]
    UNION ALL SELECT 'kzn_pedravisaoconsolidada',MAX(DT_ATUALIZACAO) FROM [ci].[kzn_pedravisaoconsolidada]
)
SELECT  u.TABELA,
        ULTIMA_GRAVACAO = u.DT,
        AGORA_BRASILIA  = CAST((SYSDATETIMEOFFSET()
                            AT TIME ZONE 'E. South America Standard Time') AS DATETIME2),
        HORAS_A_FRENTE  = DATEDIFF(HOUR,
                            CAST((SYSDATETIMEOFFSET()
                              AT TIME ZONE 'E. South America Standard Time') AS DATETIME2), u.DT)
FROM    ultimos u
ORDER BY HORAS_A_FRENTE DESC, u.TABELA;

/* Distribuição por hora do dia em kzn_pedravisaoconsolidada: se as
   gravações se concentram fora do horário comercial brasileiro, é o
   deslocamento de 3h aparecendo. */
SELECT  HORA_GRAVADA = DATEPART(HOUR, DT_ATUALIZACAO),
        QTD          = COUNT(*)
FROM    [ci].[kzn_pedravisaoconsolidada]
WHERE   DT_ATUALIZACAO IS NOT NULL
GROUP BY DATEPART(HOUR, DT_ATUALIZACAO)
ORDER BY HORA_GRAVADA;

/* DT_ATUALIZACAO nulo — nenhum caminho da aplicação deixa nulo hoje;
   linha nula veio de carga/edição manual. */
SELECT TABELA = 'kzn_pedravisaoconsolidada', NULOS = COUNT(*) FROM [ci].[kzn_pedravisaoconsolidada] WHERE DT_ATUALIZACAO IS NULL
UNION ALL SELECT 'kzn_aprovador',      COUNT(*) FROM [ci].[kzn_aprovador]      WHERE DT_ATUALIZACAO IS NULL
UNION ALL SELECT 'kzn_mdm_hierarquia', COUNT(*) FROM [ci].[kzn_mdm_hierarquia] WHERE DT_ATUALIZACAO IS NULL
UNION ALL SELECT 'kzn_categoria',      COUNT(*) FROM [ci].[kzn_categoria]      WHERE DT_ATUALIZACAO IS NULL;
