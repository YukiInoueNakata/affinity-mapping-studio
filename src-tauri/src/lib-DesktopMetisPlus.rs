// Phase 5b — Rust-side analyzers (port from kj-trace-tauri-poc).

pub mod docx;
pub mod docx_writer;
pub mod sheet;

#[tauri::command]
fn greet(name: &str) -> String {
    format!(
        "Hello from Rust (kj-trace-tauri v{})! Greetings, {}.",
        env!("CARGO_PKG_VERSION"),
        name
    )
}

/// Mammoth replacement: parse a .docx and return text + comments + range info.
#[tauri::command]
fn analyze_docx(path: String) -> Result<docx::DocxAnalysis, String> {
    docx::analyze_docx(&path)
}

/// SheetJS replacement: parse a .csv (auto-detects BOM / Shift_JIS).
#[tauri::command]
fn parse_csv(path: String) -> Result<sheet::SheetData, String> {
    sheet::parse_csv(&path)
}

/// SheetJS replacement: parse a .xlsx into rows[][].
#[tauri::command]
fn parse_xlsx(path: String) -> Result<sheet::SheetData, String> {
    sheet::parse_xlsx(&path)
}

/// Read a plain UTF-8 text file (with BOM stripping).  Used for .txt / .md.
#[tauri::command]
fn read_plain_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read error: {e}"))?;
    let text = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&bytes[3..]).into_owned()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };
    Ok(text)
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
            read_plain_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
