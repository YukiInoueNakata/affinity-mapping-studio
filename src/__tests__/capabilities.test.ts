import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// 2026-08-16 回帰テスト．
//
// univ / metis で「ウィンドウが閉じられないまま残るアプリ」が発生した根本原因は，
// capability に `core:window:allow-destroy` が無く JS からの destroy() が ACL に
// 拒否されていたこと (`core:window:default` は getter しか含まない)．
// Tauri は close-requested に JS リスナーが居ると OS の close を必ず prevent する
// ため，JS が閉じられない = 二度と閉じられない窓になる．
// 権限漏れは型検査にもビルドにも引っかからないので，ここで固定する．
const here = dirname(fileURLToPath(import.meta.url));
const capabilityPath = resolve(here, '../../src-tauri/capabilities/default.json');

interface Capability {
  windows: string[];
  permissions: string[];
}

function loadCapability(): Capability {
  return JSON.parse(readFileSync(capabilityPath, 'utf-8')) as Capability;
}

describe('tauri capability (default)', () => {
  it('ウィンドウを閉じる / タイトルを変える権限を含む', () => {
    const { permissions } = loadCapability();
    // destroy: 閉じる経路の保険 (本線は Rust の quit_app)．
    expect(permissions).toContain('core:window:allow-destroy');
    // set_title: 無いとバージョン付きタイトルが黙って反映されない．
    expect(permissions).toContain('core:window:allow-set-title');
  });

  it('原文ビューアを開くのに必要な webview 権限を含む', () => {
    const { permissions, windows } = loadCapability();
    expect(windows).toContain('main');
    expect(windows).toContain('source');
    expect(permissions).toContain('core:webview:allow-create-webview-window');
  });
});
