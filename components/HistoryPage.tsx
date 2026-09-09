import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import type { FeedItem } from "@/lib/types";
import { fetchJson } from "@/src/api";
import { navigateToSubpage, openWorkInMain } from "@/src/navigationState";
import { formatPrice } from "@/src/price";
import { mergeUniqueByCid } from "@/src/workUtils";

type HistoryItem = FeedItem & { viewedAt?: string };

type HistoryResponse = {
  ok: boolean;
  items: HistoryItem[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

function formatViewedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<HistoryResponse>(
        "/api/history?limit=24",
        { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" },
        "閲覧履歴を取得できませんでした",
      );
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "閲覧履歴を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!cursor || !hasMore || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "24", cursor });
      const data = await fetchJson<HistoryResponse>(
        `/api/history?${query}`,
        { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" },
        "閲覧履歴を追加取得できませんでした",
      );
      setItems((current) => mergeUniqueByCid(current, data.items ?? []));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "追加取得に失敗しました。");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="subpage-shell">
      <header className="subpage-header">
        <div>
          <a
            className="subpage-back-link"
            href="/mypage"
            onClick={(event) => {
              event.preventDefault();
              navigateToSubpage("/mypage", "history");
            }}
          >
            ← マイページ
          </a>
          <h1>閲覧履歴</h1>
        </div>
        <button className="subpage-refresh" type="button" onClick={() => void load()} disabled={loading}>再読込</button>
      </header>

      <main className="subpage-content">
        <div className="subpage-summary"><span>見た作品 <strong>{total.toLocaleString("ja-JP")}</strong>件</span></div>

        {loading ? (
          <div className="subpage-state">
            <div className="spinner" aria-hidden="true" />
            <strong>閲覧履歴を読み込んでいます</strong>
          </div>
        ) : items.length === 0 && error ? (
          <div className="subpage-state is-error">
            <strong>読み込みに失敗しました</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>再試行</button>
          </div>
        ) : items.length === 0 ? (
          <div className="subpage-state">
            <strong>まだ閲覧履歴がありません</strong>
            <p>閲覧した作品がここに表示されます。</p>
            <button type="button" onClick={() => window.location.assign("/")}>コミックを探す</button>
          </div>
        ) : (
          <>
            <div className="history-list">
              {items.map((item) => (
                <article className="history-card" key={item.cid}>
                  <button className="history-thumb" type="button" onClick={() => openWorkInMain(item.cid)} aria-label={`${item.title || item.cid}を開く`}>
                    {item.images[0] ? <img src={item.images[0]} alt="" loading="lazy" decoding="async" /> : <span>画像なし</span>}
                  </button>
                  <div className="history-body">
                    <span className="history-viewed-at">{formatViewedAt(item.viewedAt)}</span>
                    <h2>{item.title || item.cid}</h2>
                    <p>{item.maker || item.genres.slice(0, 2).join(" / ") || "FANZA同人コミック"}</p>
                    <div className="history-meta">
                      <span>★ {item.rating.toFixed(1)}</span>
                      {item.price ? <span>{formatPrice(item.price, item.priceValue ?? null)}</span> : null}
                    </div>
                    <button className="history-open" type="button" onClick={() => openWorkInMain(item.cid)}>もう一度見る</button>
                  </div>
                </article>
              ))}
            </div>

            {error ? <div className="saved-inline-error" role="status">{error}</div> : null}
            {hasMore ? (
              <div className="saved-load-more">
                <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "読み込み中…" : "さらに表示"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>

      <GlobalNav active="mypage" />
    </div>
  );
}
