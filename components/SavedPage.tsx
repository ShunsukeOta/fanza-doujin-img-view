import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { BookmarkIcon } from "@/components/icons";
import type { FeedItem } from "@/lib/types";
import { trackEvent } from "@/src/analytics";
import { fetchJson } from "@/src/api";
import { openWorkInMain } from "@/src/navigationState";
import { formatPrice } from "@/src/price";
import { updateReaction } from "@/src/reactions";

type SavedResponse = {
  ok: boolean;
  items: FeedItem[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

function validAffiliateUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function mergeUniqueItems(current: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const seen = new Set(current.map((item) => item.cid));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (!item.cid || seen.has(item.cid)) return false;
      seen.add(item.cid);
      return true;
    }),
  ];
}

export function SavedPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [pendingCid, setPendingCid] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson<SavedResponse>(
        "/api/saved?limit=24",
        {
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
          credentials: "same-origin",
          cache: "no-store",
        },
        "保存済み作品を取得できませんでした",
      );
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "保存済み作品を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!hasMore || !cursor || loadingMore) return;

    setLoadingMore(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "24", cursor });
      const data = await fetchJson<SavedResponse>(
        `/api/saved?${query}`,
        { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" },
        "保存済み作品を追加取得できませんでした",
      );
      setItems((current) => mergeUniqueItems(current, data.items ?? []));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "追加取得に失敗しました。");
    } finally {
      setLoadingMore(false);
    }
  };

  const removeSaved = async (item: FeedItem) => {
    if (pendingCid) return;

    setPendingCid(item.cid);
    setError("");
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
        <h1>保存済み</h1>
        <button
          className="subpage-refresh"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          再読込
        </button>
      </header>

      <main className="subpage-content">
        <div className="subpage-summary" aria-label={`保存した作品 ${total}件`}>
          <span>保存した作品 <strong>{total.toLocaleString("ja-JP")}</strong>件</span>
        </div>

        {loading ? (
          <div className="subpage-state">
            <div className="spinner" aria-hidden="true" />
            <strong>保存済み作品を読み込んでいます</strong>
          </div>
        ) : items.length === 0 && error ? (
          <div className="subpage-state is-error">
            <strong>読み込みに失敗しました</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>再試行</button>
          </div>
        ) : items.length === 0 ? (
          <div className="subpage-state">
            <span className="subpage-state-icon"><BookmarkIcon /></span>
            <strong>まだ保存した作品がありません</strong>
            <p>コミックフィードで「保存」を押した作品がここに並びます。</p>
            <button type="button" onClick={() => window.location.assign("/")}>コミックを探す</button>
          </div>
        ) : (
          <>
            <div className="favorite-grid">
              {items.map((item) => {
                const canBuy = item.available !== false && validAffiliateUrl(item.affiliateUrl);
                const priceDrop = typeof item.priceDropValue === "number" && item.priceDropValue > 0
                  ? item.priceDropValue
                  : null;

                return (
                  <article
                    className={`favorite-card${item.available === false ? " is-unavailable" : ""}`}
                    key={item.cid}
                  >
                    <div className="favorite-thumb">
                      {item.images[0] ? (
                        <img src={item.images[0]} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <div className="favorite-noimage">NO IMAGE</div>
                      )}
                      {item.available === false ? <span className="favorite-type">販売終了</span> : null}
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
                        {item.price ? <span>{formatPrice(item.price, item.priceValue ?? null)}</span> : null}
                      </div>
                      {priceDrop !== null ? (
                        <p className="favorite-price-drop">
                          保存時より {formatPrice("", priceDrop)} 値下げ
                        </p>
                      ) : null}
                      {item.genres.length > 0 ? (
                        <p className="favorite-genres">{item.genres.slice(0, 4).join(" / ")}</p>
                      ) : null}

                      <div className={`favorite-actions${canBuy ? " favorite-actions--buy" : ""}`}>
                        <button
                          className="favorite-sample"
                          type="button"
                          onClick={() => openWorkInMain(item.cid)}
                        >
                          サンプル
                        </button>
                        {canBuy ? (
                          <a
                            className="favorite-buy"
                            href={item.affiliateUrl}
                            target="_blank"
                            rel="noopener noreferrer sponsored"
                            onClick={() => trackEvent({
                              eventType: "affiliate_click",
                              cid: item.cid,
                              placement: "saved",
                            }, true)}
                          >
                            FANZAで見る
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
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

      <GlobalNav active="saved" />
    </div>
  );
}
