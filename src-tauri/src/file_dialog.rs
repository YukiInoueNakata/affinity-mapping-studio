// Phase 5b: thin wrappers around tauri-plugin-dialog so the renderer can call
// `invoke('pick_open_file', ...)` / `invoke('pick_save_file', ...)` with the
// same shape as Electron's window.api.openDialog() / saveDialog() pair.
//
// macOS の固まり問題 (v0.2.0 でも再発) 対応: spawn_blocking + blocking_pick_file
// は信頼できないため，tauri-plugin-dialog の **非ブロッキング callback API**
// (`builder.pick_file(move |path| { ... })`) を使い，tokio::sync::oneshot で結果を
// async command に運ぶ．これがプラグイン設計が想定する正規パターンであり，
// メインスレッド ↔ 内部ディスパッチの相互作用に依存しない．

use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

#[derive(Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

pub async fn pick_open_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();
    let mut builder = app.dialog().file();
    if let Some(t) = title.as_deref() {
        builder = builder.set_title(t);
    }
    if let Some(fs) = filters.as_ref() {
        for f in fs {
            let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(&f.name, &exts);
        }
    }
    // 非ブロッキング: コールバックは選択完了時にプラグイン側のスレッドから呼ばれる．
    builder.pick_file(move |path| {
        // 受信側が drop されていても無視 (キャンセル時の競合に強い)．
        let _ = tx.send(path);
    });
    let picked = rx
        .await
        .map_err(|e| format!("dialog channel closed: {e}"))?;
    Ok(picked.and_then(file_path_to_string))
}

pub async fn pick_save_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    default_file_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();
    let mut builder = app.dialog().file();
    if let Some(t) = title.as_deref() {
        builder = builder.set_title(t);
    }
    if let Some(name) = default_file_name.as_deref() {
        builder = builder.set_file_name(name);
    }
    if let Some(fs) = filters.as_ref() {
        for f in fs {
            let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(&f.name, &exts);
        }
    }
    builder.save_file(move |path| {
        let _ = tx.send(path);
    });
    let picked = rx
        .await
        .map_err(|e| format!("dialog channel closed: {e}"))?;
    Ok(picked.and_then(file_path_to_string))
}

fn file_path_to_string(p: FilePath) -> Option<String> {
    match p {
        FilePath::Path(path) => Some(path.to_string_lossy().into_owned()),
        FilePath::Url(url) => Some(url.to_string()),
    }
}
