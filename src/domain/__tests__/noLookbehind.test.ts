import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// 正規表現の後読み（(?<= / (?<!）は Safari 16.4 より古い WebKit で構文エラーになり，
// macOS 12 のアプリでは読み込みの時点で画面が真っ白になる（2026-11-04 macbookpro）．
// アプリのコードに入れない（テストのファイルは対象外）．
const SRC = join(__dirname, '..', '..');

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

describe('後読みの正規表現を使わない', () => {
  it('src/ に (?<= と (?<! が無い', () => {
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      readFileSync(f, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/\(\?<[=!]/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
            hits.push(`${relative(SRC, f)}:${i + 1}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
