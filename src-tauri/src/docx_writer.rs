// Phase 4c-2: docx writer probe (docx crate replacement).
//
// Mirrors the smallest representative subset of the existing Word export
// (kj-trace-studio/src/renderer/domain/wordDocxWriter.ts):
//   - paragraphs with text
//   - heading 1 / 2
//   - bold / italic runs
//   - bullet list
//
// If this round-trip works for P02-style content, the full export logic
// (KJ paper template) is mechanical to port.

use docx_rs::{
    AlignmentType, Docx, Paragraph, Run, RunFonts,
};
use std::path::Path;

pub fn build_sample_docx(title: &str, body_lines: &[&str], out_path: &str) -> Result<(), String> {
    let mut doc = Docx::new();

    // Heading 1
    doc = doc.add_paragraph(
        Paragraph::new()
            .style("Heading1")
            .add_run(Run::new().add_text(title).bold().size(36)),
    );

    // Body paragraphs
    for line in body_lines {
        doc = doc.add_paragraph(
            Paragraph::new()
                .align(AlignmentType::Left)
                .add_run(
                    Run::new()
                        .add_text(*line)
                        .fonts(RunFonts::new().east_asia("MS Mincho")),
                ),
        );
    }

    // A bullet item
    doc = doc.add_paragraph(
        Paragraph::new()
            .numbering(docx_rs::NumberingId::new(1), docx_rs::IndentLevel::new(0))
            .add_run(Run::new().add_text("KJ 法カード 1")),
    );
    doc = doc.add_paragraph(
        Paragraph::new()
            .numbering(docx_rs::NumberingId::new(1), docx_rs::IndentLevel::new(0))
            .add_run(Run::new().add_text("KJ 法カード 2")),
    );

    // Write to disk
    let file = std::fs::File::create(Path::new(out_path))
        .map_err(|e| format!("create file: {e}"))?;
    doc.build()
        .pack(file)
        .map_err(|e| format!("docx pack: {e}"))?;
    Ok(())
}
