# グローバルメニューとBFCache

グローバルメニューはページ遷移前に選択背景を移動させるため、表示上の選択状態と実URLが短時間だけ異なります。

ブラウザがその状態をBFCacheへ保存すると、履歴復帰時にURLと背景ピル位置が不一致になる可能性があります。

`GlobalNav` は次のタイミングでURLから表示状態を再同期します。

- `pagehide`: BFCacheへ退避される直前に実URL側へ戻す
- `pageshow`: BFCache復帰後に実URL側へ再同期する
- `popstate`: 履歴移動時に実URL側へ再同期する

`pagehide`ではReact stateに加えてナビDOMの`data-active`と`is-active`も同期し、BFCache snapshot自体に一時的な遷移先状態を残さないようにします。
