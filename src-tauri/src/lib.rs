// Phase 5b — Tauri command surface.
//
// Modules:
//   - docx          : analyze_docx (mammoth + extractCommentRanges replacement)
//   - sheet         : parse_csv / parse_xlsx (sheetjs replacement)
//   - project_io    : .kjproj ZIP read/write + atomic write + multi-gen backups
//   - file_dialog   : open/save dialog wrappers over tauri-plugin-dialog
//   - diag          : 終了経路・レンダラー診断ログのディスク追記
// (docx_writer は 5c で JS docx 生成 + write_bytes 方式を採用したため退役)

mod diag;
mod docx;
mod file_dialog;
mod project_io;
mod sheet;
mod text_io;

use docx::DocxAnalysis;
use file_dialog::DialogFilter;
use project_io::ProjectPayload;
use sheet::SheetData;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

/// 通常の終了経路が固まった時に備えた強制終了までの猶予．
const QUIT_WATCHDOG: Duration = Duration::from_secs(5);
/// 終了時に保存の完了を待つ上限．
const QUIT_SAVE_WAIT: Duration = Duration::from_secs(5);

/// 終了要求済みか (ウォッチドッグの多重起動と二重終了要求を抑止する)．
static QUITTING: AtomicBool = AtomicBool::new(false);

/// 終了の最終防衛線を張る．
///
/// 2026-08-16 調査: 最後のウィンドウが破棄された後に teardown が固まり，
/// ウィンドウを 1 つも持たない (USER/GDI オブジェクト 0) まま WebView2 だけが
/// 生き残ったプロセスを実機で観測した (metis・8 日間残存)．アプリ側に終了の
/// 保証が無いと，上流 (tao / wry / WebView2) の teardown が固まった時に
/// 復帰手段が無くタスクマネージャ送りになる．猶予を過ぎたら問答無用で落とす．
fn arm_exit_watchdog() {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return; // 既に武装済み
    }
    std::thread::spawn(|| {
        std::thread::sleep(QUIT_WATCHDOG);
        // ここに到達する = 通常の終了経路が猶予内に終わらなかった．
        std::process::exit(0);
    });
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!(
        "Hello from Rust (affinity-mapping-tauri v{})! Greetings, {}.",
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

// Write raw bytes to a path (e.g. a Word .docx generated in the renderer by the
// `docx` JS library — the renderer can't touch the filesystem directly).
// async so it runs off the main thread for larger payloads.
// 2026-07 レビュー W5: tmp → fsync → rename の atomic 書込みに変更
// (クラッシュ時に途中までの壊れたファイルを残さない)．
#[tauri::command]
async fn write_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    project_io::write_bytes_atomic(&path, &contents)
}

// async so Tauri runs these off the main thread — see file_dialog.rs for why
// (macOS native dialog deadlocks if the main thread is blocked waiting for it).
#[tauri::command]
async fn pick_open_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    file_dialog::pick_open_file(app, title, filters).await
}

#[tauri::command]
async fn pick_save_file<R: Runtime>(
    app: AppHandle<R>,
    title: Option<String>,
    default_file_name: Option<String>,
    filters: Option<Vec<DialogFilter>>,
) -> Result<Option<String>, String> {
    file_dialog::pick_save_file(app, title, default_file_name, filters).await
}

/// レンダラーからの明示的な終了要求．
///
/// 2026-08-16 の根本原因: JS 側の閉じ手段だった `getCurrentWindow().destroy()` は
/// capability (`core:window:allow-destroy`) に依存し，権限が無いと ACL に拒否されて
/// 例外になる．一方 Tauri は close-requested に JS リスナーが居ると OS からの
/// close を必ず prevent するため，JS が閉じられない = 二度と閉じられない窓になる
/// (未保存の有無・共同編集接続の有無に関係なく発生した)．
/// アプリ自身の command は ACL の対象外なので，終了経路はこちらへ一本化する．
///
/// async にしているのは，保存待ちでメインスレッド (UI) を止めないため．
#[tauri::command]
async fn quit_app<R: Runtime>(app: AppHandle<R>) {
    let saved = project_io::wait_for_idle_write(QUIT_SAVE_WAIT);
    diag::log_event(&app, &format!("quit_app requested (write_idle={saved})"));
    arm_exit_watchdog();
    app.exit(0);
}

/// レンダラーの診断ログをディスクへ落とす (errorBuffer.ts から呼ぶ)．
#[tauri::command]
fn append_log<R: Runtime>(app: AppHandle<R>, line: String) -> Result<(), String> {
    diag::append_log(&app, &line)
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
            read_text_file,
            read_kjproj,
            write_kjproj,
            write_bytes,
            pick_open_file,
            pick_save_file,
            quit_app,
            append_log,
        ])
        .on_window_event(|window, event| {
            // メインウィンドウが破棄されたらアプリを終了する．
            // 原文ビューアだけが残ってもユーザーからは「閉じたのに終わらない」に
            // 見えるため，main の破棄をアプリ終了の合図として扱う．
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let others = app
                    .webview_windows()
                    .keys()
                    .filter(|label| label.as_str() != window.label())
                    .count();
                if window.label() == "main" || others == 0 {
                    diag::log_event(
                        app,
                        &format!("window '{}' destroyed -> exiting", window.label()),
                    );
                    arm_exit_watchdog();
                    app.exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // tauri の cleanup_before_exit や wry/WebView2 の teardown が固まっても
            // ここで確実にプロセスを終わらせる (窓ゼロのゾンビを作らない)．
            // 保存中なら書込み完了だけ待ってから落とす．
            if let tauri::RunEvent::Exit = event {
                project_io::wait_for_idle_write(QUIT_SAVE_WAIT);
                std::process::exit(0);
            }
        });
}
