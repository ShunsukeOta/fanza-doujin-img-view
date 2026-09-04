import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { BookmarkIcon } from "@/components/icons";
import type { FeedItem } from "@/lib/types";
import { openWorkInMain } from "@/src/navigationState";
import { updateReaction } from "@/src/reactions";

type SavedItem = FeedItem & { savedAt?: string };

type SavedResponse = {
  ok: boolean;
  items: SavedItem[];
  total: number;
  generatedAt: string;
  error?: string;
};

function formatPrice(price: string) {
  const digits = price.replace(/[^0-9]/g, "");
  if (!digits) return price;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? `¥${value.toLocaleString("ja-JP")}` : price;
}

export function SavedPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingCid, setPendingCid] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/saved?limit=100", {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => null) as SavedResponse | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || `保存済み作品を取得できませんでした (${response.status})`);
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存済み作品を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeSaved = async (item: SavedItem) => {
    if (pendingCid) return;
    setPendingCid(item.cid);
    try {
      await updateReaction("save", item.cid, false);
      setItems((current) => current.filter((candidate) => candidate.cid !== item.cid));
      setTotal((current) => Math.max(0, current - 1));
    } catch {
      setError("保存解除に失敗しました。もう一度お試しください。");
    } finally {
      setPendingCid("");
    }
  };

  return (
    <div className="subpage-shell">
      <header className="subpage-header">
        <div>
          <p className="subpage-eyebrow">LIBRARY</p>
          <h1>保存済み</h1>
          <p className="subpage-description">あとで読みたい作品をまとめて確認できます。</p>
        </div>
        <button className="subpage-refresh" type="button" onClick={() => void load()} disabled={loading}>再読込</button>
      </header>

      <main className="subpage-content">
        <div className="subpage-summary">
          <span>保存した作品</span>
          <strong>{total.toLocaleString("ja-JP")}<small>件</small></strong>
        </div>

        {loading ? (
          <div className="subpage-state"><div className="spinner" aria-hidden="true" /><strong>保存済み作品を読み込んでいます</strong></div>
        ) : error ? (
          <div className="subpage-state is-error"><strong>読み込みに失敗しました</strong><p>{error}</p><button type="button" onClick={() => void load()}>再試行</button></div>
        ) : items.length === 0 ? (
          <div className="subpage-state">
            <span className="subpage-state-icon"><BookmarkIcon /></span>
            <strong>まだ保存した作品がありません</strong>
            <p>メインページで「保存」を押した作品がここに並びます。</p>
            <button type="button" onClick={() => openWorkInMain("") || window.location.assign("/")}>作品を探す</button>
          </div>
        ) : (
          <div className="favorite-grid">
            {items.map((item) => (
              <article className="favorite-card" key={item.cid}>
                <div className="favorite-thumb">
                  {item.images[0] ? <img src={item.images[0]} alt="" loading="lazy" decoding="async" /> : <div className="favorite-noimage">NO IMAGE</div>}
                  <span className="favorite-type">{item.assetLabel}</span>
                  <button
                    className="favorite-save-toggle"
                    type="button"
                    disabled={pendingCid === item.cid}
                    onClick={() => void removeSaved(item)}
                    aria-label={`${item.title || item.cid}の保存を解除`}
                    title="保存を解除"
                  >
                    <BookmarkIcon />
                  </button>
                </div>
                <div className="favorite-body">
                  <h2>{item.title || item.cid}</h2>
                  <div className="favorite-meta">
                    <span>★ {item.rating.toFixed(1)} <small>({item.reviews}件)</small></span>
                    {item.price ? <span>{formatPrice(item.price)}</span> : null}
                  </div>
                  {item.genres.length > 0 ? <p className="favorite-genres">{item.genres.slice(0, 4).join(" / ")}</p> : null}
                  <div className="favorite-actions favorite-actions--sample">
                    <button className="favorite-sample" type="button" onClick={() => openWorkInMain(item.cid)}>サンプルを見る</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <GlobalNav active="saved" />
    </div>
  );
}
