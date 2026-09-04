import { useCallback, useEffect, useMemo, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { UserIcon } from "@/components/icons";

type ProfileResponse = {
  ok: boolean;
  profile: {
    anonymousId: string;
    createdAt: string | null;
    lastSeenAt: string | null;
    stats: {
      liked: number;
      saved: number;
      viewed: number;
      events: number;
      affiliateClicks: number;
      shares: number;
    };
    topGenres: Array<{ id: string; name: string; score: number }>;
  };
  generatedAt: string;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function MyPage() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/me", {
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const next = await response.json().catch(() => null) as ProfileResponse | null;
      if (!response.ok || !next?.ok) throw new Error(next?.error || `マイページ情報を取得できませんでした (${response.status})`);
      setData(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "マイページ情報を取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shortId = useMemo(() => {
    const id = data?.profile.anonymousId ?? "";
    return id ? `${id.slice(0, 8)}…${id.slice(-4)}` : "-";
  }, [data?.profile.anonymousId]);

  return (
    <div className="subpage-shell">
      <header className="subpage-header">
        <div>
          <p className="subpage-eyebrow">PROFILE</p>
          <h1>マイページ</h1>
          <p className="subpage-description">利用状況・おすすめ傾向・各種設定をまとめるページです。</p>
        </div>
        <button className="subpage-refresh" type="button" onClick={() => void load()} disabled={loading}>再読込</button>
      </header>

      <main className="subpage-content mypage-content">
        {loading ? (
          <div className="subpage-state"><div className="spinner" aria-hidden="true" /><strong>プロフィールを読み込んでいます</strong></div>
        ) : error ? (
          <div className="subpage-state is-error"><strong>読み込みに失敗しました</strong><p>{error}</p><button type="button" onClick={() => void load()}>再試行</button></div>
        ) : data ? (
          <>
            <section className="profile-hero">
              <div className="profile-avatar"><UserIcon /></div>
              <div className="profile-copy"><strong>ゲストユーザー</strong><span>匿名プロフィール · {shortId}</span></div>
              <span className="profile-status">利用中</span>
            </section>

            <section className="profile-stats" aria-label="利用状況">
              <div><span>いいね</span><strong>{data.profile.stats.liked.toLocaleString("ja-JP")}</strong></div>
              <div><span>保存</span><strong>{data.profile.stats.saved.toLocaleString("ja-JP")}</strong></div>
              <div><span>閲覧作品</span><strong>{data.profile.stats.viewed.toLocaleString("ja-JP")}</strong></div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>あなたの傾向</h2><span>閲覧・いいね・保存から自動集計</span></div>
              {data.profile.topGenres.length > 0 ? (
                <div className="profile-tags">{data.profile.topGenres.map((genre) => <span key={genre.id}>{genre.name}</span>)}</div>
              ) : <p className="profile-empty">まだ十分な閲覧データがありません。作品を見るほどおすすめ傾向が育ちます。</p>}
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>利用情報</h2></div>
              <div className="profile-list">
                <div><span>利用開始</span><strong>{formatDate(data.profile.createdAt)}</strong></div>
                <div><span>最終アクセス</span><strong>{formatDate(data.profile.lastSeenAt)}</strong></div>
                <div><span>行動ログ</span><strong>{data.profile.stats.events.toLocaleString("ja-JP")}件</strong></div>
                <div><span>FANZA遷移</span><strong>{data.profile.stats.affiliateClicks.toLocaleString("ja-JP")}回</strong></div>
                <div><span>共有</span><strong>{data.profile.stats.shares.toLocaleString("ja-JP")}回</strong></div>
                <div><span>ユーザーID</span><strong>{shortId}</strong></div>
              </div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>設定</h2><span>今後ここから管理できます</span></div>
              <div className="settings-list">
                <button type="button" disabled><span><strong>表示設定</strong><small>画像表示・通信量・操作感</small></span><em>準備中</em></button>
                <button type="button" disabled><span><strong>おすすめ設定</strong><small>ジャンル傾向・レコメンド調整</small></span><em>準備中</em></button>
                <button type="button" disabled><span><strong>通知設定</strong><small>新着・お気に入り作品の更新通知</small></span><em>準備中</em></button>
              </div>
            </section>

            <section className="profile-section">
              <div className="profile-section-head"><h2>データ管理</h2></div>
              <div className="profile-list muted">
                <div><span>保存期間</span><strong>匿名プロフィールを一定期間保持</strong></div>
                <div><span>ログイン連携</span><strong>未実装</strong></div>
              </div>
              <p className="profile-footnote">現在はログイン不要の匿名利用です。アカウント機能・端末間同期・データ削除UIはこのページに追加できる構成です。</p>
            </section>
          </>
        ) : null}
      </main>

      <GlobalNav active="mypage" />
    </div>
  );
}
