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
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

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
        let mut buf = String::new();
        entry
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
    let tmp = parent.join(format!(".{stem}.tmp"));
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

    // 2) rotate existing backups + move current to .bak.1 + daily snapshot
    if target.exists() {
        rotate_bak_files(parent, stem, ext)?;
        let bak1 = backup_path(parent, stem, ext, 1);
        fs::rename(target, &bak1).map_err(|e| format!("rename current -> .bak.1: {e}"))?;
        write_daily_backup(&bak1, parent, stem, ext)?;
        prune_daily_backups(parent, stem, ext, 7)?;
    }

    // 3) rename tmp -> target (atomic on the same filesystem)
    fs::rename(&tmp, target).map_err(|e| format!("rename tmp -> target: {e}"))?;
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
