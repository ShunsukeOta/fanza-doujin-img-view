import { useState } from "react";

import { acceptAgeVerification } from "@/src/ageVerification";

type Props = {
  onVerified: () => void;
};

export function AgeGate({ onVerified }: Props) {
  const [remember, setRemember] = useState(true);
  const [denied, setDenied] = useState(false);

  const accept = () => {
    acceptAgeVerification(remember);
    onVerified();
  };

  const leave = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.replace("about:blank");
  };

  if (denied) {
    return (
      <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-denied-title">
        <div className="age-gate-card age-gate-card--denied">
          <span className="age-gate-badge" aria-hidden="true">18+</span>
          <h1 id="age-denied-title">このサービスは利用できません</h1>
          <p className="age-gate-description">
            本サービスには成人向け作品が含まれるため、18歳未満の方は利用できません。
          </p>
          <button className="age-gate-primary" type="button" onClick={leave}>退出する</button>
          <button className="age-gate-text" type="button" onClick={() => setDenied(false)}>年齢確認へ戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="age-gate-card">
        <div className="age-gate-head">
          <span className="age-gate-badge" aria-hidden="true">18+</span>
          <h1 id="age-gate-title">18歳以上ですか？</h1>
        </div>

        <p className="age-gate-description">
          本サービスには成人向け作品のサンプルが含まれます。18歳以上であることを確認してからご利用ください。
        </p>

        <label className="age-gate-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <span>
            <strong>この端末で確認を記憶する</strong>
            <small>オフにすると、このブラウザを閉じるまで有効です。</small>
          </span>
        </label>

        <div className="age-gate-actions">
          <button className="age-gate-primary" type="button" onClick={accept}>18歳以上です</button>
          <button className="age-gate-secondary" type="button" onClick={() => setDenied(true)}>18歳未満です</button>
        </div>

        <p className="age-gate-note">
          「18歳以上です」を選択すると、<a href="/terms">利用規約</a>と<a href="/privacy">プライバシーポリシー</a>に同意したものとみなします。
        </p>
      </div>
    </div>
  );
}
