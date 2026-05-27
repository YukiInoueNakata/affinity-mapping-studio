// Phase 5b — Tauri command surface.
//
// Modules:
//   - docx          : analyze_docx (mammoth + extractCommentRanges replacement)
//   - sheet         : parse_csv / parse_xlsx (sheetjs replacement)
//   - docx_writer   : Word export probe (full export comes in 5c)
//   - project_io    : .kjproj ZIP read/write + atomic write + multi-gen backups
//   - file_dialog   : open/save dialog wrappers over tauri-plugin-dialog

mod docx;
mod docx_writer;
mod file_dialog;
mod project_io;
mod sheet;
mod text_io;

use docx::DocxAnalysis;
use file_dialog::DialogFilter;
use project_io::ProjectPayload;
use sheet::SheetData;
use tauri::{AppHandle, Runtime};

#[tauri::command]
fn greet(name: &str) -> String {
    format!(
        "Hello from Rust (kj-trace-tauri v{})! Greetings, {}.",
        env!("CARGO_PKG_VERSION"),
        name
    )
}

#[tauri::command]
fn analyze_docx(path: String) -> Result<DocxAnalysis, String> {
    docx::analyze_docx(&path)
}

#[tauri::command]
fn parse_csv(path: String) -> Result<SheetData, String> {
    sheet::parse_csv(&path)
}

#[tauri::command]
fn parse_xlsx(path: String) -> Result<SheetData, String> {
    sheet::parse_xlsx(&path)
}

#[tauri::command]
fn export_docx_sample(
    title: String,
    body_lines: Vec<String>,
    out_path: String,
) -> Result<(), String> {
    let refs: Vec<&str> = body_lines.iter().map(String::as_str).collect();
    docx_writer::build_sample_docx(&title, &refs, &out_path)
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    text_io::read_text_file(&path)
}

#[tauri::command]
fn read_kjproj(path: String) -> Result<ProjectPayload, String> {
    project_io::read_kjproj(&path)
}

#[tauri::command]
fn write_kjproj(path: String, payload: ProjectPayload) -> Result<(), String> {
    project_io::write_kjproj(&path, &payload)
}

#[tauri::command]
fn pick_open_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    file_dialog::pick_open_file(app, title, filters)
}

#[tauri::command]
fn pick_save_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    default_file_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    file_dialog::pick_save_file(app, title, default_file_name, filters)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            analyze_docx,
            parse_csv,
            parse_xlsx,
            export_docx_sample,
            read_text_file,
            read_kjproj,
            write_kjproj,
            pick_open_file,
            pick_save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
