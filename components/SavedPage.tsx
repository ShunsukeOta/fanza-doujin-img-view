import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { BookmarkIcon } from "@/components/icons";
import type { FeedItem } from "@/lib/types";
import { fetchJson } from "@/src/api";
import { openWorkInMain } from "@/src/navigationState";
import { formatPrice } from "@/src/price";
import { updateReaction } from "@/src/reactions";

type SavedItem = FeedItem & { savedAt?: string };
type SavedResponse = { ok: boolean; items: SavedItem[]; total: number; nextCursor: string | null; hasMore: boolean; generatedAt: string };

export function SavedPage() {
  const [items, setItems] = useState<SavedItem[]>([]); const [total, setTotal] = useState(0); const [cursor, setCursor] = useState<string | null>(null); const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [error, setError] = useState(""); const [pendingCid, setPendingCid] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await fetchJson<SavedResponse>("/api/saved?limit=24", { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, credentials: "same-origin", cache: "no-store" }, "保存済み作品を取得できませんでした"); setItems(data.items ?? []); setTotal(data.total ?? 0); setCursor(data.nextCursor); setHasMore(data.hasMore); }
    catch (e) { setError(e instanceof Error ? e.message : "保存済み作品を取得できませんでした。"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    if (!hasMore || !cursor || loadingMore) return; setLoadingMore(true);
    try { const query = new URLSearchParams({ limit: "24", cursor }); const data = await fetchJson<SavedResponse>(`/api/saved?${query}`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" }, "保存済み作品を追加取得できませんでした"); setItems((old) => [...old, ...data.items.filter((item) => !old.some((current) => current.cid === item.cid))]); setCursor(data.nextCursor); setHasMore(data.hasMore); }
    catch (e) { setError(e instanceof Error ? e.message : "追加取得に失敗しました。"); }
    finally { setLoadingMore(false); }
  };

  const removeSaved = async (item: SavedItem) => {
    if (pendingCid) return; setPendingCid(item.cid);
    try { await updateReaction("save", item.cid, false); setItems((old) => old.filter((candidate) => candidate.cid !== item.cid)); setTotal((old) => Math.max(0, old - 1)); }
    catch { setError("保存解除に失敗しました。もう一度お試しください。"); }
    finally { setPendingCid(""); }
  };

  return <div className="subpage-shell">
    <header className="subpage-header"><div><h1>保存済み</h1></div><button className="subpage-refresh" type="button" onClick={() => void load()} disabled={loading}>再読込</button></header>
    <main className="subpage-content">
      <div className="subpage-summary" aria-label={`保存した作品 ${total}件`}><span>保存した作品 <strong>{total.toLocaleString("ja-JP")}</strong>件</span></div>
      {loading ? <div className="subpage-state"><div className="spinner" aria-hidden="true" /><strong>保存済み作品を読み込んでいます</strong></div>
      : items.length === 0 && error ? <div className="subpage-state is-error"><strong>読み込みに失敗しました</strong><p>{error}</p><button type="button" onClick={() => void load()}>再試行</button></div>
      : items.length === 0 ? <div className="subpage-state"><span className="subpage-state-icon"><BookmarkIcon /></span><strong>まだ保存した作品がありません</strong><p>メインページで「保存」を押した作品がここに並びます。</p><button type="button" onClick={() => window.location.assign("/")}>作品を探す</button></div>
      : <>
        <div className="favorite-grid">{items.map((item) => <article className={`favorite-card${item.available === false ? " is-unavailable" : ""}`} key={item.cid}>
          <div className="favorite-thumb">{item.images[0] ? <img src={item.images[0]} alt="" loading="lazy" decoding="async" /> : <div className="favorite-noimage">NO IMAGE</div>}<span className="favorite-type">{item.available === false ? "販売終了" : item.assetLabel}</span><button className="favorite-save-toggle" type="button" disabled={pendingCid === item.cid} onClick={() => void removeSaved(item)} aria-label={`${item.title || item.cid}の保存を解除`} title="保存を解除"><BookmarkIcon /></button></div>
          <div className="favorite-body"><h2>{item.title || item.cid}</h2><div className="favorite-meta"><span>★ {item.rating.toFixed(1)} <small>({item.reviews}件)</small></span>{item.price ? <span>{formatPrice(item.price, item.priceValue ?? null)}</span> : null}</div>{item.genres.length ? <p className="favorite-genres">{item.genres.slice(0, 4).join(" / ")}</p> : null}<div className="favorite-actions favorite-actions--sample"><button className="favorite-sample" type="button" onClick={() => openWorkInMain(item.cid)}>サンプルを見る</button></div></div>
        </article>)}</div>
        {error ? <div className="saved-inline-error" role="status">{error}</div> : null}
        {hasMore ? <div className="saved-load-more"><button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "読み込み中…" : "さらに表示"}</button></div> : null}
      </>}
    </main><GlobalNav active="saved" />
  </div>;
}
