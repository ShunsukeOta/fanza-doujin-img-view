import { readFileSync } from "node:fs";

const id = process.env.DEBT_CHECK ?? "";
const read = (path) => readFileSync(path, "utf8");
const fail = (message) => { console.error(message); process.exitCode = 1; };
const has = (text, values, label) => values.forEach((value) => { if (!text.includes(value)) fail(`${label}: missing ${value}`); });
const not = (text, values, label) => values.forEach((value) => { if (text.includes(value)) fail(`${label}: obsolete ${value}`); });

const checks = {
  "client-my": () => { const t=read("components/MyPage.tsx"); has(t,["subscribeReaderSettings","readerSettingsEqual","ビューアー設定","利用データを削除"],"MyPage"); not(t,["いいね","liked"],"MyPage"); },
  "client-legal": () => { const t=read("components/LegalPages.tsx"); has(t,["プライバシーポリシー","利用規約","閲覧・操作履歴"],"Legal"); not(t,["いいね"],"Legal"); },
  "client-search": () => { const t=read("components/SearchPage.tsx"); has(t,["maker","series","genreId","minRating","price_asc","/api/search","openWorkInMain(item.cid)","search-result-buy",'placement: "search"'],"Search"); not(t,["floor","Floor","NO IMAGE","likeCount","saveCount","viewerLiked"],"Search"); },
  "client-saved": () => { const t=read("components/SavedPage.tsx"); has(t,["/api/saved","openWorkInMain(item.cid)","favorite-buy","favorite-deal-badge",'placement: "saved"'],"Saved"); not(t,["floor","Floor","NO IMAGE","likeCount","saveCount","viewerLiked"],"Saved"); },
  "client-nav": () => { const t=read("components/GlobalNav.tsx"); has(t,["SearchIcon",">検索<",">読む<",'navigateToSubpage("/mypage", origin)'],"Nav"); not(t,["floor","Floor","/favorites","global-nav-main"],"Nav"); const css=read("styles/navigation.css"); if ((css.match(/\.global-nav-item\.is-active/g) ?? []).length !== 1) fail("nav active style count"); },
  "client-save-state": () => { const t=read("src/saveState.ts"); has(t,["MAX_SAVE_STATE_CIDS = 50","/api/save-state",'eventType: "save_toggle"',"viewerSaved"],"saveState"); not(t,["like","saveCount","reaction"],"saveState"); },
  "client-types": () => { const t=read("lib/types.ts"); has(t,["SaveState","viewerSaved"],"types"); not(t,["FloorKey","mediaType","sampleMovieUrl","AssetType","assetType","assetBucket","assetLabel","assetTypes","FilterValues","ReactionSummary","likeCount","saveCount","viewerLiked"],"types"); },
  "server-schema": () => { const t=read("server/app/schema.sql"); has(t,["idx_works_feed","feed_sessions","feed_items","user_work_states","saved_at"],"schema"); not(t,["floor_key","sample_movie_url","idx_works_floor_feed","asset_type","asset_bucket","idx_works_asset","liked","liked_at","idx_user_work_states_work_reactions"],"schema"); },
  "server-events": () => { const t=read("server/app/src/EventService.php"); has(t,["SAVE_WEIGHT = 7.0","AFFILIATE_CLICK_WEIGHT = 10.0","saveStates(","saveStatesWithPdo","saveDelta","'save_toggle'"],"events"); not(t,["like_toggle","reactionSummaries","likeCount","saveCount","viewerLiked","SUM(saved)"],"events"); },
  "server-library": () => { const t=read("server/app/src/UserLibraryService.php"); not(t,["liked","viewerLiked","likeCount","saveCount"],"library"); },
  "server-setup": () => { const t=read("server/app/cron/setup-db.php"); has(t,["idx_works_feed","recommendation-v3-rebuild-20260907","recommendation-commerce-signals-20260909","recommendation-save-only-20260909","drop_column_if_exists","7.0 AS signal_score","DELETE FROM feed_sessions"],"setup"); not(t,["ComicOnlyCleanup","multi-floor-amateur-video-20260908","floor_key","sample_movie_url","asset_type","asset_bucket","amateur","s.liked *"],"setup"); },
  "server-search": () => { const t=read("server/app/src/SearchService.php"); has(t,["maker_query","series_query","genre_id","price_asc","feedItemsByCids","saveStates"],"SearchService"); not(t,["floor_key","amateur","reactionSummaries","likeCount","saveCount","viewerLiked"],"SearchService"); },
};

if (!checks[id]) throw new Error(`unknown DEBT_CHECK: ${id}`);
checks[id]();
if (!process.exitCode) console.log(`diagnose exact ${id}: OK`);
