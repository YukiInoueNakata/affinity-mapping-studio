// Phase 5e: minimal UTF-8 text file reader for the renderer's
// `readTextFile` shim (handles .txt / .md branch).
//
// CSV / XLSX / DOCX go through parse_csv / parse_xlsx / analyze_docx
// instead — those commands return richer structures.

pub fn read_text_file(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    // Drop UTF-8 BOM if present (Notepad often writes one).
    let slice: &[u8] = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };
    match std::str::from_utf8(slice) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => {
            // Fall back to Shift_JIS for legacy Japanese files.
            let (cow, _, _) = encoding_rs::SHIFT_JIS.decode(slice);
            Ok(cow.into_owned())
        }
    }
}
