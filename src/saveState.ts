import type { SaveState } from "@/lib/types";
import { createEventId } from "@/src/analytics";
import { fetchJson } from "@/src/api";

type SaveMutationResponse = { ok: boolean; saveState: SaveState | null };
type SaveListResponse = { ok: boolean; saveStates: Record<string, SaveState> };
export type SaveContext = { viewId?: string; feedId?: string | null; rank?: number };

const MAX_SAVE_STATE_CIDS = 50;

export async function updateSaveState(
  cid: string,
  active: boolean,
  context: SaveContext = {},
): Promise<SaveState> {
  const data = await fetchJson<SaveMutationResponse>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      eventType: "save_toggle",
      eventId: createEventId(),
      eventVersion: 3,
      cid,
      viewId: context.viewId,
      feedId: context.feedId,
      rank: context.rank,
      metadata: { active },
    }),
    credentials: "same-origin",
  }, "保存状態の更新に失敗しました");

  if (!data.saveState) throw new Error("保存状態を取得できませんでした。");
  return {
    cid: data.saveState.cid,
    viewerSaved: Boolean(data.saveState.viewerSaved),
  };
}

export async function loadSaveStates(cids: string[]): Promise<Record<string, SaveState>> {
  const unique = [...new Set(cids.map((cid) => cid.trim()).filter(Boolean))].slice(0, MAX_SAVE_STATE_CIDS);
  if (unique.length === 0) return {};

  const query = new URLSearchParams({ cids: unique.join(",") });
  const data = await fetchJson<SaveListResponse>(`/api/save-state?${query.toString()}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    credentials: "same-origin",
    cache: "no-store",
  }, "保存状態の取得に失敗しました");

  return Object.fromEntries(Object.entries(data.saveStates ?? {}).map(([cid, state]) => [
    cid,
    { cid, viewerSaved: Boolean(state.viewerSaved) },
  ]));
}
