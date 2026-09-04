import type { ReactionSummary } from "@/lib/types";

type ReactionMutationResponse = {
  ok: boolean;
  reaction: ReactionSummary | null;
};

type ReactionListResponse = {
  ok: boolean;
  reactions: Record<string, ReactionSummary>;
};

function apiError(data: unknown, fallback: string): Error {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return new Error(data.error);
  }
  return new Error(fallback);
}

export async function updateReaction(type: "like" | "save", cid: string, active: boolean): Promise<ReactionSummary> {
  const response = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      eventType: type === "like" ? "like_toggle" : "save_toggle",
      cid,
      metadata: { active },
    }),
    credentials: "same-origin",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw apiError(data, `リアクションの保存に失敗しました (${response.status})`);
  const payload = data as ReactionMutationResponse;
  if (!payload.reaction) throw new Error("リアクション件数を取得できませんでした。");
  return payload.reaction;
}

export async function loadReactions(cids: string[]): Promise<Record<string, ReactionSummary>> {
  const unique = [...new Set(cids.map((cid) => cid.trim()).filter(Boolean))].slice(0, 50);
  if (unique.length === 0) return {};
  const query = new URLSearchParams({ cids: unique.join(",") });
  const response = await fetch(`/api/reactions?${query.toString()}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    credentials: "same-origin",
    cache: "no-store",
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw apiError(data, `リアクション件数の取得に失敗しました (${response.status})`);
  return (data as ReactionListResponse).reactions ?? {};
}
