/**
 * Persistence for the funnel stage config (order / track / labels), stored
 * server-side under the shared `app_setting` key `funnel.stages` -- see
 * backend/app/api.py's /settings routes. Shared for everyone: there is one
 * saved arrangement, not one per user or browser.
 */
import { useMemo } from "react";

import { useSetting, usePutSetting, useDeleteSetting } from "./api";
import { type FunnelConfig, type Stage, reconcileFunnelConfig } from "./charts";

export const FUNNEL_SETTING_KEY = "funnel.stages";

export function useFunnelConfig(stages: Stage[]) {
  const setting = useSetting<Partial<FunnelConfig>>(FUNNEL_SETTING_KEY);
  const put = usePutSetting(FUNNEL_SETTING_KEY);
  const del = useDeleteSetting(FUNNEL_SETTING_KEY);

  const config = useMemo(
    () => reconcileFunnelConfig(setting.data?.payload, stages),
    [setting.data, stages]);

  return {
    config,
    loaded: !setting.isLoading,
    saving: put.isPending || del.isPending,
    save: (c: FunnelConfig) => put.mutate(c as unknown as Record<string, unknown>),
    reset: () => del.mutate(),
  };
}
