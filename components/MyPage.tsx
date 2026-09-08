import { useCallback, useEffect, useState } from "react";

import { GlobalNav } from "@/components/GlobalNav";
import { BookmarkIcon, UserIcon } from "@/components/icons";
import { fetchJson } from "@/src/api";
import { navigateToSubpage } from "@/src/navigationState";

type ProfileResponse = {
  ok: boolean;
  profile: {
    createdAt: string | null;
    stats: { saved: number; viewed: number };
    topGenres: Array<{ id: string; name: string; score: number }>;
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

export function MyPage() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
                <span>ログインなしでそのまま利用できます</span>
              </div>
            </section>

            <section className="profile-stats" aria-label="利用状況">
              <button type="button" onClick={() => navigateToSubpage("/saved", "mypage")}>
                <span><BookmarkIcon /> 保存済み</span>
                <strong>{data.profile.stats.saved.toLocaleString("ja-JP")}</strong>
              </button>
              <div>
                <span>見た作品</span>
                <strong>{data.profile.stats.viewed.toLocaleString("ja-JP")}</strong>
              </div>
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
              <div className="profile-section-head"><h2>利用開始日</h2></div>
              <p className="profile-date">{formatDate(data.profile.createdAt)}</p>
            </section>
          </>
        ) : null}
      </main>

      <GlobalNav active="mypage" />
    </div>
  );
}
