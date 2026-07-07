// Phase 4c-2: Rust port of the Electron/Node mammoth + extractCommentRanges
// pipeline (see kj-trace-server/src/main/ipc/handlers.ts).
//
// Strategy: load the .docx as a ZIP, pull `word/document.xml` and
// `word/comments.xml`, and use simple regex-based extraction — same approach
// as the existing JS implementation.  This keeps the binary footprint tiny
// (we avoid heavyweight Office crates) and matches the proven JS output.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

#[derive(Serialize)]
pub struct DocxAnalysis {
    pub text: String,
    pub comments: Vec<WordComment>,
}

#[derive(Serialize, Clone)]
pub struct WordComment {
    pub id: String,
    pub author: Option<String>,
    pub text: String,
    #[serde(rename = "commentedText", skip_serializing_if = "Option::is_none")]
    pub commented_text: Option<String>,
    #[serde(rename = "paragraphText", skip_serializing_if = "Option::is_none")]
    pub paragraph_text: Option<String>,
}

#[derive(Clone)]
struct RangeInfo {
    commented_text: String,
    paragraph_text: String,
}

/// Entry point called from a Tauri command.
pub fn analyze_docx(path: &str) -> Result<DocxAnalysis, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read error: {e}"))?;
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| format!("zip error: {e}"))?;

    let document_xml = read_zip_entry(&mut archive, "word/document.xml")
        .ok_or_else(|| "word/document.xml not found".to_string())?;
    let comments_xml = read_zip_entry(&mut archive, "word/comments.xml");

    // mammoth equivalent: concatenate <w:t> text in document order, treating
    // paragraph ends as newlines (mammoth uses "\n" between paragraphs).
    let text = extract_paragraphs_text(&document_xml);

    let comments = if let Some(cx) = comments_xml {
        let parsed = parse_comments_xml(&cx);
        let ranges = extract_comment_ranges(&document_xml);
        parsed
            .into_iter()
            .map(|mut c| {
                if let Some(r) = ranges.get(&c.id) {
                    if !r.commented_text.is_empty() {
                        c.commented_text = Some(r.commented_text.clone());
                    }
                    if !r.paragraph_text.is_empty() {
                        c.paragraph_text = Some(r.paragraph_text.clone());
                    }
                }
                c
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(DocxAnalysis { text, comments })
}

// zip-bomb / 破損 .docx 対策の展開サイズ上限 (project_io と同方針)．
const MAX_DOCX_ENTRY_BYTES: u64 = 200 * 1024 * 1024; // 200 MB

fn read_zip_entry(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    name: &str,
) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > MAX_DOCX_ENTRY_BYTES {
        return None;
    }
    let mut buf = String::new();
    entry
        .by_ref()
        .take(MAX_DOCX_ENTRY_BYTES)
        .read_to_string(&mut buf)
        .ok()?;
    Some(buf)
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn extract_paragraphs_text(xml: &str) -> String {
    // Re-implementation of `mammoth.extractRawText`: walk <w:p> ... </w:p>
    // blocks; inside each paragraph, concatenate every <w:t> run.  Output
    // paragraphs are joined with double newlines, matching mammoth's default.
    let paragraph_re = regex::Regex::new(r"(?s)<w:p\b[^>]*>(.*?)</w:p>").unwrap();
    let mut paragraphs = Vec::new();
    for cap in paragraph_re.captures_iter(xml) {
        paragraphs.push(extract_run_text(&cap[1]));
    }
    paragraphs.join("\n\n")
}

fn extract_run_text(xml_slice: &str) -> String {
    // Same as the JS extractRunText: pick up <w:t>, <w:br/>, </w:p>.
    let token_re = regex::Regex::new(
        r"(?s)<w:t\b[^>]*>(.*?)</w:t>|<w:br\b[^>]*/>|</w:p>",
    )
    .unwrap();
    let mut parts = Vec::new();
    for cap in token_re.captures_iter(xml_slice) {
        if let Some(t) = cap.get(1) {
            parts.push(decode_xml_entities(t.as_str()));
        } else {
            parts.push("\n".to_string());
        }
    }
    let joined = parts.join("");
    // Collapse runs of 2+ newlines back to 1 (same as JS implementation).
    let collapse = regex::Regex::new(r"\n{2,}").unwrap();
    collapse.replace_all(&joined, "\n").trim().to_string()
}

fn parse_comments_xml(xml: &str) -> Vec<WordComment> {
    let block_re = regex::Regex::new(
        r"(?s)<w:comment\b([^>]*)>(.*?)</w:comment>",
    )
    .unwrap();
    let id_re = regex::Regex::new(r#"w:id="([^"]+)""#).unwrap();
    let author_re = regex::Regex::new(r#"w:author="([^"]+)""#).unwrap();
    let t_re = regex::Regex::new(r"(?s)<w:t\b[^>]*>(.*?)</w:t>").unwrap();

    let mut out = Vec::new();
    let mut counter = 0;
    for cap in block_re.captures_iter(xml) {
        let attrs = &cap[1];
        let inner = &cap[2];
        let id = id_re
            .captures(attrs)
            .map(|c| c[1].to_string())
            .unwrap_or_else(|| {
                let s = counter.to_string();
                counter += 1;
                s
            });
        let author = author_re.captures(attrs).map(|c| c[1].to_string());
        let mut parts = Vec::new();
        for tcap in t_re.captures_iter(inner) {
            parts.push(decode_xml_entities(&tcap[1]));
        }
        if !parts.is_empty() {
            out.push(WordComment {
                id,
                author,
                text: parts.join("").trim().to_string(),
                commented_text: None,
                paragraph_text: None,
            });
        }
    }
    out
}

fn extract_comment_ranges(document_xml: &str) -> HashMap<String, RangeInfo> {
    // Regex-pair start/end markers (attribute order may vary in real .docx).
    let start_re = regex::Regex::new(
        r#"<w:commentRangeStart\b[^>]*?\bw:id="([^"]+)"[^>]*?/>"#,
    )
    .unwrap();
    let end_re = regex::Regex::new(
        r#"<w:commentRangeEnd\b[^>]*?\bw:id="([^"]+)"[^>]*?/>"#,
    )
    .unwrap();

    let mut starts: HashMap<String, usize> = HashMap::new();
    let mut ends: HashMap<String, usize> = HashMap::new();

    for m in start_re.captures_iter(document_xml) {
        let id = m[1].to_string();
        // position-after-opening-tag
        starts.insert(id, m.get(0).unwrap().end());
    }
    for m in end_re.captures_iter(document_xml) {
        let id = m[1].to_string();
        ends.insert(id, m.get(0).unwrap().start());
    }

    let mut out = HashMap::new();
    for (id, start_pos) in &starts {
        let Some(&end_pos) = ends.get(id) else {
            out.insert(
                id.clone(),
                RangeInfo {
                    commented_text: String::new(),
                    paragraph_text: String::new(),
                },
            );
            continue;
        };
        if end_pos < *start_pos {
            out.insert(
                id.clone(),
                RangeInfo {
                    commented_text: String::new(),
                    paragraph_text: String::new(),
                },
            );
            continue;
        }
        let slice = &document_xml[*start_pos..end_pos];
        let commented_text = extract_run_text(slice);
        let paragraph_text = extract_enclosing_paragraph(document_xml, *start_pos, end_pos);
        out.insert(
            id.clone(),
            RangeInfo {
                commented_text,
                paragraph_text,
            },
        );
    }
    out
}

fn extract_enclosing_paragraph(document_xml: &str, range_start: usize, range_end: usize) -> String {
    let before = &document_xml[..range_start];
    let p_open_re = regex::Regex::new(r"<w:p\b[^>]*>").unwrap();
    let mut p_open_idx: Option<usize> = None;
    for m in p_open_re.find_iter(before) {
        p_open_idx = Some(m.start());
    }
    let Some(p_open) = p_open_idx else {
        return String::new();
    };
    let close_tag = "</w:p>";
    let Some(p_close_rel) = document_xml[range_end..].find(close_tag) else {
        return String::new();
    };
    let p_close = range_end + p_close_rel + close_tag.len();
    extract_run_text(&document_xml[p_open..p_close])
}
