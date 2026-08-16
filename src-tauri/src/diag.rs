// 診断ログ (2026-08-16 の「ウィンドウが閉じない / プロセスが残る」調査で必要性が判明)．
//
// 旧実装の診断はレンダラー内の errorBuffer.ts (メモリ 100 件) だけで，アプリが
// 閉じられないまま放置されたプロセスからは何も取り出せなかった．窓が破棄された
// 引き金すら事後復元できなかったため，終了経路まわりの出来事だけでもディスクへ
// 残す．app_log_dir/app.log へ 1 行追記するだけの薄い実装に留める．

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

/// ログ上限．超えたら app.log.1 へ 1 世代だけ退避する．
const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// レンダラー / Rust 双方から使う行追記．失敗しても呼び出し側は続行してよい．
pub fn append_log<R: Runtime>(app: &AppHandle<R>, line: &str) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("app.log");
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = fs::rename(&path, dir.join("app.log.1"));
        }
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    // 改行が混ざると 1 行 1 イベントの前提が崩れるので潰す．
    let sanitized = line.replace('\r', " ").replace('\n', " ");
    // 2026-08-16: writeln! は本文と改行を別の write に分けるため，レンダラーと Rust が
    // 同時に書くと "行A行B" + 改行 2 つのように連結される (実際に発生した)．改行込みの
    // 1 バッファを 1 回の write_all で書き，追記の原子性を保つ．
    let mut buf = sanitized.into_bytes();
    buf.push(b'\n');
    f.write_all(&buf).map_err(|e| e.to_string())
}

/// Rust 側イベント用．時刻はレンダラーに依存しないよう epoch 秒で入れる．
pub fn log_event<R: Runtime>(app: &AppHandle<R>, msg: &str) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = append_log(app, &format!("epoch={secs} [rust] {msg}"));
}
