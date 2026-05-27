import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ProjectData } from '@shared/types/domain';
import {
  buildCategoryTable,
  buildDiscussionParagraph,
  buildLimitationsParagraph,
  buildMethodsParagraph,
  buildRelationsNarrative,
  buildResultsParagraph,
  extractStats,
  SUGGESTED_REFERENCES,
  type WizardData,
} from './wordExport.js';

function p(text: string, opts: { bold?: boolean; size?: number; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; spacingAfter?: number } = {}): Paragraph {
  return new Paragraph({
    heading: opts.heading,
    spacing: { after: opts.spacingAfter ?? 120 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        size: opts.size,
      }),
    ],
  });
}

function placeholderBox(label: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    border: {
      top: { style: BorderStyle.DASHED, size: 6, color: '888888' },
      bottom: { style: BorderStyle.DASHED, size: 6, color: '888888' },
      left: { style: BorderStyle.DASHED, size: 6, color: '888888' },
      right: { style: BorderStyle.DASHED, size: 6, color: '888888' },
    },
    spacing: { before: 240, after: 240 },
    children: [
      new TextRun({ text: label, italics: true, color: '666666' }),
    ],
  });
}

export async function generateWordDocBytes(
  data: ProjectData,
  wiz: WizardData
): Promise<Uint8Array> {
  const stats = extractStats(data);
  const children: (Paragraph | Table)[] = [];

  // ---- Title block ----
  if (wiz.title) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ text: wiz.title, bold: true, size: 32 })],
      })
    );
  }
  if (wiz.authors) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: wiz.authors })],
      })
    );
  }
  if (wiz.venue) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [new TextRun({ text: `(${wiz.venue}向け原稿)`, italics: true })],
      })
    );
  }

  // ---- Methods (if separate layout) ----
  if (wiz.sectionLayout === 'separate' && wiz.include.methodsBoilerplate) {
    children.push(p('方法', { heading: HeadingLevel.HEADING_1, spacingAfter: 200 }));
    children.push(p(buildMethodsParagraph(wiz, stats)));
  }

  // ---- Results (or 結果と考察) ----
  const resultsHeading =
    wiz.sectionLayout === 'separate' ? '結果' : '結果と考察';
  children.push(p(resultsHeading, { heading: HeadingLevel.HEADING_1, spacingAfter: 200 }));

  if (wiz.include.resultsBoilerplate) {
    children.push(p(buildResultsParagraph(wiz, stats)));
  }

  // Figure placeholder (no PNG inserted — text marker only, per user spec)
  if (wiz.include.figurePlaceholder) {
    children.push(
      placeholderBox('[Figure 1: KJ 法による構造図を本ファイル編集時にここに挿入してください]')
    );
  }

  // Category table
  if (wiz.include.categoryTable) {
    children.push(p('Table 1: カテゴリ階層と件数', { bold: true, spacingAfter: 100 }));
    const rows = buildCategoryTable(data, wiz);
    const headerCells = ['階層', 'カテゴリ名', '件数', '代表記述'].map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          shading: { fill: 'eeeeee' },
        })
    );
    const dataRows = rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(r.level)] }),
            new TableCell({ children: [new Paragraph(r.name)] }),
            new TableCell({ children: [new Paragraph(String(r.count))] }),
            new TableCell({ children: [new Paragraph(r.example)] }),
          ],
        })
    );
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ children: headerCells }), ...dataRows],
      })
    );
    children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
  }

  // Structure narrative (paper type = structure)
  if (wiz.paperTypes.includes('structure') && wiz.include.relationsNarrative) {
    const lines = buildRelationsNarrative(data, wiz);
    if (lines.length > 0) {
      children.push(p('カテゴリ間の関係', { bold: true, spacingAfter: 100 }));
      for (const line of lines) children.push(p(line));
    }
  }

  // Integrated layout: discussion follows immediately in same heading
  if (wiz.sectionLayout === 'integrated' && wiz.include.discussionBoilerplate) {
    children.push(p(buildDiscussionParagraph(wiz, stats)));
  }

  // ---- Discussion (separate layout) ----
  if (wiz.sectionLayout === 'separate' && wiz.include.discussionBoilerplate) {
    children.push(p('考察', { heading: HeadingLevel.HEADING_1, spacingAfter: 200 }));
    children.push(p(buildDiscussionParagraph(wiz, stats)));
  }

  // ---- Limitations ----
  if (wiz.include.limitations) {
    children.push(p('本研究の限界と今後の課題', { heading: HeadingLevel.HEADING_2, spacingAfter: 200 }));
    children.push(p(buildLimitationsParagraph(wiz)));
  }

  // ---- References ----
  if (wiz.selectedReferences.length > 0) {
    children.push(p('引用文献', { heading: HeadingLevel.HEADING_1, spacingAfter: 200 }));
    const byId = new Map(SUGGESTED_REFERENCES.map((r) => [r.id, r]));
    for (const id of wiz.selectedReferences) {
      const ref = byId.get(id);
      if (!ref) continue;
      children.push(p(ref.display));
    }
  }

  const doc = new Document({
    creator: 'KJ Trace Studio',
    title: wiz.title || 'KJ法分析結果',
    description: 'Generated by KJ Trace Studio Word export wizard',
    styles: {
      default: {
        document: {
          run: {
            font: '游明朝',
            size: 22, // 11pt
          },
        },
      },
    },
    sections: [{ children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
