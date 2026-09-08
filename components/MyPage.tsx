import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { BookmarkIcon, UserIcon } from "@/components/icons";
import { Onboarding } from "@/components/Onboarding";
import type { FeedItem } from "@/lib/types";
import { clearAgeVerification } from "@/src/ageVerification";
import { fetchJson } from "@/src/api";
import { navigateToSubpage, openWorkInMain } from "@/src/navigationState";
import {
  loadReaderSettings,
  readerSettingsEqual,
  saveReaderSettings,
  subscribeReaderSettings,
  type ReaderSettings,
} from "@/src/readerSettings";

type HistoryItem = FeedItem & { viewedAt?: string };

type ProfileResponse = {
  ok: boolean;
  profile: {
    createdAt: string | null;
    stats: { saved: number; liked: number; viewed: number };
    topGenres: Array<{ id: string; name: string; score: number }>;
    recentHistory: HistoryItem[];
  };
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function clearClientAppState(): void {
  const storages = [
    () => window.localStorage,
    () => window.sessionStorage,
  ];
  for (const getStorage of storages) {
    try {
      const storage = getStorage();
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith("swipe-preview:")));
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // Storageを利用できない環境ではサーバー側削除だけを完了させる。
    }
  }
}

export function MyPage() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(() => loadReaderSettings());
  const [guideOpen, setGuideOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchJson<ProfileResponse>(
        "/api/me",
        {
          headers: { Accept: "application/json", "Cache-Control": "no-cache" },
          credentials: "same-origin",
          cache: "no-store",
        },
        "マイページ情報を取得できませんでした",
      );
      setData(response);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : "マイページ情報を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeReaderSettings((next) => {
    setReaderSettings((current) => readerSettingsEqual(current, next) ? current : next);
  }), []);

  useEffect(() => {
    saveReaderSettings(readerSettings);
  }, [readerSettings]);

  const updateReader = (patch: Partial<ReaderSettings>) => {
    setReaderSettings((current) => ({ ...current, ...patch }));
  };

  const deleteAnonymousData = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await fetchJson<{ ok: boolean; deleted: boolean }>(
        "/api/me",
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        },
        "匿名データを削除できませんでした",
      );
      clearAgeVerification();
      clearClientAppState();
      window.location.replace("/");
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : "削除に失敗しました。");
      setDeleting(false);
    }
  };

  return (
    <div className="subpage-shell">
      <header className="subpage-header">
        <h1>マイページ</h1>
      </header>

      <main className="subpage-content mypage-content">
        {loading ? (
          <div className="subpage-state">
            <div className="spinner" aria-hidden="true" />
            <strong>マイページを読み込んでいます</strong>
          </div>
        ) : error ? (
          <div className="subpage-state is-error">
            <strong>読み込みに失敗しました</strong>
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>再試行</button>
          </div>
        ) : data ? (
          <>
            <section className="profile-hero">
              <div className="profile-avatar"><UserIcon /></div>
              <div className="profile-copy">
                <strong>ゲストユーザー</strong>
                <span>ログイン不要・匿名IDで利用中</span>
              </div>
              <span className="profile-status">ANONYMOUS</span>
            </section>

            <section className="profile-stats" aria-label="利用状況">
              <button type="button" onClick={() => navigateToSubpage("/saved", "mypage")}>
                <span><BookmarkIcon /> 保存済み</span>
                <strong>{data.profile.stats.saved.toLocaleString("ja-JP")}</strong>
              </button>
              <button type="button" onClick={() => navigateToSubpage("/history", "mypage")}>
                <span>見た作品</span>
                <strong>{data.profile.stats.viewed.toLocaleString("ja-JP")}</strong>
              </button>
              <div>
                <span>いいね</span>
                <strong>{data.profile.stats.liked.toLocaleString("ja-JP")}</strong>
              </div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head">
                <h2>最近見た作品</h2>
                <button type="button" className="profile-section-link" onClick={() => navigateToSubpage("/history", "mypage")}>すべて見る</button>
              </div>
              {data.profile.recentHistory.length ? (
                <div className="profile-history-grid">
                  {data.profile.recentHistory.map((item) => (
                    <button type="button" key={item.cid} className="profile-history-card" onClick={() => openWorkInMain(item.cid)}>
                      <span className="profile-history-thumb">
                        {item.images[0] ? <img src={item.images[0]} alt="" loading="lazy" decoding="async" /> : <i>NO IMAGE</i>}
                      </span>
                      <span>{item.title || item.cid}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="profile-empty">作品を見ると、最近見た作品をここからすぐ開けます。</p>
              )}
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>あなたの好み</h2></div>
              {data.profile.topGenres.length ? (
                <div className="profile-tags">
                  {data.profile.topGenres.map((genre) => <span key={genre.id}>{genre.name}</span>)}
                </div>
              ) : (
                <p className="profile-empty">作品を見るほど、好みに近いジャンルがここに表示されます。</p>
              )}
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>Reader設定</h2></div>
              <div className="settings-list">
                <div className="settings-row settings-row--stack">
                  <div><strong>画像の表示</strong><span>ページ全体を収めるか、横幅を優先します。</span></div>
                  <div className="settings-segmented" role="group" aria-label="画像の表示方法">
                    <button className={readerSettings.fitMode === "contain" ? "is-active" : ""} type="button" onClick={() => updateReader({ fitMode: "contain" })}>全体表示</button>
                    <button className={readerSettings.fitMode === "width" ? "is-active" : ""} type="button" onClick={() => updateReader({ fitMode: "width" })}>横幅優先</button>
                  </div>
                </div>
                <div className="settings-row settings-row--stack">
                  <div><strong>読む方向</strong><span>一般的な同人漫画は右から左がおすすめです。</span></div>
                  <div className="settings-segmented" role="group" aria-label="読む方向">
                    <button className={readerSettings.readingDirection === "rtl" ? "is-active" : ""} type="button" onClick={() => updateReader({ readingDirection: "rtl" })}>右 → 左</button>
                    <button className={readerSettings.readingDirection === "ltr" ? "is-active" : ""} type="button" onClick={() => updateReader({ readingDirection: "ltr" })}>左 → 右</button>
                  </div>
                </div>
                <label className="settings-row">
                  <div><strong>画面端タップでページ送り</strong><span>スワイプせず左右の端をタップして送れます。</span></div>
                  <input className="settings-switch" type="checkbox" checked={readerSettings.tapNavigation} onChange={(event) => updateReader({ tapNavigation: event.currentTarget.checked })} />
                </label>
                <label className="settings-row">
                  <div><strong>Reader UIを最小化</strong><span>作品情報や操作UIを隠して画像を優先します。</span></div>
                  <input className="settings-switch" type="checkbox" checked={readerSettings.controlsHidden} onChange={(event) => updateReader({ controlsHidden: event.currentTarget.checked })} />
                </label>
              </div>
            </section>

            <section className="profile-section profile-menu-section">
              <div className="profile-section-head"><h2>操作と情報</h2></div>
              <div className="profile-menu">
                <button type="button" onClick={() => setGuideOpen(true)}><span><strong>操作ガイド</strong><small>上下スワイプ・ページ送り・保存方法を確認</small></span><em>›</em></button>
                <button type="button" onClick={() => navigateToSubpage("/history", "mypage")}><span><strong>閲覧履歴</strong><small>最近見た作品をもう一度開く</small></span><em>›</em></button>
                <button type="button" onClick={() => navigateToSubpage("/saved", "mypage")}><span><strong>保存済み</strong><small>あとで読む作品と値下げ情報</small></span><em>›</em></button>
                <a href="/privacy"><span><strong>プライバシーポリシー</strong><small>匿名データ・Cookie・保存期間</small></span><em>›</em></a>
                <a href="/terms"><span><strong>利用規約</strong><small>18歳以上・アフィリエイト・利用条件</small></span><em>›</em></a>
              </div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>利用情報</h2></div>
              <dl className="profile-facts">
                <div><dt>利用開始日</dt><dd>{formatDate(data.profile.createdAt)}</dd></div>
                <div><dt>ログイン</dt><dd>不要</dd></div>
                <div><dt>閲覧履歴の保存</dt><dd>イベント保存期間内</dd></div>
              </dl>
            </section>

            <section className="profile-section profile-danger-zone">
              <div className="profile-section-head"><h2>データ管理</h2></div>
              <p>現在の匿名IDに紐づく閲覧履歴、保存、いいね、嗜好、固定フィードと、この端末のReader設定・年齢確認を削除できます。</p>
              <button className="danger-button" type="button" onClick={() => { setDeleteError(""); setDeleteOpen(true); }}>匿名データを削除</button>
            </section>
          </>
        ) : null}
      </main>

      <GlobalNav active="mypage" />

      {guideOpen ? <Onboarding mode="guide" onComplete={() => setGuideOpen(false)} /> : null}

      {deleteOpen ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-data-title">
          <div className="confirm-card">
            <span className="confirm-kicker">DATA DELETE</span>
            <h2 id="delete-data-title">匿名データを削除しますか？</h2>
            <p>閲覧履歴、保存、いいね、おすすめ学習データ、固定フィード、端末設定を削除します。この操作は取り消せません。</p>
            {deleteError ? <div className="confirm-error" role="status">{deleteError}</div> : null}
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" disabled={deleting} onClick={() => setDeleteOpen(false)}>キャンセル</button>
              <button type="button" className="confirm-delete" disabled={deleting} onClick={() => void deleteAnonymousData()}>{deleting ? "削除中…" : "削除する"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
