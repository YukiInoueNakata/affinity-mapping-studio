/**
 * Domain logic for KJ-法 Word export wizard. Builds Methods / Results /
 * Discussion paragraphs from the live project + user-supplied wizard fields,
 * following the templates summarised in `docs/.../deep-research-report.md`.
 *
 * Pure functions only — no DOM or docx library here so the generators can
 * be unit-tested. The actual .docx serialisation lives in wordDocxWriter.ts.
 */
import type { ProjectData, Group, Card } from '@shared/types/domain';
import { getGroupLabel, getGroupMembers } from './groups.js';

export type PaperType = 'enumeration' | 'structure';
// 'enumeration' = カテゴリ列挙型 ; 'structure' = 図式化・構造モデル型

export type SectionLayout = 'separate' | 'integrated';
// separate = 方法→結果→考察 ; integrated = 結果と考察一体

export type AnalysisUnit =
  | 'free_response'
  | 'meaning_unit'
  | 'utterance'
  | 'other';

export type DataSourceKind =
  | 'free_response'
  | 'interview'
  | 'mixed'
  | 'observation'
  | 'other';

export interface LevelMapping {
  /** Project Group.level → human-readable label for the paper. */
  [level: number]: string; // e.g., 1 -> "小カテゴリー", 2 -> "中カテゴリー", 3 -> "大カテゴリー"
}

export interface WizardData {
  // Step 1 — bibliographic
  title: string;
  authors: string;
  venue: string;
  // Step 2 — paper type
  paperTypes: PaperType[]; // multi-select
  sectionLayout: SectionLayout;
  // Step 3 — data / methods
  dataSource: DataSourceKind;
  analysisUnit: AnalysisUnit;
  analysisUnitOther: string;
  participantsN: number | null;
  responsesN: number | null;
  // Step 4 — classifiers
  classifierCount: number;
  classifierConsensus:
    | 'independent_then_agree'
    | 'single_then_review'
    | 'group'
    | 'other';
  classifierNote: string;
  // Step 5 — hierarchy mapping (Project Group.level -> 大/中/小カテゴリー)
  levelMapping: LevelMapping;
  // Step 6 — sections / elements to include
  include: {
    methodsBoilerplate: boolean;
    resultsBoilerplate: boolean;
    discussionBoilerplate: boolean;
    limitations: boolean;
    categoryTable: boolean;
    representativeExamples: boolean;
    countsInline: boolean;
    figurePlaceholder: boolean;
    relationsNarrative: boolean; // for structure型
  };
  // Step 7 — auxiliary analysis follow-up
  auxiliaryAnalyses: string[]; // free strings (e.g. "EFA", "テキストマイニング")
  // Step 8 — references
  selectedReferences: string[]; // ref ids (see SUGGESTED_REFERENCES)
}

export const SUGGESTED_REFERENCES: Array<{
  id: string;
  display: string;
  paperTypes: PaperType[];
}> = [
  {
    id: 'morikawa2002',
    display:
      '森脇愛子・坂本真士・丹野義彦 (2002) 大学生における自己開示方法および被開示者の反応の尺度作成の試み. 性格心理学研究, 11(1), 12-23.',
    paperTypes: ['enumeration'],
  },
  {
    id: 'tomono2005',
    display:
      '友野隆成・橋本宰 (2005) 改訂版対人場面におけるあいまいさへの非寛容尺度作成の試み. パーソナリティ研究, 13(2), 220-230.',
    paperTypes: ['enumeration'],
  },
  {
    id: 'masuda2008',
    display:
      '舛田亮太 (2008) 青年の語りからみた日常的解離の発達について. パーソナリティ研究, 16(3), 295-310.',
    paperTypes: ['enumeration', 'structure'],
  },
  {
    id: 'ikeda2012',
    display:
      '池田浩・三沢良 (2012) 失敗に対する価値観の構造――失敗観尺度の開発. 教育心理学研究, 60(4), 367-379.',
    paperTypes: ['enumeration'],
  },
  {
    id: 'nishimura2012',
    display:
      '西村麻希・長野恵子 (2012) 現代青年の友人関係のあり方に関する質的研究――KJ法による自由記述の分析を通して. 西九州大学健康福祉学部紀要, 43.',
    paperTypes: ['structure'],
  },
  {
    id: 'yasui2021',
    display:
      '安井優子 (2021) 緩和ケア・終末期医療における医療ソーシャルワーカーのSpiritual Sensitivityの構造. 保健医療社会福祉研究, 29, 29-45.',
    paperTypes: ['structure'],
  },
  {
    id: 'tanaka2010',
    display:
      '田中博晃 (2010) KJ法入門：質的データ分析法としてKJ法を行う前に. (KJ法 quick manual)',
    paperTypes: ['enumeration', 'structure'],
  },
  {
    id: 'kawakita_hassouhou',
    display: '川喜田二郎 (1967)『発想法――創造性開発のために』中公新書.',
    paperTypes: ['enumeration', 'structure'],
  },
];

export const DEFAULT_WIZARD: WizardData = {
  title: '',
  authors: '',
  venue: '',
  paperTypes: ['enumeration'],
  sectionLayout: 'separate',
  dataSource: 'free_response',
  analysisUnit: 'meaning_unit',
  analysisUnitOther: '',
  participantsN: null,
  responsesN: null,
  classifierCount: 2,
  classifierConsensus: 'independent_then_agree',
  classifierNote: '',
  levelMapping: { 1: '小カテゴリー', 2: '大カテゴリー' },
  include: {
    methodsBoilerplate: true,
    resultsBoilerplate: true,
    discussionBoilerplate: true,
    limitations: true,
    categoryTable: true,
    representativeExamples: true,
    countsInline: true,
    figurePlaceholder: true,
    relationsNarrative: false,
  },
  auxiliaryAnalyses: [],
  selectedReferences: ['tanaka2010', 'kawakita_hassouhou'],
};

// ---- Extracted project statistics for the paper ----

export interface ExtractedStats {
  totalCards: number;
  totalGroups: number;
  groupsByLevel: Record<number, Group[]>;
  maxLevel: number;
  topCategories: Array<{ group: Group; labelText: string; memberCount: number }>;
}

export function extractStats(data: ProjectData): ExtractedStats {
  const groupsByLevel: Record<number, Group[]> = {};
  let maxLevel = 0;
  for (const g of data.groups) {
    if (!groupsByLevel[g.level]) groupsByLevel[g.level] = [];
    groupsByLevel[g.level].push(g);
    if (g.level > maxLevel) maxLevel = g.level;
  }
  const topByCount = data.groups
    .map((g) => {
      const members = getGroupMembers(data, g.id);
      const label = getGroupLabel(data, g.id);
      return {
        group: g,
        labelText: label?.text?.trim() || g.name,
        memberCount: members.length,
      };
    })
    .filter((x) => x.memberCount > 0)
    .sort((a, b) => b.memberCount - a.memberCount);
  return {
    totalCards: data.cards.length,
    totalGroups: data.groups.length,
    groupsByLevel,
    maxLevel,
    topCategories: topByCount,
  };
}

// ---- Paragraph generators ----

/** Build the labeled level term (e.g., "大カテゴリー"). Fallback: "グループレベル N". */
export function levelTerm(level: number, mapping: LevelMapping): string {
  return mapping[level] ?? `グループレベル${level}`;
}

const ANALYSIS_UNIT_LABEL: Record<AnalysisUnit, string> = {
  free_response: '1 回答',
  meaning_unit: '意味単位',
  utterance: '発話単位',
  other: '(指定された単位)',
};

const DATA_SOURCE_LABEL: Record<DataSourceKind, string> = {
  free_response: '自由記述',
  interview: '面接逐語録',
  mixed: '自由記述および面接逐語録',
  observation: '参与観察データ',
  other: '(指定された種別)',
};

const CONSENSUS_LABEL: Record<WizardData['classifierConsensus'], string> = {
  independent_then_agree: '各自で独立に分類した後、協議により最終分類を確定',
  single_then_review: '1 名が分類後、別の研究者がレビューした',
  group: '複数名で合議しながら分類した',
  other: '(指定された手続き)',
};

export function buildMethodsParagraph(
  wiz: WizardData,
  stats: ExtractedStats
): string {
  const unitTxt =
    wiz.analysisUnit === 'other'
      ? wiz.analysisUnitOther.trim() || '指定された単位'
      : ANALYSIS_UNIT_LABEL[wiz.analysisUnit];
  const srcTxt = DATA_SOURCE_LABEL[wiz.dataSource];
  const consTxt = CONSENSUS_LABEL[wiz.classifierConsensus];
  const partTxt =
    wiz.participantsN != null ? `参加者 ${wiz.participantsN} 名から得られた` : '';
  const respTxt =
    wiz.responsesN != null
      ? `計 ${wiz.responsesN} 件`
      : `計 ${stats.totalCards} 件`;
  const lvls = Object.keys(stats.groupsByLevel)
    .map((k) => Number(k))
    .sort();
  const levelDesc = lvls
    .map((lv) => `${levelTerm(lv, wiz.levelMapping)}を含む`)
    .join('、');
  return [
    `本研究では、${partTxt}${srcTxt}を分析対象とした。`,
    `各データは${unitTxt}に分割し、KJ 法 (川喜田, 1967) を援用してカテゴリ化した。`,
    `分類は ${wiz.classifierCount} 名で行い、${consTxt}。`,
    `その結果、${respTxt}を ${stats.totalGroups} カテゴリーに整理した (${levelDesc}階層構成)。`,
    wiz.auxiliaryAnalyses.length > 0
      ? `カテゴリ化後、${wiz.auxiliaryAnalyses.join('・')}を補助的に行った。`
      : '',
  ]
    .filter(Boolean)
    .join('');
}

export function buildResultsParagraph(
  wiz: WizardData,
  stats: ExtractedStats
): string {
  const lvls = Object.keys(stats.groupsByLevel)
    .map((k) => Number(k))
    .sort();
  const levelCounts = lvls
    .map((lv) => {
      const term = levelTerm(lv, wiz.levelMapping);
      const n = stats.groupsByLevel[lv]?.length ?? 0;
      return `${term} ${n} 個`;
    })
    .join('、');
  const top1 = stats.topCategories[0];
  const top2 = stats.topCategories[1];
  const top3 = stats.topCategories[2];
  const topPart =
    top1 && wiz.include.countsInline
      ? `最も多かったのは「${top1.labelText}」(n=${top1.memberCount})、` +
        (top2 ? `次いで「${top2.labelText}」(n=${top2.memberCount})` : '') +
        (top3 ? `、「${top3.labelText}」(n=${top3.memberCount})` : '') +
        'であった。'
      : '';
  const tableRef = wiz.include.categoryTable
    ? '各カテゴリーの内容と件数を Table 1 に示す。'
    : '';
  const figRef =
    wiz.include.figurePlaceholder &&
    wiz.paperTypes.includes('structure')
      ? 'カテゴリ間の関係構造を Figure 1 に示す。'
      : '';
  return [
    `自由記述 ${wiz.responsesN ?? stats.totalCards} 件に対して KJ 法を実施した結果、${levelCounts}が抽出された。`,
    topPart,
    tableRef,
    figRef,
  ]
    .filter(Boolean)
    .join('');
}

export function buildDiscussionParagraph(
  wiz: WizardData,
  stats: ExtractedStats
): string {
  const top1 = stats.topCategories[0];
  const top2 = stats.topCategories[1];
  const structurePart = wiz.paperTypes.includes('structure')
    ? `本研究で得られたカテゴリ間の関係構造から、対象概念は ${stats.totalGroups} の側面から多面的に捉えられる必要が示唆された。`
    : `本研究で得られたカテゴリー構造は、対象概念を ${stats.totalGroups} の側面から捉える必要を示した。`;
  const exemplarPart =
    top1 && top2
      ? `特に「${top1.labelText}」「${top2.labelText}」は中心的な側面であり、先行研究の議論と対応すると考えられる。`
      : '';
  const auxPart =
    wiz.auxiliaryAnalyses.length > 0
      ? `また、${wiz.auxiliaryAnalyses.join('・')}による補助分析の結果は、定性的に得られた構造を一定の範囲で支持した。`
      : '';
  return [structurePart, exemplarPart, auxPart].filter(Boolean).join('');
}

export function buildLimitationsParagraph(wiz: WizardData): string {
  return [
    `本研究の限界として、第一に分類者数 (${wiz.classifierCount} 名) と分類手続きの再現性にかかる検討余地が挙げられる。`,
    `第二に、KJ 法は分析者の解釈に依存する側面が大きく、得られたカテゴリ構造は他標本での再分析・量的検証によって妥当性を確認する必要がある。`,
    `今後は、対象の拡大、再分類の再現性検討、量的検証を通じて構造の妥当性をさらに検討する必要がある。`,
  ].join('');
}

/** For structure型: build narrative sentences from diagram_relations. */
export function buildRelationsNarrative(
  data: ProjectData,
  wiz: WizardData
): string[] {
  if (!wiz.paperTypes.includes('structure')) return [];
  const lines: string[] = [];
  for (const r of data.diagram_relations) {
    const sourceName = nameForObject(data, r.sourceObjectType, r.sourceObjectId);
    const targetName = nameForObject(data, r.targetObjectType, r.targetObjectId);
    if (!sourceName || !targetName) continue;
    const arrow = relationTypeToVerb(r.relationType);
    const label = r.label?.trim();
    lines.push(`「${sourceName}」は「${targetName}」と${arrow}関係にあった${label ? ` (${label})` : ''}。`);
  }
  return lines;
}

function nameForObject(
  data: ProjectData,
  kind: string,
  id: string
): string | null {
  if (kind === 'card') {
    return data.cards.find((c) => c.id === id)?.code ?? null;
  }
  if (kind === 'group') {
    const label = getGroupLabel(data, id);
    const g = data.groups.find((gg) => gg.id === id);
    return label?.text?.trim() || g?.name || null;
  }
  // concept / code 等は narrative では未対応
  return null;
}

function relationTypeToVerb(rt: string): string {
  // Compact narrative-friendly verbs (論文§2 分類)
  switch (rt) {
    case 'subsumes':
      return 'を包摂する';
    case 'exemplifies':
      return 'を例示する';
    case 'refutes':
      return 'を反証する';
    case 'complements':
      return 'を補完する';
    case 'opposes':
      return '対立する';
    case 'parallels':
      return 'と並列する';
    case 'causes':
      return '因果的に結びつく';
    case 'results_in':
      return 'に帰結する';
    case 'presupposes':
      return '前提となる';
    case 'conditions':
      return 'の条件となる';
    case 'synonymous':
      return 'と同義である';
    case 'similar':
      return 'と類似する';
    case 'influences':
      return 'に影響する';
    case 'defines':
      return 'を規定する';
    default:
      return '関連する';
  }
}

/**
 * Build the category table rows. Each row = one group with its label,
 * member count, and (optionally) the first member card body as a representative
 * example.
 */
export interface CategoryRow {
  level: string; // mapped level term
  name: string; // label text or group name
  count: number;
  example: string; // first member card body truncated
}

export function buildCategoryTable(
  data: ProjectData,
  wiz: WizardData
): CategoryRow[] {
  const rows: CategoryRow[] = [];
  for (const g of data.groups) {
    const label = getGroupLabel(data, g.id);
    const members = getGroupMembers(data, g.id);
    const example: Card | undefined = members[0];
    rows.push({
      level: levelTerm(g.level, wiz.levelMapping),
      name: label?.text?.trim() || g.name,
      count: members.length,
      example: wiz.include.representativeExamples
        ? truncate(example?.body ?? '', 120)
        : '',
    });
  }
  // Sort by level descending so higher levels come first
  rows.sort((a, b) => {
    // approximate: sort by length of level term (大カテゴリー > 中カテゴリー > 小カテゴリー)
    return a.level.localeCompare(b.level);
  });
  return rows;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
