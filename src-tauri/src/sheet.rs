// Phase 4c-2: csv / xlsx parsing (sheetjs replacement).
//
// Output mirrors the JS implementation's ReadTextFileResult.rows: a 2D vector
// of stringified cells.  Headers, type coercion, and column-mapping all live
// in the frontend just like today.

use serde::Serialize;

#[derive(Serialize)]
pub struct SheetData {
    pub rows: Vec<Vec<String>>,
    pub sheet_name: Option<String>,
}

pub fn parse_csv(path: &str) -> Result<SheetData, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read error: {e}"))?;
    // Strip UTF-8 BOM if present (Excel-exported CSVs often have one).
    let text = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&bytes[3..]).into_owned()
    } else {
        // Try UTF-8 first; fall back to Shift_JIS for legacy files.
        match std::str::from_utf8(&bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                let (cow, _, _) = encoding_rs::SHIFT_JIS.decode(&bytes);
                cow.into_owned()
            }
        }
    };
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut rows: Vec<Vec<String>> = Vec::new();
    for record in reader.records() {
        let r = record.map_err(|e| format!("csv parse: {e}"))?;
        rows.push(r.iter().map(|s| s.to_string()).collect());
    }
    Ok(SheetData {
        rows,
        sheet_name: None,
    })
}

pub fn parse_xlsx(path: &str) -> Result<SheetData, String> {
    use calamine::{open_workbook_auto, Reader};
    let mut workbook = open_workbook_auto(path).map_err(|e| format!("xlsx open: {e}"))?;
    let sheet_names = workbook.sheet_names();
    let first = sheet_names
        .into_iter()
        .next()
        .ok_or_else(|| "no sheets in workbook".to_string())?;
    let range = workbook
        .worksheet_range(&first)
        .map_err(|e| format!("xlsx range: {e}"))?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    for row in range.rows() {
        let cells = row
            .iter()
            .map(|c| match c {
                calamine::Data::Empty => String::new(),
                calamine::Data::String(s) => s.clone(),
                calamine::Data::Float(f) => {
                    if f.fract() == 0.0 {
                        format!("{}", *f as i64)
                    } else {
                        format!("{}", f)
                    }
                }
                calamine::Data::Int(i) => i.to_string(),
                calamine::Data::Bool(b) => b.to_string(),
                calamine::Data::DateTime(d) => d.to_string(),
                calamine::Data::DurationIso(s) => s.clone(),
                calamine::Data::DateTimeIso(s) => s.clone(),
                calamine::Data::Error(e) => format!("#ERR:{:?}", e),
            })
            .collect();
        rows.push(cells);
    }
    Ok(SheetData {
        rows,
        sheet_name: Some(first),
    })
}
