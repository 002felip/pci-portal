/**
 * Persistence for the per-stage required fields that Data quality's
 * `scope=required` scores against, stored server-side under the shared
 * `app_setting` key `completeness.required` -- see backend/app/api.py's
 * /settings routes. Shared for everyone, like the funnel config. Defaults
 * live in backend/app/registry.py (COMPLETENESS_STAGE_EXCLUSIONS).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, keys, useCompletenessRules } from "./api";

export const COMPLETENESS_SETTING_KEY = "completeness.required";

export type RequiredByStage = Record<string, string[]>;

export function useRequiredFieldsConfig() {
  const rules = useCompletenessRules();
  const qc = useQueryClient();
  // Scoring happens server-side, so every completeness query is stale too.
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: keys.completenessRules }),
    qc.invalidateQueries({ queryKey: ["completeness"] }),
    qc.invalidateQueries({ queryKey: keys.setting(COMPLETENESS_SETTING_KEY) }),
  ]);
  const put = useMutation({
    mutationFn: (byStage: RequiredByStage) =>
      api.put(`/settings/${COMPLETENESS_SETTING_KEY}`, { payload: { by_stage: byStage } }),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: () => api.del(`/settings/${COMPLETENESS_SETTING_KEY}`),
    onSuccess: refresh,
  });

  return {
    rules,
    saving: put.isPending || del.isPending,
    error: put.error ?? del.error,
    save: (byStage: RequiredByStage) => put.mutateAsync(byStage),
    reset: () => del.mutateAsync(),
  };
}
