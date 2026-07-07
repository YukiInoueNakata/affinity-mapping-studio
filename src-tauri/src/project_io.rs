// Phase 5b: .kjproj ZIP I/O with atomic writes + multi-generation backups.
//
// Mirrors the Electron implementation in
// kj-trace-studio/src/main/persistence/projectIO.ts.
//
// On-disk format:
//   <name>.kjproj is a ZIP containing
//     metadata.json     (parsed as serde_json::Value; schema_version etc.)
//     data/<table>.json (one file per table, e.g. cards.json, segments.json)
//
// Write strategy:
//   1. Serialize to <dir>/.<stem>.tmp
//   2. fsync, then close
//   3. If <name>.kjproj already exists:
//        - rotate .bak.9 -> .bak.10, ..., .bak.1 -> .bak.2
//        - move current file to .bak.1
//        - copy .bak.1 to .daily.YYYY-MM-DD if not already present
//        - prune daily backups to most recent 7
//   4. rename tmp -> <name>.kjproj (atomic on the same filesystem)
//
// NOTE: this file is unverified on the current PC (no Rust toolchain installed).
// Run `cargo check` on a PC with rustup before relying on it.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// 保存の直列化ロック (2026-07 レビュー Critical A2)．
/// 手動保存 (Ctrl+S 連打) と自動保存が同時に走ると，同一 tmp への二重書込みで
/// 壊れた ZIP が本体へ rename され得る．Tauri は sync コマンドを blocking pool の
/// 別スレッドで並行実行するため，プロセス内 Mutex で write_kjproj を直列化する．
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// tmp ファイル名の一意化カウンタ (直列化に加えた防御第 2 層)．
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// ZIP エントリ 1 件あたりの展開サイズ上限 (zip-bomb / 破損ファイル対策)．
const MAX_ZIP_ENTRY_BYTES: u64 = 200 * 1024 * 1024; // 200 MB

#[derive(Serialize, Deserialize)]
pub struct ProjectPayload {
    /// metadata.json contents (parsed JSON value).
    pub metadata: serde_json::Value,
    /// Table name (without ".json") -> parsed JSON value.
    /// BTreeMap so output order is stable across saves.
    pub data: BTreeMap<String, serde_json::Value>,
    /// Any other JSON entries in the archive — keyed by full archive path
    /// (e.g. "snapshots/index.json" or "snapshots/<id>.json").  This keeps
    /// snapshots and future namespaces alive through a round-trip even though
    /// Rust doesn't know their semantics.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extras: BTreeMap<String, serde_json::Value>,
}

pub fn read_kjproj(path: &str) -> Result<ProjectPayload, String> {
    let file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("zip open: {e}"))?;

    let mut metadata: Option<serde_json::Value> = None;
    let mut data: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    let mut extras: BTreeMap<String, serde_json::Value> = BTreeMap::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("zip entry #{i}: {e}"))?;
        let name = entry.name().to_string();
        // Skip directories.
        if name.ends_with('/') {
            continue;
        }
        // zip-bomb / 破損対策: 宣言された展開サイズが上限を超えるエントリは
        // 読み込まずに明示エラーにする (無制限の read_to_string で OOM しない)．
        if entry.size() > MAX_ZIP_ENTRY_BYTES {
            return Err(format!(
                "zip entry {name} is too large ({} bytes > {} bytes limit)",
                entry.size(),
                MAX_ZIP_ENTRY_BYTES
            ));
        }
        let mut buf = String::new();
        entry
            .by_ref()
            .take(MAX_ZIP_ENTRY_BYTES)
            .read_to_string(&mut buf)
            .map_err(|e| format!("read {name}: {e}"))?;

        if name == "metadata.json" {
            metadata = Some(
                serde_json::from_str(&buf).map_err(|e| format!("metadata json: {e}"))?,
            );
        } else if let Some(stem) = name
            .strip_prefix("data/")
            .and_then(|n| n.strip_suffix(".json"))
        {
            let v: serde_json::Value =
                serde_json::from_str(&buf).map_err(|e| format!("data/{stem}.json: {e}"))?;
            data.insert(stem.to_string(), v);
        } else if name.ends_with(".json") {
            // snapshots/, future namespaces — preserve as-is so round-trip is
            // lossless.
            let v: serde_json::Value =
                serde_json::from_str(&buf).map_err(|e| format!("{name}: {e}"))?;
            extras.insert(name, v);
        }
        // Silently skip non-.json entries (none expected in current schema).
    }

    let metadata = metadata.ok_or_else(|| "metadata.json missing in .kjproj".to_string())?;
    Ok(ProjectPayload {
        metadata,
        data,
        extras,
    })
}

pub fn write_kjproj(path: &str, payload: &ProjectPayload) -> Result<(), String> {
    // 保存全体を直列化 (自動保存と手動保存の同時実行による ZIP 破損防止)．
    // Mutex poisoning (前の保存スレッドが panic) は into_inner 相当で握り潰さず，
    // ロック自体は継続利用できるようにする．
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| format!("invalid path: {path}"))?;
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("no file stem in: {path}"))?;
    let ext = target
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("kjproj");

    // 1) write to tmp file in same directory (so rename is atomic on the same fs)
    //    tmp 名は pid + カウンタで一意化 (多重プロセス / 万一の並行書込みでも
    //    互いの tmp を truncate しない — 防御第 2 層)．
    let tmp = parent.join(format!(
        ".{stem}.{}-{}.tmp",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    {
        let file = File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        let mut zip = ZipWriter::new(file);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file("metadata.json", opts)
            .map_err(|e| format!("zip start metadata: {e}"))?;
        let metadata_bytes = serde_json::to_vec_pretty(&payload.metadata)
            .map_err(|e| format!("metadata serialize: {e}"))?;
        zip.write_all(&metadata_bytes)
            .map_err(|e| format!("metadata write: {e}"))?;

        for (table, value) in &payload.data {
            let entry_name = format!("data/{table}.json");
            zip.start_file(&entry_name, opts)
                .map_err(|e| format!("zip start {entry_name}: {e}"))?;
            let bytes =
                serde_json::to_vec_pretty(value).map_err(|e| format!("{table} serialize: {e}"))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("{table} write: {e}"))?;
        }

        // Pass-through extras (snapshots, future namespaces) unchanged.
        for (entry_name, value) in &payload.extras {
            zip.start_file(entry_name.as_str(), opts)
                .map_err(|e| format!("zip start {entry_name}: {e}"))?;
            let bytes = serde_json::to_vec_pretty(value)
                .map_err(|e| format!("{entry_name} serialize: {e}"))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("{entry_name} write: {e}"))?;
        }

        let finished = zip.finish().map_err(|e| format!("zip finish: {e}"))?;
        finished.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }

    // 2) rotate existing backups + move current to .bak.1
    //
    // 2026-07 レビュー Critical A3: 「target を .bak.1 へ退避」から「tmp を
    // target へ rename」までの間に失敗し得る処理を挟まない．旧実装はこの間に
    // daily バックアップ作成 (fs::copy — ディスクフルで失敗しやすい) を置いて
    // いたため，失敗するとプロジェクトファイルが定位置から消えたまま Err を
    // 返していた．daily 処理は本体 rename 完了後の best-effort に移す．
    let had_existing = target.exists();
    if had_existing {
        rotate_bak_files(parent, stem, ext)?;
        let bak1 = backup_path(parent, stem, ext, 1);
        fs::rename(target, &bak1).map_err(|e| format!("rename current -> .bak.1: {e}"))?;
    }

    // 3) rename tmp -> target (atomic on the same filesystem)
    if let Err(e) = fs::rename(&tmp, target) {
        // 失敗時は退避した .bak.1 を定位置へ戻して原状復帰を試みる
        // (戻せなくてもデータは .bak.1 と tmp に残る)．
        if had_existing {
            let bak1 = backup_path(parent, stem, ext, 1);
            let _ = fs::rename(&bak1, target);
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!("rename tmp -> target: {e}"));
    }

    // 4) daily バックアップ + 世代整理は本体保存の完了後に best-effort で行う．
    //    (失敗しても保存自体は成功しているので警告ログのみ)
    if had_existing {
        let bak1 = backup_path(parent, stem, ext, 1);
        if let Err(e) = write_daily_backup(&bak1, parent, stem, ext) {
            eprintln!("[project_io] daily backup failed (non-fatal): {e}");
        }
        if let Err(e) = prune_daily_backups(parent, stem, ext, 7) {
            eprintln!("[project_io] daily prune failed (non-fatal): {e}");
        }
    }
    Ok(())
}

/// 任意バイト列の atomic 書込み (tmp → fsync → rename)．
/// Word エクスポート等，renderer が生成したバイナリの保存に使う
/// (2026-07 レビュー W5: 旧 write_bytes は直接書込みで，クラッシュ時に
/// 途中までの壊れたファイルが残った)．
pub fn write_bytes_atomic(path: &str, contents: &[u8]) -> Result<(), String> {
    let target = Path::new(path);
    let parent = target
        .parent()
        .ok_or_else(|| format!("invalid path: {path}"))?;
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("out");
    let tmp = parent.join(format!(
        ".{stem}.{}-{}.tmp",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    {
        let mut f = File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
        f.write_all(contents).map_err(|e| format!("write: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync: {e}"))?;
    }
    // Windows では既存ファイルへの rename が失敗するため，先に退避する．
    let bak = parent.join(format!(".{stem}.replaced.bak"));
    let had_existing = target.exists();
    if had_existing {
        let _ = fs::remove_file(&bak);
        fs::rename(target, &bak).map_err(|e| format!("rename current -> bak: {e}"))?;
    }
    if let Err(e) = fs::rename(&tmp, target) {
        if had_existing {
            let _ = fs::rename(&bak, target);
        }
        let _ = fs::remove_file(&tmp);
        return Err(format!("rename tmp -> target: {e}"));
    }
    if had_existing {
        let _ = fs::remove_file(&bak);
    }
    Ok(())
}

fn backup_path(dir: &Path, stem: &str, ext: &str, n: u32) -> PathBuf {
    dir.join(format!("{stem}.{ext}.bak.{n}"))
}

fn rotate_bak_files(dir: &Path, stem: &str, ext: &str) -> Result<(), String> {
    // .bak.10 (oldest) is dropped if it exists; then 9 -> 10, 8 -> 9, ..., 1 -> 2.
    let oldest = backup_path(dir, stem, ext, 10);
    if oldest.exists() {
        let _ = fs::remove_file(&oldest);
    }
    for n in (1..=9).rev() {
        let from = backup_path(dir, stem, ext, n);
        let to = backup_path(dir, stem, ext, n + 1);
        if from.exists() {
            fs::rename(&from, &to).map_err(|e| format!("rotate {n}->{}: {e}", n + 1))?;
        }
    }
    Ok(())
}

fn write_daily_backup(src: &Path, dir: &Path, stem: &str, ext: &str) -> Result<(), String> {
    let today = current_date_string();
    let daily = dir.join(format!("{stem}.{ext}.daily.{today}"));
    if !daily.exists() {
        fs::copy(src, &daily).map_err(|e| format!("daily copy: {e}"))?;
    }
    Ok(())
}

fn prune_daily_backups(dir: &Path, stem: &str, ext: &str, keep: usize) -> Result<(), String> {
    let prefix = format!("{stem}.{ext}.daily.");
    let entries = fs::read_dir(dir).map_err(|e| format!("readdir: {e}"))?;
    let mut dailies: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect();
    // Sort by filename (which encodes ISO-8601 date — lexicographic == chronological).
    dailies.sort();
    if dailies.len() > keep {
        for old in &dailies[..dailies.len() - keep] {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}

fn current_date_string() -> String {
    // UTC date in ISO-8601 (YYYY-MM-DD).  Hand-rolled to avoid a chrono
    // dependency for one function — Hinnant's days-from-civil algorithm.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs / 86_400;
    let (y, m, d) = days_to_ymd(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn days_to_ymd(days_since_epoch: i64) -> (i32, u32, u32) {
    // Howard Hinnant, "date" algorithms — days_from_civil inverse.
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}
