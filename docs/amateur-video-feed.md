# 素人動画フィード実装仕様

## 目的

既存の同人コミックFeedを別アプリへ分岐させず、同じFeed Shell・推薦・保存・検索・行動計測を再利用して素人動画を追加する。

## フロア

| key | FANZA service | FANZA floor | 状態 |
| --- | --- | --- | --- |
| `comic` | `doujin` | `digital_doujin` | 公開 |
| `amateur` | `digital` | `videoc` | 公開 |
| `actress` | - | - | 準備中 |

女優動画は素人動画の運用・動画UIが安定した後に、同じ動画基盤へ追加する。

## Feed共通化

`SwipePreviewApp`をFeed Shellとして共用する。

- 縦方向の作品切替
- 固定Feedと追加取得
- 絞り込み
- いいね / 保存 / 共有
- アフィリエイトCTA
- 行動イベント
- フォーカス表示
- グローバルメニュー
- 仮想化

コンテンツ固有部分だけを差し替える。

### コミック

- `WorkCard`
- 横ページ送り
- RTL / LTR
- contain / 横幅優先
- 画面端タップ
- ダブルタップ / ピンチズーム
- 読了CTA

### 素人動画

- `VideoWorkCard`
- 縦作品切替のみ
- 漫画Reader設定は表示しない
- `sampleMovieURL`を使用
- FANZA litevideo URLはiframeで表示
- 将来raw video URLが返る場合はnative videoへ自動切替
- 非アクティブ作品は動画プレイヤーをアンマウントし、posterだけ表示
- native videoではmuted autoplay / 再生停止 / 音声 / 進捗 / 終了CTA
- iframeではクロスオリジン制約のため再生進捗を推測せず、表示・滞在・リアクション・アフィリエイト行動を計測

## 表示切替

Feed上の`FloorSwitcher`では`comic`と`amateur`をReact stateで切り替える。

- ページ全体を再読込しない
- URLは`/`と`/amateur`へ`history.replaceState`で同期
- `actress`は準備中画面へ通常遷移

## DB

`works`へ以下を追加する。

- `floor_key`: `comic | amateur`
- `sample_movie_url`: 動画サンプルURL。コミックではNULL

ジャンル / シリーズIDはFANZAフロア間のID衝突を避けるため、動画側だけ`amateur:{id}`で名前空間化する。

固定Feedはfilter hashへ`floorKey`を含め、コミックと素人動画のFeed sessionを混在させない。

## FANZA同期

`fanza-sync.php`は`--floor=all|comic|amateur`を受け付ける。省略時は両フロアを同期する。

- comic: `/digital/comic/`判定を通過した作品だけ保存
- amateur: `sampleMovieURL`が取得できる作品だけ保存

6時間ごとの保守Workflowはデフォルト`all`で両フロアを更新する。

## API

以下は`floor=comic|amateur`を受け付ける。

- `/api/catalog`
- `/api/meta`
- `/api/search`
- `/api/saved`

未指定時は互換性のため`comic`。

## 検索・保存

検索・保存画面も同じShellを使用する。

- 素人動画では「最低サンプル枚数」を表示しない
- サークル表記をメーカーへ切り替える
- 検索結果 / 保存済みから`/amateur?cid={cid}`へ戻れる
- 女優動画は引き続き準備中

## セキュリティ

FANZA litevideoを埋め込むため本番CSPへ`frame-src`を追加する。native videoへも対応できるよう`media-src`を明示する。

許可先はFANZA/DMM系ホストに限定し、`frame-ancestors 'none'`など既存の防御は維持する。
