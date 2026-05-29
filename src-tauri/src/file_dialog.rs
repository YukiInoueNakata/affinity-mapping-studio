// Phase 5b: thin wrappers around tauri-plugin-dialog so the renderer can call
// `invoke('pick_open_file', ...)` / `invoke('pick_save_file', ...)` with the
// same shape as Electron's window.api.openDialog() / saveDialog() pair.
//
// NOTE: this file is unverified on the current PC (no Rust toolchain
// installed).  Run `cargo check` on a PC with rustup before relying on it —
// in particular, confirm the tauri-plugin-dialog 2.x API shape, since the
// builder method names changed between 2.0 betas.

use serde::Deserialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Deserialize)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

// IMPORTANT (macOS): `blocking_pick_file` / `blocking_save_file` must NOT run
// on the main thread.  On macOS the native dialog is presented by the main
// thread's run loop, so blocking the main thread while waiting for the dialog
// result deadlocks (the app shows the spinning-beachball and never recovers).
// Tauri runs SYNC commands on the main thread and ASYNC commands on the async
// runtime, so these are `async` and we push the blocking call onto the blocking
// thread pool via `spawn_blocking`.  Windows tolerated the old sync version,
// which is why the freeze only appeared on the Mac build.
pub async fn pick_open_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
        builder.blocking_pick_file().and_then(file_path_to_string)
    })
    .await
    .map_err(|e| format!("dialog task failed: {e}"))
}

pub async fn pick_save_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    default_file_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
        builder.blocking_save_file().and_then(file_path_to_string)
    })
    .await
    .map_err(|e| format!("dialog task failed: {e}"))
}

fn file_path_to_string(p: FilePath) -> Option<String> {
    // FilePath in tauri-plugin-dialog 2.x can be a Path or a URL (mobile).
    // For desktop we always want a filesystem path string.
    match p {
        FilePath::Path(path) => Some(path.to_string_lossy().into_owned()),
        FilePath::Url(url) => Some(url.to_string()),
    }
}
