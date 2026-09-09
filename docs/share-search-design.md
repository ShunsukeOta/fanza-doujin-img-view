# 作品共有・詳細検索・フロアUI設計

## 前提

初回リリースの実データ・API・DB・ReaderはFANZA同人コミックのみを対象とする。将来の「同人漫画 / 女優動画 / 素人動画」展開に備え、フロア切替はプレゼンテーション層だけに置く。`works`、CatalogService、SearchService、保存API、推薦、FANZA同期へ動画用の分岐・列・URLを先回りして持ち込まない。

現在のフロア定義は `src/floors.ts` を単一のUI定義元とする。

- `comic`: 同人漫画。利用可能
- `actress`: 女優動画。準備中
- `amateur`: 素人動画。準備中

未公開フロアではコミックAPIを流用せず、Feed・詳細検索・保存済みの各画面で準備中状態を表示する。動画フロア公開時にVideo Viewer、専用検索条件、作品取得、保存・履歴・推薦のDomainを正式に追加する。

## フロア切替

- Feed、`/search`、`/saved` の上部に共通 `FloorTabs` を表示する
- FeedではReader上部のoverlayとして表示する
- 詳細検索・保存済みではコンテンツ先頭に表示する
- フロア状態はUI専用の `floor` queryで保持する
  - `/?floor=actress`
  - `/search?floor=actress`
  - `/saved?floor=actress`
- 同人漫画は既存canonical URLを維持し、不要な `floor=comic` は付けない
- 下部GlobalNavで「読む / 検索 / 保存」を移動しても選択中フロアを維持する
- マイページ、履歴、作品共有URLは現時点ではコミックDomainとして扱い、フロアqueryを伝播させない

## 作品共有

- canonical作品URLは `/work/{cid}`
- 旧 `/?cid={cid}` は301でcanonicalへ統一する
- `work.php` がDBから作品情報を取得し、React起動前にOGP / X Card / canonicalをHTMLへ埋め込む
- 共有URLは年齢確認後、対象作品Readerへ直接入る
- 作品URLは現段階では `noindex` を維持し、SEO公開判断とは分離する

## 詳細検索

- `/search` をFeed内絞り込みSheetとは独立した検索画面として提供する
- コミックでは `/api/search` → `SearchService` → MariaDB の責務分離とする
- 作品名・サークル・シリーズ・ジャンル・価格・最低評価・最低サンプル枚数・最低レビュー件数・並び順を検索可能とする
- 検索結果から `/work/{cid}` へ遷移してReaderを開始する
- 女優動画・素人動画を選択中はAPIを呼ばず準備中表示とし、将来同一Search Shellへ出演者・動画時間等のフロア固有条件を追加する

## 保存済み

- `/saved` のコミックフロアは現在のコミック保存状態を表示する
- 保存時価格と現在価格を比較して価格変化を表示する
- 保存結果から `/work/{cid}` へ戻してReaderを開始できる
- 未公開動画フロアではコミック保存APIを呼ばず準備中表示とする

## グローバルメニュー

下部メニューは「読む / 検索 / 保存 / マイページ」の4項目とする。上部FloorTabsが「何を見るか」、下部GlobalNavが「何をするか」を担当し、役割を分離する。

動画フロア追加前の現段階では、フロア切替UIは将来導線の提示と情報設計固定だけを担う。コンテンツDomainは引き続きコミック専用とする。
