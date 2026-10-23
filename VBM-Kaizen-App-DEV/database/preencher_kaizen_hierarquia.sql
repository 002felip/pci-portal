/* =====================================================================
   VBM Kaizen — preenche ci.kzn_kaizen_hierarquia para os Kaizens que
   JÁ EXISTEM.
   =====================================================================

   Quando usar
   -----------
   Uma vez, depois de subir o server.js que passou a alimentar essa
   tabela. O app grava a hierarquia a cada cadastro e a cada edição, mas
   só a partir do momento em que entrou no ar — os Kaizens cadastrados
   antes disso ficaram sem linha. Este script cobre esses.

   Pode rodar quantas vezes quiser: é o mesmo MERGE do app, então
   registro que já existe é ATUALIZADO, não duplicado.

   O que grava
   -----------
     ID_KAIZEN         o Kaizen
     ID_USUARIO_LIDER  ci.kzn_pedravisaoconsolidada.ID_USUARIO_LIDER
     NM_HIERARQUIA_N1..N8   de ci.kzn_mdm_hierarquia, pelo ID_USUARIO
                            do líder
     DT_ATUALIZACAO    agora, no horário de Brasília

   LEFT JOIN no MDM, de propósito: líder sem linha lá entra com os oito
   níveis NULL em vez de ficar de fora. A linha é o que o relatório
   precisa; os níveis são NULL-áveis justamente por isso.

   Como conferir depois
   --------------------
     SELECT COUNT(*) FROM ci.kzn_pedravisaoconsolidada;   -- total
     SELECT COUNT(*) FROM ci.kzn_kaizen_hierarquia;       -- tem de bater

   Se os números não baterem, os que faltam aparecem em:
     SELECT p.ID_KAIZEN, p.ID_USUARIO_LIDER
       FROM ci.kzn_pedravisaoconsolidada p
       LEFT JOIN ci.kzn_kaizen_hierarquia h ON h.ID_KAIZEN = p.ID_KAIZEN
      WHERE h.ID_KAIZEN IS NULL;
   ===================================================================== */

SET NOCOUNT ON;

MERGE INTO ci.kzn_kaizen_hierarquia AS alvo
USING (SELECT p.ID_KAIZEN,
              p.ID_USUARIO_LIDER,
              m.NM_HIERARQUIA_N1, m.NM_HIERARQUIA_N2, m.NM_HIERARQUIA_N3,
              m.NM_HIERARQUIA_N4, m.NM_HIERARQUIA_N5, m.NM_HIERARQUIA_N6,
              m.NM_HIERARQUIA_N7, m.NM_HIERARQUIA_N8
         FROM ci.kzn_pedravisaoconsolidada p
         OUTER APPLY (
           SELECT TOP (1) x.NM_HIERARQUIA_N1, x.NM_HIERARQUIA_N2, x.NM_HIERARQUIA_N3, x.NM_HIERARQUIA_N4, x.NM_HIERARQUIA_N5, x.NM_HIERARQUIA_N6, x.NM_HIERARQUIA_N7, x.NM_HIERARQUIA_N8
             FROM ci.kzn_mdm_hierarquia x
            WHERE x.ID_USUARIO = p.ID_USUARIO_LIDER
            ORDER BY x.ID_TIPO_USUARIO
         ) m) AS origem
   ON alvo.ID_KAIZEN = origem.ID_KAIZEN
WHEN MATCHED THEN UPDATE SET
       alvo.ID_USUARIO_LIDER = origem.ID_USUARIO_LIDER,
       alvo.NM_HIERARQUIA_N1 = origem.NM_HIERARQUIA_N1,
       alvo.NM_HIERARQUIA_N2 = origem.NM_HIERARQUIA_N2,
       alvo.NM_HIERARQUIA_N3 = origem.NM_HIERARQUIA_N3,
       alvo.NM_HIERARQUIA_N4 = origem.NM_HIERARQUIA_N4,
       alvo.NM_HIERARQUIA_N5 = origem.NM_HIERARQUIA_N5,
       alvo.NM_HIERARQUIA_N6 = origem.NM_HIERARQUIA_N6,
       alvo.NM_HIERARQUIA_N7 = origem.NM_HIERARQUIA_N7,
       alvo.NM_HIERARQUIA_N8 = origem.NM_HIERARQUIA_N8,
       alvo.DT_ATUALIZACAO   = CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2)
WHEN NOT MATCHED THEN
  INSERT (ID_KAIZEN, ID_USUARIO_LIDER,
          NM_HIERARQUIA_N1, NM_HIERARQUIA_N2, NM_HIERARQUIA_N3, NM_HIERARQUIA_N4,
          NM_HIERARQUIA_N5, NM_HIERARQUIA_N6, NM_HIERARQUIA_N7, NM_HIERARQUIA_N8,
          DT_ATUALIZACAO)
  VALUES (origem.ID_KAIZEN, origem.ID_USUARIO_LIDER,
          origem.NM_HIERARQUIA_N1, origem.NM_HIERARQUIA_N2, origem.NM_HIERARQUIA_N3, origem.NM_HIERARQUIA_N4,
          origem.NM_HIERARQUIA_N5, origem.NM_HIERARQUIA_N6, origem.NM_HIERARQUIA_N7, origem.NM_HIERARQUIA_N8,
          CAST((SYSDATETIMEOFFSET() AT TIME ZONE 'E. South America Standard Time') AS DATETIME2));

PRINT CONCAT('Linhas gravadas/atualizadas: ', @@ROWCOUNT);

/* Conferência, já no fim da execução. */
SELECT  (SELECT COUNT(*) FROM ci.kzn_pedravisaoconsolidada) AS KAIZENS,
        (SELECT COUNT(*) FROM ci.kzn_kaizen_hierarquia)     AS COM_HIERARQUIA,
        (SELECT COUNT(*) FROM ci.kzn_kaizen_hierarquia
          WHERE NM_HIERARQUIA_N1 IS NULL)                   AS SEM_NIVEIS_NO_MDM;
