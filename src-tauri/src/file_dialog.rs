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

pub fn pick_open_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
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
    let picked = builder.blocking_pick_file();
    Ok(picked.and_then(file_path_to_string))
}

pub fn pick_save_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    default_file_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
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
    let picked = builder.blocking_save_file();
    Ok(picked.and_then(file_path_to_string))
}

fn file_path_to_string(p: FilePath) -> Option<String> {
    // FilePath in tauri-plugin-dialog 2.x can be a Path or a URL (mobile).
    // For desktop we always want a filesystem path string.
    match p {
        FilePath::Path(path) => Some(path.to_string_lossy().into_owned()),
        FilePath::Url(url) => Some(url.to_string()),
    }
}
