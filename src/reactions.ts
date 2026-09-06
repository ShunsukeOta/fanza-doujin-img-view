import type { ReactionSummary } from "@/lib/types";
import { fetchJson } from "@/src/api";
import { createEventId } from "@/src/analytics";

type ReactionMutationResponse = { ok: boolean; reaction: ReactionSummary | null };
type ReactionListResponse = { ok: boolean; reactions: Record<string, ReactionSummary> };
export type ReactionContext = { viewId?: string; feedId?: string | null; rank?: number };

export async function updateReaction(type: "like" | "save", cid: string, active: boolean, context: ReactionContext = {}): Promise<ReactionSummary> {
  const data = await fetchJson<ReactionMutationResponse>("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      eventType: type === "like" ? "like_toggle" : "save_toggle",
      eventId: createEventId(),
      eventVersion: 3,
      cid,
      viewId: context.viewId,
      feedId: context.feedId,
      rank: context.rank,
      metadata: { active },
    }),
    credentials: "same-origin",
  }, "リアクションの保存に失敗しました");
  if (!data.reaction) throw new Error("リアクション件数を取得できませんでした。");
  return data.reaction;
}

export async function loadReactions(cids: string[]): Promise<Record<string, ReactionSummary>> {
  const unique = [...new Set(cids.map((cid) => cid.trim()).filter(Boolean))].slice(0, 100);
  if (unique.length === 0) return {};
  const query = new URLSearchParams({ cids: unique.join(",") });
  const data = await fetchJson<ReactionListResponse>(`/api/reactions?${query.toString()}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    credentials: "same-origin",
    cache: "no-store",
  }, "リアクション件数の取得に失敗しました");
  return data.reactions ?? {};
}
