import { confirmDialog } from '../services/confirmDialog.js';
// 「このソフトについて」: 版・作者・ライセンス・引用文 (コピーできる)・新しい版の確認．
// UpdateDialog: 新しい版が見つかったときの「更新しますか」．起動時の自動確認と
// この画面の「新しい版を確認」の両方から使う．

import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useProjectStore } from '../stores/projectStore.js';
import {
  APP_NAME,
  AUTHOR,
  LICENSE_NAME,
  METHOD_REFERENCES,
  REPO_URL,
  WEBPAGE_URL,
  softwareCitations,
  type CitationText,
} from '../about/aboutInfo.js';
import {
  RELEASES_URL,
  checkForUpdate,
  installUpdate,
  isAutoCheckEnabled,
  isUpdaterAvailable,
  setAutoCheckEnabled,
  skipVersion,
  type UpdateInfo,
} from '../services/updater.js';

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    // ブラウザで開けない環境 (開発時など) は URL をコピーする．
    await navigator.clipboard.writeText(url);
    alert(`ブラウザを開けなかったので，URL をコピーしました:\n${url}`);
  }
}

function CopyRow({ item }: { item: CitationText }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="about-cite">
      <div className="about-cite-head">
        <span className="about-cite-label">{item.label}</span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(item.text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <pre className="about-cite-text">{item.text}</pre>
    </div>
  );
}

export function UpdateDialog({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const isDirty = useProjectStore((s) => s.isDirty);
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const installing = progress !== undefined && error === null;

  const onInstall = async () => {
    if (isDirty && !(await confirmDialog('保存していない変更があります．更新するとアプリが再起動し，保存していない変更は失われます．続けますか？\n（先に保存する場合は「キャンセル」を押してください）'))) {
      return;
    }
    setError(null);
    setProgress(null);
    try {
      await installUpdate(info, (r) => setProgress(r));
    } catch (e) {
      setError((e as Error).message ?? String(e));
      setProgress(undefined);
    }
  };

  return (
    <div className="modal-backdrop" onClick={installing ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <header className="modal-header">
          <h2>新しい版があります</h2>
        </header>
        <div className="modal-body" style={{ lineHeight: 1.7 }}>
          <p>
            今の版は v{info.currentVersion}，新しい版は <b>v{info.version}</b> です．更新しますか？
          </p>
          {info.notes && <pre className="about-cite-text" style={{ maxHeight: 180, overflow: 'auto' }}>{info.notes}</pre>}
          {installing && (
            <p>
              {progress === null || progress === undefined
                ? 'ダウンロードしています…'
                : progress >= 1
                  ? 'インストールしています．終わるとアプリが再起動します…'
                  : `ダウンロードしています… ${Math.round(progress * 100)}%`}
            </p>
          )}
          {error && (
            <p style={{ color: '#c0392b' }}>
              更新に失敗しました: {error}
              <br />
              ダウンロードのページから手で入れることもできます．
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={() => openExternal(`${RELEASES_URL}/latest`)} disabled={installing}>
            ダウンロードのページを開く
          </button>
          <button
            type="button"
            onClick={() => {
              skipVersion(info.version);
              onClose();
            }}
            disabled={installing}
            title="この版の自動の知らせを出さない（手で確認すれば出ます）"
          >
            この版は飛ばす
          </button>
          <button type="button" onClick={onClose} disabled={installing}>
            あとで
          </button>
          <button type="button" className="primary" onClick={onInstall} disabled={installing}>
            更新する
          </button>
        </footer>
      </div>
    </div>
  );
}

export function AboutDialog({
  open,
  onClose,
  onUpdateFound,
}: {
  open: boolean;
  onClose: () => void;
  onUpdateFound: (info: UpdateInfo) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [autoCheck, setAutoCheck] = useState(isAutoCheckEnabled());
  if (!open) return null;

  const version = __APP_VERSION__;
  const citations = softwareCitations(version, __BUILD_YEAR__);

  const onCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const info = await checkForUpdate();
      if (info) {
        onUpdateFound(info);
      } else {
        setCheckResult(
          isUpdaterAvailable() ? `今の版 v${version} が最新です．` : 'この環境では確認できません（開発用の起動など）．'
        );
      }
    } catch (e) {
      setCheckResult(`確認できませんでした: ${(e as Error).message ?? String(e)}（ネットワークを確かめてください）`);
    } finally {
      setChecking(false);
    }
  };

  const allText = [
    `${APP_NAME} v${version}`,
    `作者: ${AUTHOR.nameJa}（${AUTHOR.nameEn}）・${AUTHOR.affiliationJa}`,
    `ウェブページ: ${WEBPAGE_URL}`,
    `GitHub: ${REPO_URL}`,
    `ライセンス: ${LICENSE_NAME}`,
    '',
    '引用:',
    ...citations.filter((c) => c.id !== 'bibtex').map((c) => c.text),
    ...METHOD_REFERENCES.map((c) => c.text),
  ].join('\n');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 680 }}>
        <header className="modal-header">
          <h2>このソフトについて</h2>
        </header>
        <div className="modal-body about-body">
          <section>
            <div className="about-title">{APP_NAME}</div>
            <table className="about-table">
              <tbody>
                <tr>
                  <th>版</th>
                  <td>v{version}</td>
                </tr>
                <tr>
                  <th>作者</th>
                  <td>
                    {AUTHOR.nameJa}（{AUTHOR.nameEn}）
                    <br />
                    {AUTHOR.affiliationJa}
                  </td>
                </tr>
                <tr>
                  <th>ウェブページ</th>
                  <td>
                    <a href="#" onClick={(e) => { e.preventDefault(); void openExternal(WEBPAGE_URL); }}>{WEBPAGE_URL}</a>
                  </td>
                </tr>
                <tr>
                  <th>GitHub</th>
                  <td>
                    <a href="#" onClick={(e) => { e.preventDefault(); void openExternal(REPO_URL); }}>{REPO_URL}</a>
                  </td>
                </tr>
                <tr>
                  <th>ライセンス</th>
                  <td>{LICENSE_NAME}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h3>論文などで使ったときの引用</h3>
            <p className="muted small">版の番号は，使った版に合わせてください．</p>
            {citations.map((c) => (
              <CopyRow key={c.id} item={c} />
            ))}
            {METHOD_REFERENCES.length > 0 && (
              <>
                <h3>方法の文献</h3>
                {METHOD_REFERENCES.map((c) => (
                  <CopyRow key={c.id} item={c} />
                ))}
              </>
            )}
          </section>

          <section>
            <h3>新しい版</h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={onCheck} disabled={checking}>
                {checking ? '確認しています…' : '新しい版を確認'}
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={autoCheck}
                  onChange={(e) => {
                    setAutoCheck(e.target.checked);
                    setAutoCheckEnabled(e.target.checked);
                  }}
                />{' '}
                起動したときに自動で確認する（1 日 1 回まで）
              </label>
            </div>
            {checkResult && <p className="small">{checkResult}</p>}
          </section>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={() => void navigator.clipboard.writeText(allText)}>
            全部をコピー
          </button>
          <button type="button" className="primary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}
