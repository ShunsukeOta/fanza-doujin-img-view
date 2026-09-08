# 素人動画フィード受入条件

- [x] comic / amateurを同一`SwipePreviewApp`で描画する
- [x] 左上表示切替でcomic / amateurをページ再読込なしに切り替える
- [x] amateurでは横ページ送りを使わない
- [x] amateurでは読む方向設定を表示しない
- [x] amateurでは画像fit設定を表示しない
- [x] amateurではズーム処理を使わない
- [x] `digital / videoc`から作品を取得する
- [x] `sampleMovieURL`がない作品をFeed対象外にする
- [x] FANZA litevideoをiframeとして扱う
- [x] raw video URLの場合はnative videoとして扱う
- [x] 非アクティブ動画のプレイヤーを読み込まない
- [x] フロア別に固定推薦Feedを分離する
- [x] フロア別にジャンルを分離する
- [x] フロア別に詳細検索を行う
- [x] フロア別に保存一覧を行う
- [x] いいね / 保存 / 共有 / アフィリエイトCTAを動画でも共用する
- [x] 動画表示・滞在を行動イベントへ記録する
- [x] 本番CSPでFANZA/DMM動画埋め込みを許可する
- [x] 6時間保守でcomic / amateurを同期する
- [x] 女優動画は準備中のまま維持する
- [x] MariaDB統合テストでフロア混在を検出する
- [x] debt checkで動画固有実装と複数フロア境界を固定する

PRではTypeScript、PHP lint、MariaDB migration、既存コミック回帰、複数フロア統合、本番ビルドをすべて通過させてからmainへマージする。
