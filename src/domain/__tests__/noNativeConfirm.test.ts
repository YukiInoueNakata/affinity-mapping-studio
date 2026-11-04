import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// デスクトップ版では window.confirm が使えない（2026-11-04）．
// - Windows: tauri-plugin-dialog が async 関数へ差し替え，Promise（常に真）を返す．
//   `if (!confirm(...)) return` が必ず素通りし，削除・破棄が確認なしで進んでいた．
// - macOS: WebView が何も出さずに false を返し，削除などが一切できない．
// 確認は services/confirmDialog.ts の `await confirmDialog(...)` を使う．
const SRC = join(__dirname, '..', '..');
const ALLOWED = new Set(['services/confirmDialog.ts', 'utils/bulkGuard.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('window.confirm を直接使わない', () => {
  it('src/ で confirm( / window.confirm( を呼んでいない', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const rel = relative(SRC, f).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;
          if (/(^|[^\w$.])confirm\(|window\.confirm\(/.test(line)) hits.push(`${rel}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
