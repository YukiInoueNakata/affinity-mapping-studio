#!/usr/bin/env node
// 自動更新用の latest.json を作る．
//
// 使い方:
//   node scripts/make-latest-json.mjs <版 例 0.2.32> <配布物のフォルダ> [リリースノートのファイル]
//
// <配布物のフォルダ> に，次のファイルと，それぞれの .sig (署名) を置いておく:
//   - Windows NSIS: *_x64-setup.exe と *_x64-setup.exe.sig
//   - Windows MSI : *_x64_*.msi と *.msi.sig
//   - macOS       : *.app.tar.gz と *.app.tar.gz.sig (CI が作る．universal なので arm と intel の両方に使う)
// 出力: <配布物のフォルダ>/latest.json．これを Release に添付する．
//
// GitHub は配布物の名前の空白を "." に置き換えるので，URL もそれに合わせる
// (例 "Affinity Mapping Studio_0.2.31_x64-setup.exe" → "Affinity.Mapping.Studio_0.2.31_x64-setup.exe")．
// 見つからないものがあれば止める (fail-loud)．

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'YukiInoueNakata/affinity-mapping-studio';

function die(msg) {
  console.error(`[make-latest-json] ${msg}`);
  process.exit(1);
}

const [, , version, dir, notesFile] = process.argv;
if (!version || !dir) die('使い方: node scripts/make-latest-json.mjs <版> <配布物のフォルダ> [リリースノート]');
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`版の形が違います: ${version}`);
if (!existsSync(dir)) die(`フォルダがありません: ${dir}`);

const files = readdirSync(dir);
const assetName = (f) => f.replace(/ /g, '.');
const url = (f) => `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(assetName(f))}`;


// macOS の .app.tar.gz は名前に版が入らないので，中の Info.plist の
// CFBundleShortVersionString で版を確かめる (前の版の tarball が残っていると，
// Mac の人は「新しい版」を入れても前の版のままになり，更新の知らせが止まらなくなる)．
// tar は Windows 10 以降と macOS に入っている．GNU tar は "C:\..." をホスト名と読むので，
// 作業フォルダを dir にしてファイル名だけを渡す．
function macBundleVersion(f) {
  const run = (args) => execFileSync('tar', args, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let list;
  try {
    list = run(['-tzf', f]);
  } catch (e) {
    die(`macOS (.app.tar.gz) の中を読めません: ${f} (${e.message})`);
  }
  const entry = list.split(/\r?\n/).find((l) => /\.app\/Contents\/Info\.plist$/.test(l));
  if (!entry) die(`macOS (.app.tar.gz) に Contents/Info.plist がありません: ${f}`);
  const plist = run(['-xzOf', f, entry]);
  const m = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  if (!m) die(`Info.plist に CFBundleShortVersionString がありません: ${f}`);
  return m[1].trim();
}
function pick(test, label, required) {
  const hits = files.filter((f) => test(f) && !f.endsWith('.sig'));
  if (hits.length === 0) {
    if (required) die(`${label} が見つかりません (${dir})`);
    return null;
  }
  if (hits.length > 1) die(`${label} が 2 つ以上あります: ${hits.join(', ')}`);
  const f = hits[0];
  if (!f.includes(version) && !f.endsWith('.app.tar.gz')) die(`${label} の版が違います: ${f} (期待 ${version})`);
  const sigPath = join(dir, `${f}.sig`);
  if (!existsSync(sigPath)) die(`${label} の署名がありません: ${f}.sig`);
  return { signature: readFileSync(sigPath, 'utf8').trim(), url: url(f), file: f };
}

const nsis = pick((f) => f.endsWith('-setup.exe'), 'Windows NSIS (.exe)', true);
const msi = pick((f) => f.endsWith('.msi'), 'Windows MSI (.msi)', false);
const mac = pick((f) => f.endsWith('.app.tar.gz'), 'macOS (.app.tar.gz)', false);
if (mac) {
  const v = macBundleVersion(mac.file);
  if (v !== version) die(`macOS (.app.tar.gz) の版が違います: 中身は ${v} (期待 ${version})．前の版の tarball が残っていないか確かめてください`);
}

const strip = (p) => p && { signature: p.signature, url: p.url };
const platforms = {
  'windows-x86_64': strip(nsis),
  'windows-x86_64-nsis': strip(nsis),
};
if (msi) platforms['windows-x86_64-msi'] = strip(msi);
if (mac) {
  platforms['darwin-aarch64'] = strip(mac);
  platforms['darwin-x86_64'] = strip(mac);
}

const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : `Affinity Mapping Studio v${version}`;
const out = { version, notes, pub_date: new Date().toISOString(), platforms };
const outPath = join(dir, 'latest.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`[make-latest-json] 書きました: ${outPath}`);
console.log(`  対象: ${Object.keys(platforms).join(', ')}`);
if (!msi) console.warn('  注意: MSI が無いので，MSI で入れた人は windows-x86_64 (NSIS) で更新されます．');
if (!mac) console.warn('  注意: macOS が無いので，Mac の人には自動の更新が届きません．');
