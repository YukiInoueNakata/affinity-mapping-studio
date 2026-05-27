import { useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  DEFAULT_WIZARD,
  extractStats,
  SUGGESTED_REFERENCES,
  type AnalysisUnit,
  type DataSourceKind,
  type LevelMapping,
  type PaperType,
  type SectionLayout,
  type WizardData,
} from '../domain/wordExport.js';
import {
  buildDiscussionParagraph,
  buildLimitationsParagraph,
  buildMethodsParagraph,
  buildResultsParagraph,
} from '../domain/wordExport.js';
import { generateWordDocBytes } from '../domain/wordDocxWriter.js';

interface Props {
  open: boolean;
  onClose(): void;
}

type StepId =
  | 'paper'
  | 'sections'
  | 'data'
  | 'classifier'
  | 'hierarchy'
  | 'include'
  | 'auxiliary'
  | 'references'
  | 'meta'
  | 'preview';

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: 'paper', label: '1. 論文の型' },
  { id: 'sections', label: '2. 節構成' },
  { id: 'data', label: '3. データ・分析単位' },
  { id: 'classifier', label: '4. 分類者・合意形成' },
  { id: 'hierarchy', label: '5. カテゴリ階層マッピング' },
  { id: 'include', label: '6. 含める要素' },
  { id: 'auxiliary', label: '7. 補助分析' },
  { id: 'references', label: '8. 引用文献' },
  { id: 'meta', label: '9. タイトル・著者' },
  { id: 'preview', label: '10. プレビューと出力' },
];

export function WordExportWizard({ open, onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const [stepIdx, setStepIdx] = useState(0);
  const [wiz, setWiz] = useState<WizardData>(DEFAULT_WIZARD);
  const [generating, setGenerating] = useState(false);

  const stats = useMemo(
    () => (project ? extractStats(project.data) : null),
    [project]
  );

  if (!open) return null;
  if (!project || !stats) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 600 }}>
          <div className="empty-state">プロジェクトを開いてから利用してください</div>
        </div>
      </div>
    );
  }

  const current = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;

  const update = <K extends keyof WizardData>(k: K, v: WizardData[K]) =>
    setWiz((prev) => ({ ...prev, [k]: v }));

  const handleExport = async () => {
    setGenerating(true);
    try {
      const bytes = await generateWordDocBytes(project.data, wiz);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = (wiz.title || project.metadata.name || 'kj-export').replace(
        /[\\/:*?"<>|]/g,
        '_'
      );
      const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      a.download = `${safe}_${ts}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Word 生成に失敗しました: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 880, maxHeight: '90vh' }}
      >
        <header className="modal-header">
          <h2>Word エクスポート ウィザード (10 ステップ)</h2>
        </header>
        <div className="modal-body" style={{ display: 'flex', gap: 12, overflow: 'hidden' }}>
          {/* Left: step navigator */}
          <nav
            style={{
              flex: '0 0 200px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              borderRight: '1px solid var(--border)',
              paddingRight: 8,
            }}
          >
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStepIdx(i)}
                className={i === stepIdx ? 'tab active' : 'tab'}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {/* Right: step content */}
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
            <h3>{current.label}</h3>
            {current.id === 'paper' && (
              <PaperStep wiz={wiz} update={update} />
            )}
            {current.id === 'sections' && (
              <SectionStep wiz={wiz} update={update} />
            )}
            {current.id === 'data' && (
              <DataStep wiz={wiz} update={update} stats={stats} />
            )}
            {current.id === 'classifier' && (
              <ClassifierStep wiz={wiz} update={update} />
            )}
            {current.id === 'hierarchy' && (
              <HierarchyStep wiz={wiz} update={update} stats={stats} />
            )}
            {current.id === 'include' && (
              <IncludeStep wiz={wiz} update={update} />
            )}
            {current.id === 'auxiliary' && (
              <AuxiliaryStep wiz={wiz} update={update} />
            )}
            {current.id === 'references' && (
              <ReferencesStep wiz={wiz} update={update} />
            )}
            {current.id === 'meta' && <MetaStep wiz={wiz} update={update} />}
            {current.id === 'preview' && (
              <PreviewStep wiz={wiz} stats={stats} />
            )}
          </div>
        </div>
        <footer className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span className="muted small">
            ステップ {stepIdx + 1} / {STEPS.length}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}
              disabled={stepIdx === 0}
            >
              戻る
            </button>
            {isLast ? (
              <button
                type="button"
                className="primary"
                onClick={handleExport}
                disabled={generating}
              >
                {generating ? '生成中...' : '.docx で保存'}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => setStepIdx(Math.min(STEPS.length - 1, stepIdx + 1))}
              >
                次へ
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------- step components ----------

function PaperStep({ wiz, update }: { wiz: WizardData; update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  const toggle = (t: PaperType) => {
    const has = wiz.paperTypes.includes(t);
    const next = has ? wiz.paperTypes.filter((x) => x !== t) : [...wiz.paperTypes, t];
    update('paperTypes', next.length === 0 ? [t] : next);
  };
  return (
    <div>
      <p className="muted small">
        deep-research-report で整理された 5 型のうち、本ウィザードはカテゴリ列挙型と図式化・構造モデル型を主に支援します。両方選ぶとハイブリッドの文章が生成されます。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <label>
          <input
            type="checkbox"
            checked={wiz.paperTypes.includes('enumeration')}
            onChange={() => toggle('enumeration')}
          />
          <strong> カテゴリ列挙型</strong> — カテゴリ表 + 件数 + 代表記述 (Results 主体)
        </label>
        <label>
          <input
            type="checkbox"
            checked={wiz.paperTypes.includes('structure')}
            onChange={() => toggle('structure')}
          />
          <strong> 図式化・構造モデル型</strong> — カテゴリ間関係の文章化 + 図 (placeholder)
        </label>
      </div>
    </div>
  );
}

function SectionStep({ wiz, update }: { wiz: WizardData; update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void }) {
  return (
    <div>
      <p className="muted small">節構成のパターンを選択します。</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(['separate', 'integrated'] as SectionLayout[]).map((s) => (
          <label key={s}>
            <input
              type="radio"
              name="layout"
              checked={wiz.sectionLayout === s}
              onChange={() => update('sectionLayout', s)}
            />
            {s === 'separate' ? ' 分離型 (方法 → 結果 → 考察)' : ' 結果と考察一体型 (探索研究・ショートレポート向け)'}
          </label>
        ))}
      </div>
    </div>
  );
}

function DataStep({
  wiz,
  update,
  stats,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  stats: ReturnType<typeof extractStats>;
}) {
  return (
    <div>
      <p className="muted small">
        プロジェクトには {stats.totalCards} 枚のカードがあります。論文中の N (件数) として自動使用します。
      </p>
      <fieldset style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 3, marginTop: 8 }}>
        <legend className="muted small">データ種別</legend>
        {(['free_response', 'interview', 'mixed', 'observation', 'other'] as DataSourceKind[]).map((d) => (
          <label key={d} style={{ display: 'block' }}>
            <input
              type="radio"
              name="dataSource"
              checked={wiz.dataSource === d}
              onChange={() => update('dataSource', d)}
            />
            {' '}
            {d === 'free_response' && '自由記述'}
            {d === 'interview' && '面接逐語録'}
            {d === 'mixed' && '混合 (自由記述 + 面接)'}
            {d === 'observation' && '参与観察'}
            {d === 'other' && 'その他'}
          </label>
        ))}
      </fieldset>
      <fieldset style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 3, marginTop: 8 }}>
        <legend className="muted small">分析単位</legend>
        {(['free_response', 'meaning_unit', 'utterance', 'other'] as AnalysisUnit[]).map((u) => (
          <label key={u} style={{ display: 'block' }}>
            <input
              type="radio"
              name="analysisUnit"
              checked={wiz.analysisUnit === u}
              onChange={() => update('analysisUnit', u)}
            />
            {' '}
            {u === 'free_response' && '1 回答単位'}
            {u === 'meaning_unit' && '意味単位'}
            {u === 'utterance' && '発話単位'}
            {u === 'other' && 'その他'}
          </label>
        ))}
        {wiz.analysisUnit === 'other' && (
          <input
            type="text"
            value={wiz.analysisUnitOther}
            onChange={(e) => update('analysisUnitOther', e.target.value)}
            placeholder="例: 1 段落単位"
            style={{ width: '100%', marginTop: 4 }}
          />
        )}
      </fieldset>
      <fieldset style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 3, marginTop: 8 }}>
        <legend className="muted small">サンプル数 (任意)</legend>
        <label>
          参加者数:
          <input
            type="number"
            min={0}
            value={wiz.participantsN ?? ''}
            onChange={(e) =>
              update('participantsN', e.target.value === '' ? null : Number(e.target.value))
            }
            style={{ width: 80, marginLeft: 4 }}
          />
        </label>
        <label style={{ marginLeft: 16 }}>
          有効回答数:
          <input
            type="number"
            min={0}
            value={wiz.responsesN ?? ''}
            placeholder={String(stats.totalCards)}
            onChange={(e) =>
              update('responsesN', e.target.value === '' ? null : Number(e.target.value))
            }
            style={{ width: 80, marginLeft: 4 }}
          />
        </label>
      </fieldset>
    </div>
  );
}

function ClassifierStep({
  wiz,
  update,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  return (
    <div>
      <p className="muted small">
        分類者の人数と合意形成の手続きを記入します。Methods に明記されると査読対応として強くなります。
      </p>
      <label style={{ display: 'block', marginTop: 8 }}>
        分類者人数:
        <input
          type="number"
          min={1}
          max={20}
          value={wiz.classifierCount}
          onChange={(e) => update('classifierCount', Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 60, marginLeft: 4 }}
        />
      </label>
      <fieldset style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 3, marginTop: 8 }}>
        <legend className="muted small">合意形成の手続き</legend>
        {(
          [
            ['independent_then_agree', '各自で独立に分類した後、協議により最終分類を確定'],
            ['single_then_review', '1 名が分類後、別の研究者がレビュー'],
            ['group', '複数名で合議しながら分類'],
            ['other', 'その他 (備考に記入)'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} style={{ display: 'block' }}>
            <input
              type="radio"
              name="consensus"
              checked={wiz.classifierConsensus === key}
              onChange={() => update('classifierConsensus', key)}
            />{' '}
            {label}
          </label>
        ))}
        <textarea
          value={wiz.classifierNote}
          onChange={(e) => update('classifierNote', e.target.value)}
          placeholder="補足 (任意)"
          rows={2}
          style={{ width: '100%', marginTop: 4 }}
        />
      </fieldset>
    </div>
  );
}

function HierarchyStep({
  wiz,
  update,
  stats,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
  stats: ReturnType<typeof extractStats>;
}) {
  const presets = ['小カテゴリー', '中カテゴリー', '大カテゴリー', '超カテゴリー'];
  const lvls = Object.keys(stats.groupsByLevel)
    .map((k) => Number(k))
    .sort();
  const setLevel = (level: number, term: string) => {
    const next: LevelMapping = { ...wiz.levelMapping, [level]: term };
    update('levelMapping', next);
  };
  return (
    <div>
      <p className="muted small">
        プロジェクトには {stats.maxLevel} 階層のグループがあります。各レベルを論文上のカテゴリ呼称にマッピングしてください。
      </p>
      <table style={{ marginTop: 12, borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: 4 }}>プロジェクトの Group.level</th>
            <th style={{ textAlign: 'left', padding: 4 }}>件数</th>
            <th style={{ textAlign: 'left', padding: 4 }}>論文呼称</th>
          </tr>
        </thead>
        <tbody>
          {lvls.map((lv) => (
            <tr key={lv}>
              <td style={{ padding: 4 }}>Lv {lv}</td>
              <td style={{ padding: 4 }}>{stats.groupsByLevel[lv]?.length ?? 0} 個</td>
              <td style={{ padding: 4 }}>
                <input
                  type="text"
                  list={`preset-${lv}`}
                  value={wiz.levelMapping[lv] ?? ''}
                  placeholder={`グループレベル${lv}`}
                  onChange={(e) => setLevel(lv, e.target.value)}
                  style={{ width: '100%' }}
                />
                <datalist id={`preset-${lv}`}>
                  {presets.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncludeStep({
  wiz,
  update,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  const toggle = (key: keyof WizardData['include']) => {
    update('include', { ...wiz.include, [key]: !wiz.include[key] });
  };
  const items: Array<{ key: keyof WizardData['include']; label: string }> = [
    { key: 'methodsBoilerplate', label: 'Methods 定型文' },
    { key: 'resultsBoilerplate', label: 'Results 定型文' },
    { key: 'discussionBoilerplate', label: 'Discussion 定型文' },
    { key: 'limitations', label: '限界と今後の課題' },
    { key: 'categoryTable', label: 'カテゴリ表 (自動生成)' },
    { key: 'representativeExamples', label: '代表記述 (カード本文先頭)' },
    { key: 'countsInline', label: '件数を文中にインライン表示' },
    { key: 'figurePlaceholder', label: '図の挿入位置マーカー' },
    { key: 'relationsNarrative', label: 'カテゴリ間関係の文章化 (構造モデル型)' },
  ];
  return (
    <div>
      <p className="muted small">Word に含める要素を選択します。</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
        {items.map((it) => (
          <label key={it.key}>
            <input
              type="checkbox"
              checked={wiz.include[it.key]}
              onChange={() => toggle(it.key)}
            />{' '}
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function AuxiliaryStep({
  wiz,
  update,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  const presets = [
    '探索的因子分析',
    '確認的因子分析',
    'テキストマイニング',
    '数量化III類',
    '群比較 (t 検定 / χ² 検定)',
    'M-GTA との混合',
  ];
  const toggle = (s: string) => {
    const has = wiz.auxiliaryAnalyses.includes(s);
    update(
      'auxiliaryAnalyses',
      has ? wiz.auxiliaryAnalyses.filter((x) => x !== s) : [...wiz.auxiliaryAnalyses, s]
    );
  };
  return (
    <div>
      <p className="muted small">KJ 法の後または並列で行った補助分析を選びます。Methods / Discussion に記述されます。</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
        {presets.map((p) => (
          <label key={p}>
            <input
              type="checkbox"
              checked={wiz.auxiliaryAnalyses.includes(p)}
              onChange={() => toggle(p)}
            />{' '}
            {p}
          </label>
        ))}
      </div>
    </div>
  );
}

function ReferencesStep({
  wiz,
  update,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  const toggle = (id: string) => {
    const has = wiz.selectedReferences.includes(id);
    update(
      'selectedReferences',
      has ? wiz.selectedReferences.filter((x) => x !== id) : [...wiz.selectedReferences, id]
    );
  };
  return (
    <div>
      <p className="muted small">
        deep-research-report に基づく推奨文献。論文の型に合うものをチェックすると、引用文献節に追加されます。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {SUGGESTED_REFERENCES.map((r) => {
          const match = r.paperTypes.some((t) => wiz.paperTypes.includes(t));
          return (
            <label
              key={r.id}
              style={{
                opacity: match ? 1 : 0.6,
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              <input
                type="checkbox"
                checked={wiz.selectedReferences.includes(r.id)}
                onChange={() => toggle(r.id)}
              />{' '}
              {r.display}{' '}
              <span className="muted small">[{r.paperTypes.join(', ')}]</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function MetaStep({
  wiz,
  update,
}: {
  wiz: WizardData;
  update: <K extends keyof WizardData>(k: K, v: WizardData[K]) => void;
}) {
  return (
    <div>
      <p className="muted small">最後に書誌情報を入力します (任意)。</p>
      <label className="block-label">論文タイトル</label>
      <input
        type="text"
        value={wiz.title}
        onChange={(e) => update('title', e.target.value)}
        style={{ width: '100%' }}
      />
      <label className="block-label">著者 (改行区切りまたは ・)</label>
      <input
        type="text"
        value={wiz.authors}
        onChange={(e) => update('authors', e.target.value)}
        style={{ width: '100%' }}
      />
      <label className="block-label">投稿先 / 発表先 (任意)</label>
      <input
        type="text"
        value={wiz.venue}
        onChange={(e) => update('venue', e.target.value)}
        placeholder="例: 教育心理学研究"
        style={{ width: '100%' }}
      />
    </div>
  );
}

function PreviewStep({
  wiz,
  stats,
}: {
  wiz: WizardData;
  stats: ReturnType<typeof extractStats>;
}) {
  return (
    <div>
      <p className="muted small">
        生成される本文の主要段落のプレビューです。実際の Word ファイルでは表・引用文献・図プレースホルダも含まれます。
      </p>
      <div
        style={{
          marginTop: 8,
          padding: 12,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border)',
          borderRadius: 3,
          maxHeight: '50vh',
          overflowY: 'auto',
          fontSize: 12,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {wiz.title && <h3 style={{ marginTop: 0 }}>{wiz.title}</h3>}
        {wiz.authors && <p>{wiz.authors}</p>}
        {wiz.sectionLayout === 'separate' && wiz.include.methodsBoilerplate && (
          <>
            <h4>方法</h4>
            <p>{buildMethodsParagraph(wiz, stats)}</p>
          </>
        )}
        <h4>{wiz.sectionLayout === 'separate' ? '結果' : '結果と考察'}</h4>
        {wiz.include.resultsBoilerplate && <p>{buildResultsParagraph(wiz, stats)}</p>}
        {wiz.sectionLayout === 'integrated' && wiz.include.discussionBoilerplate && (
          <p>{buildDiscussionParagraph(wiz, stats)}</p>
        )}
        {wiz.sectionLayout === 'separate' && wiz.include.discussionBoilerplate && (
          <>
            <h4>考察</h4>
            <p>{buildDiscussionParagraph(wiz, stats)}</p>
          </>
        )}
        {wiz.include.limitations && (
          <>
            <h4>本研究の限界と今後の課題</h4>
            <p>{buildLimitationsParagraph(wiz)}</p>
          </>
        )}
      </div>
    </div>
  );
}
