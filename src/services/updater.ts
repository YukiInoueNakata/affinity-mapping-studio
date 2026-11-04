// 新しい版の確認と自動更新 (Tauri updater)．
//
// - 確認先: GitHub Releases の latest.json (tauri.conf.json の plugins.updater.endpoints)．
//   送るのは今の版・OS・CPU の種類だけ (updater の標準の問い合わせ)．
// - 起動時の自動確認は 1 日 1 回まで．設定 (この端末だけ) で切れる．
// - 更新は「確認 → ダウンロード → インストール → 再起動」．Windows は passive の
//   インストーラが走り，アプリはいったん閉じる．
// - 失敗は呼び出し側へ例外で返す (黙って握りつぶさない)．開発サーバーなど
//   updater が無い環境では isUpdaterAvailable() が false．

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const LAST_CHECK_KEY = 'ams.update.lastAutoCheck';
const AUTO_CHECK_KEY = 'ams.update.autoCheck';
const SKIP_VERSION_KEY = 'ams.update.skipVersion';
const DAY_MS = 24 * 60 * 60 * 1000;

export const RELEASES_URL = 'https://github.com/YukiInoueNakata/affinity-mapping-studio/releases';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  notes?: string;
  update: Update;
}

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // 保存できない環境 (プライベート等) では毎回確認になるだけ．
  }
}

export function isUpdaterAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isAutoCheckEnabled(): boolean {
  return readLS(AUTO_CHECK_KEY) !== '0';
}
export function setAutoCheckEnabled(on: boolean): void {
  writeLS(AUTO_CHECK_KEY, on ? '1' : '0');
}

export function skipVersion(version: string): void {
  writeLS(SKIP_VERSION_KEY, version);
}

/** 新しい版があれば返す．無ければ null．問い合わせの失敗は例外． */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isUpdaterAvailable()) return null;
  const update = await check({ timeout: 15000 });
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date,
    notes: update.body,
    update,
  };
}

/** 起動時の自動確認．1 日 1 回まで・設定で切れる・「この版は飛ばす」を尊重．
 *  失敗は console に残して null (起動を邪魔しない．手動の確認ではエラーを表示する)． */
export async function autoCheckForUpdate(now = Date.now()): Promise<UpdateInfo | null> {
  if (!isUpdaterAvailable() || !isAutoCheckEnabled()) return null;
  const last = Number(readLS(LAST_CHECK_KEY) ?? '0');
  if (Number.isFinite(last) && now - last < DAY_MS) return null;
  try {
    const info = await checkForUpdate();
    // 確かめられたときだけ時刻を残す．ネットワークが無くて失敗したら，次の起動でまた確かめる．
    writeLS(LAST_CHECK_KEY, String(now));
    if (info && readLS(SKIP_VERSION_KEY) === info.version) return null;
    return info;
  } catch (e) {
    console.warn('[updater] 起動時の確認に失敗しました', e);
    return null;
  }
}

/** ダウンロード → インストール → 再起動．onProgress には 0〜1 (大きさ不明なら null)． */
export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (ratio: number | null) => void
): Promise<void> {
  let total = 0;
  let done = 0;
  await info.update.downloadAndInstall((ev) => {
    if (ev.event === 'Started') {
      total = ev.data.contentLength ?? 0;
      onProgress?.(total > 0 ? 0 : null);
    } else if (ev.event === 'Progress') {
      done += ev.data.chunkLength;
      onProgress?.(total > 0 ? Math.min(1, done / total) : null);
    } else if (ev.event === 'Finished') {
      onProgress?.(1);
    }
  });
  await relaunch();
}
