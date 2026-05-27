import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  buildConcept,
  buildConceptFromGroup,
  buildMGtaCategory,
  buildSettings,
  buildTheoreticalMemo,
  buildVariation,
  CONCEPT_STATUS_LABELS,
  getActiveSettings,
  getVariationsForConcept,
  MGtaError,
  nextConceptName,
  VARIATION_ROLE_LABELS,
} from '../domain/mgta.js';
import {
  makeAddVariationCommand,
  makeAssignConceptToCategoryCommand,
  makeCreateConceptCommand,
  makeCreateMGtaCategoryCommand,
  makeCreateMGtaSettingsCommand,
  makeCreateTheoreticalMemoCommand,
  makeDeleteConceptCommand,
  makeDeleteTheoreticalMemoCommand,
  makeEditConceptCommand,
  makeEditTheoreticalMemoCommand,
  makeRemoveVariationCommand,
  makeUpdateMGtaSettingsCommand,
} from '../stores/commands.js';
import { MGtaSettingsDialog } from './MGtaSettingsDialog.js';
import { AnalyticDiagramView } from './AnalyticDiagramView.js';
import type {
  MGtaConcept,
  MGtaConceptStatus,
  MGtaVariationRole,
  TheoreticalMemo,
} from '@shared/types/domain';

const STATUS_ORDER: MGtaConceptStatus[] = [
  'draft',
  'active',
  'reviewed',
  'merged',
  'rejected',
  'archived',
];

const ROLE_ORDER: MGtaVariationRole[] = [
  'variation',
  'similar_example',
  'opposite_example',
  'negative_case',
  'memo_only',
];

export function MGtaWorkspace() {
  const project = useProjectStore((s) => s.project);
  const selectedConceptId = useProjectStore((s) => s.selectedConceptId);
  const selectConcept = useProjectStore((s) => s.selectConcept);
  const applyCommand = useProjectStore((s) => s.applyCommand);

  const settings = useMemo(() => (project ? getActiveSettings(project.data) : null), [
    project,
  ]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<'worksheet' | 'diagram'>('worksheet');

  useEffect(() => {
    if (project && !settings) setSettingsOpen(true);
  }, [project, settings]);

  const concepts = useMemo(() => {
    if (!project) return [];
    return [...project.data.m_gta_concepts].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
  }, [project]);

  const categories = useMemo(() => (project ? project.data.m_gta_categories : []), [
    project,
  ]);

  const selectedConcept = useMemo(() => {
    if (!project || !selectedConceptId) return null;
    return project.data.m_gta_concepts.find((c) => c.id === selectedConceptId) ?? null;
  }, [project, selectedConceptId]);

  if (!project) {
    return <div className="empty-state">プロジェクトを開いてください</div>;
  }

  const handleSettingsSubmit = (input: {
    analysisTheme: string;
    focalPerson: string;
    researchQuestion?: string;
    notes?: string;
  }) => {
    const now = new Date().toISOString();
    if (settings) {
      applyCommand(
        makeUpdateMGtaSettingsCommand(
          settings.id,
          {
            analysisTheme: settings.analysisTheme,
            focalPerson: settings.focalPerson,
            researchQuestion: settings.researchQuestion,
            notes: settings.notes,
          },
          { ...input, now }
        )
      );
    } else {
      const s = buildSettings({ ...input, now });
      applyCommand(makeCreateMGtaSettingsCommand(s));
    }
    setSettingsOpen(false);
  };

  const handleCreateConcept = () => {
    if (!settings) {
      setSettingsOpen(true);
      return;
    }
    const now = new Date().toISOString();
    const c = buildConcept({
      settingsId: settings.id,
      name: nextConceptName(project.data),
      now,
    });
    applyCommand(makeCreateConceptCommand(c));
    selectConcept(c.id);
  };

  const handleCreateConceptFromGroups = () => {
    if (!settings) {
      setSettingsOpen(true);
      return;
    }
    if (project.data.groups.length === 0) {
      alert('KJ モードでグループを作ってから戻ってきてください');
      return;
    }
    const groupId = prompt(
      '概念候補にする KJ グループ ID または名前を入力（複数の場合カンマ区切り）'
    );
    if (!groupId) return;
    const candidates = groupId
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const now = new Date().toISOString();
    let createdLast: string | null = null;
    for (const key of candidates) {
      const group =
        project.data.groups.find((g) => g.id === key) ??
        project.data.groups.find((g) => g.name === key);
      if (!group) {
        alert(`グループが見つかりません: ${key}`);
        continue;
      }
      try {
        const out = buildConceptFromGroup(project.data, {
          groupId: group.id,
          settingsId: settings.id,
          includeMemberCards: true,
          includeLabelAsDefinition: true,
          now,
        });
        applyCommand(makeCreateConceptCommand(out.concept, out.variations));
        createdLast = out.concept.id;
      } catch (e) {
        if (e instanceof MGtaError) alert(e.message);
        else throw e;
      }
    }
    if (createdLast) selectConcept(createdLast);
  };

  const handleCreateCategory = () => {
    const name = prompt('新しいカテゴリーの名前');
    if (!name) return;
    const now = new Date().toISOString();
    applyCommand(makeCreateMGtaCategoryCommand(buildMGtaCategory({ name, now })));
  };

  const groupedConcepts = useMemo(() => {
    const byCategory = new Map<string | null, MGtaConcept[]>();
    for (const c of concepts) {
      const key = c.categoryId ?? null;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(c);
    }
    return byCategory;
  }, [concepts]);

  return (
    <div className="mgta-workspace">
      <header className="mgta-header">
        <div className="mgta-header-meta">
          <div className="mgta-header-row">
            <span className="mgta-header-label">分析テーマ:</span>
            <span className="mgta-header-value">
              {settings?.analysisTheme || <em className="muted">未設定</em>}
            </span>
          </div>
          <div className="mgta-header-row">
            <span className="mgta-header-label">分析焦点者:</span>
            <span className="mgta-header-value">
              {settings?.focalPerson || <em className="muted">未設定</em>}
            </span>
          </div>
        </div>
        <div className="mgta-header-actions">
          <div className="mode-switcher" style={{ marginRight: 6 }}>
            <button
              type="button"
              className={`mode-btn ${view === 'worksheet' ? 'active' : ''}`}
              onClick={() => setView('worksheet')}
            >
              ワークシート
            </button>
            <button
              type="button"
              className={`mode-btn ${view === 'diagram' ? 'active' : ''}`}
              onClick={() => setView('diagram')}
            >
              結果図
            </button>
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            設定編集
          </button>
          <button type="button" onClick={() => setExportOpen(true)} disabled={!settings}>
            エクスポート
          </button>
        </div>
      </header>

      {view === 'diagram' ? (
        <AnalyticDiagramView mode="m_gta" />
      ) : (
      <div className="mgta-body">
        <aside className="mgta-left">
          <section className="panel-section">
            <h3>概念 ({concepts.length})</h3>
            <div className="mgta-actions-row">
              <button type="button" onClick={handleCreateConcept}>+ 新規概念</button>
              <button type="button" onClick={handleCreateConceptFromGroups}>
                KJグループから
              </button>
            </div>
            <ul className="mgta-concept-list">
              {Array.from(groupedConcepts.entries()).map(([catId, cs]) => {
                const cat = catId ? categories.find((c) => c.id === catId) : null;
                return (
                  <li key={catId ?? 'none'} className="mgta-category-block">
                    <div className="mgta-category-name">
                      {cat ? cat.name : '(未カテゴリー)'}
                    </div>
                    <ul className="mgta-concept-sublist">
                      {cs.map((c) => (
                        <li
                          key={c.id}
                          className={c.id === selectedConceptId ? 'active' : ''}
                          onClick={() => selectConcept(c.id)}
                        >
                          <span className="mgta-concept-name">{c.name || '(無名)'}</span>
                          <span className={`mgta-concept-status status-${c.status}`}>
                            {CONCEPT_STATUS_LABELS[c.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
              {concepts.length === 0 && (
                <li className="muted">(まだ概念がありません)</li>
              )}
            </ul>
          </section>
          <section className="panel-section">
            <h3>カテゴリー ({categories.length})</h3>
            <div className="mgta-actions-row">
              <button type="button" onClick={handleCreateCategory}>+ 新規カテゴリー</button>
            </div>
          </section>
        </aside>

        <section className="mgta-center">
          {selectedConcept ? (
            <ConceptWorksheet conceptId={selectedConcept.id} />
          ) : (
            <div className="empty-state">
              左から概念を選ぶか、新規作成してください
            </div>
          )}
        </section>
      </div>
      )}

      <MGtaSettingsDialog
        open={settingsOpen}
        initial={settings}
        onClose={() => setSettingsOpen(false)}
        onSubmit={handleSettingsSubmit}
      />
      {exportOpen && (
        <MGtaExportDialog onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}

function ConceptWorksheet({ conceptId }: { conceptId: string }) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectConcept = useProjectStore((s) => s.selectConcept);
  const setMode = useProjectStore((s) => s.setMode);
  const selectCard = useProjectStore((s) => s.selectCard);

  const concept = useMemo(() => {
    if (!project) return null;
    return project.data.m_gta_concepts.find((c) => c.id === conceptId) ?? null;
  }, [project, conceptId]);

  const variations = useMemo(() => {
    if (!project || !concept) return [];
    return getVariationsForConcept(project.data, concept.id);
  }, [project, concept]);

  const categories = useMemo(() => (project ? project.data.m_gta_categories : []), [
    project,
  ]);

  const memos = useMemo(() => {
    if (!project || !concept) return [];
    return project.data.theoretical_memos.filter(
      (m) => m.targetType === 'concept' && m.targetId === concept.id
    );
  }, [project, concept]);

  const [draftName, setDraftName] = useState('');
  const [draftDef, setDraftDef] = useState('');

  useEffect(() => {
    setDraftName(concept?.name ?? '');
    setDraftDef(concept?.definition ?? '');
  }, [concept?.id, concept?.name, concept?.definition]);

  if (!concept || !project) return <div className="empty-state">概念が見つかりません</div>;

  const commitField = (
    field: 'name' | 'definition' | 'status' | 'categoryId',
    value: string | undefined
  ) => {
    if (!concept) return;
    const prev = {
      name: concept.name,
      definition: concept.definition,
      status: concept.status,
      categoryId: concept.categoryId,
      updatedAt: concept.updatedAt,
    };
    const next: typeof prev & { now: string } = {
      ...prev,
      now: new Date().toISOString(),
    };
    if (field === 'name') next.name = value ?? '';
    else if (field === 'definition') next.definition = value ?? '';
    else if (field === 'status') next.status = (value as MGtaConceptStatus) ?? 'draft';
    else if (field === 'categoryId') next.categoryId = value || undefined;
    if (
      prev.name === next.name &&
      prev.definition === next.definition &&
      prev.status === next.status &&
      prev.categoryId === next.categoryId
    )
      return;
    applyCommand(makeEditConceptCommand(concept.id, prev, next));
  };

  const handleDelete = () => {
    if (!confirm(`概念「${concept.name}」を削除しますか？ (Undo で復元できます)`)) return;
    applyCommand(makeDeleteConceptCommand(concept, variations));
    selectConcept(null);
  };

  const handleAddCardVariation = () => {
    const cardCode = prompt('追加するカードのコード（例: P01-001）');
    if (!cardCode) return;
    const card = project.data.cards.find((c) => c.code === cardCode);
    if (!card) {
      alert(`カードが見つかりません: ${cardCode}`);
      return;
    }
    applyCommand(
      makeAddVariationCommand(
        buildVariation({
          conceptId: concept.id,
          sourceType: 'card',
          sourceId: card.id,
          selectedTextSnapshot: card.body,
          role: 'variation',
          now: new Date().toISOString(),
        })
      )
    );
  };

  const handleAddFreeText = () => {
    const text = prompt('自由記述ヴァリエーション（例：「面接 X で語られた事例」）');
    if (!text) return;
    applyCommand(
      makeAddVariationCommand(
        buildVariation({
          conceptId: concept.id,
          sourceType: 'free_text',
          interpretation: text,
          role: 'variation',
          now: new Date().toISOString(),
        })
      )
    );
  };

  const handleAddMemo = () => {
    const body = prompt('理論的メモの内容');
    if (!body) return;
    applyCommand(
      makeCreateTheoreticalMemoCommand(
        buildTheoreticalMemo({
          methodKind: 'm_gta',
          targetType: 'concept',
          targetId: concept.id,
          memoType: 'idea',
          body,
          now: new Date().toISOString(),
        })
      )
    );
  };

  const handleChangeRole = (
    v: { id: string; role: MGtaVariationRole },
    role: MGtaVariationRole
  ) => {
    if (v.role === role) return;
    const orig = project.data.m_gta_variations.find((x) => x.id === v.id);
    if (!orig) return;
    // Use remove + add for simplicity (single command pair would be cleaner; we accept a 2-step undo here)
    applyCommand(makeRemoveVariationCommand(orig));
    applyCommand(
      makeAddVariationCommand({ ...orig, role })
    );
  };

  const variationCardName = (sourceId: string | undefined) => {
    if (!sourceId) return '(なし)';
    const c = project.data.cards.find((x) => x.id === sourceId);
    return c?.code ?? '(削除済み)';
  };

  return (
    <div className="mgta-worksheet">
      <section className="panel-section">
        <h3>概念ワークシート</h3>
        <label className="block-label">概念名</label>
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => commitField('name', draftName.trim())}
          placeholder="（概念名を入力）"
        />
        <label className="block-label">定義</label>
        <textarea
          value={draftDef}
          onChange={(e) => setDraftDef(e.target.value)}
          onBlur={() => commitField('definition', draftDef)}
          rows={4}
          placeholder="（概念の定義を入力）"
        />
        <label className="block-label">状態</label>
        <select
          value={concept.status}
          onChange={(e) => commitField('status', e.target.value)}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {CONCEPT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="block-label">カテゴリー</label>
        <select
          value={concept.categoryId ?? ''}
          onChange={(e) => commitField('categoryId', e.target.value || undefined)}
        >
          <option value="">（未割当）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {concept.derivedFromGroupId && (
          <div className="muted small" style={{ marginTop: 8 }}>
            派生元: KJ グループ {concept.derivedFromGroupId.slice(0, 8)}…
            <button
              type="button"
              className="segment-action-btn"
              onClick={() => {
                setMode('kj');
                // selectGroup not directly exposed here; user can find by id
              }}
              style={{ marginLeft: 8 }}
            >
              KJモードで確認
            </button>
          </div>
        )}
        <div className="right-actions">
          <button type="button" onClick={handleDelete} className="danger">
            概念を削除
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>ヴァリエーション ({variations.length})</h3>
        <div className="mgta-actions-row">
          <button type="button" onClick={handleAddCardVariation}>
            + カード参照
          </button>
          <button type="button" onClick={handleAddFreeText}>
            + 自由記述
          </button>
        </div>
        {variations.length === 0 ? (
          <div className="muted">まだヴァリエーションがありません</div>
        ) : (
          <ul className="mgta-variation-list">
            {variations.map((v) => (
              <li key={v.id} className="mgta-variation-item">
                <div className="mgta-variation-head">
                  <select
                    value={v.role}
                    onChange={(e) =>
                      handleChangeRole(v, e.target.value as MGtaVariationRole)
                    }
                  >
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {VARIATION_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <span className="muted small">
                    {v.sourceType === 'card'
                      ? `カード: ${variationCardName(v.sourceId)}`
                      : v.sourceType === 'free_text'
                        ? '自由記述'
                        : '原文セグメント'}
                  </span>
                  {v.sourceType === 'card' && v.sourceId && (
                    <button
                      type="button"
                      className="segment-action-btn"
                      onClick={() => {
                        setMode('kj');
                        selectCard(v.sourceId!);
                      }}
                    >
                      KJモードで表示
                    </button>
                  )}
                  <button
                    type="button"
                    className="segment-action-btn"
                    onClick={() => applyCommand(makeRemoveVariationCommand(v))}
                  >
                    削除
                  </button>
                </div>
                <div className="mgta-variation-body">
                  {v.selectedTextSnapshot || v.interpretation || '(空)'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h3>理論的メモ ({memos.length})</h3>
        <div className="mgta-actions-row">
          <button type="button" onClick={handleAddMemo}>+ メモ追加</button>
        </div>
        {memos.map((m) => (
          <MemoRow key={m.id} memo={m} />
        ))}
      </section>
    </div>
  );
}

function MemoRow({ memo }: { memo: TheoreticalMemo }) {
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [draft, setDraft] = useState(memo.body);
  useEffect(() => setDraft(memo.body), [memo.id, memo.body]);
  const commit = () => {
    if (draft === memo.body) return;
    applyCommand(
      makeEditTheoreticalMemoCommand(
        memo.id,
        { title: memo.title, body: memo.body, updatedAt: memo.updatedAt },
        { title: memo.title, body: draft, now: new Date().toISOString() }
      )
    );
  };
  return (
    <div className="mgta-memo-row">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={Math.max(2, Math.min(6, draft.split('\n').length))}
      />
      <div className="right-actions">
        <button
          type="button"
          className="segment-action-btn"
          onClick={() => applyCommand(makeDeleteTheoreticalMemoCommand(memo))}
        >
          削除
        </button>
      </div>
    </div>
  );
}

function MGtaExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [format, setFormat] = useState<'markdown' | 'csv'>('markdown');
  const settings = project ? getActiveSettings(project.data) : null;

  if (!project || !settings) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header"><h2>エクスポート</h2></header>
          <div className="modal-body">
            <p>先に分析設定を作成してください</p>
          </div>
          <footer className="modal-footer">
            <button type="button" onClick={onClose}>閉じる</button>
          </footer>
        </div>
      </div>
    );
  }

  const md = buildMarkdownExport(project.data, settings);
  const csv = buildCsvExport(project.data, settings);
  const text = format === 'markdown' ? md : csv;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    alert('クリップボードにコピーしました');
  };

  const handleDownload = () => {
    const ext = format === 'markdown' ? 'md' : 'csv';
    const mime = format === 'markdown' ? 'text/markdown' : 'text/csv';
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mgta-${settings.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <header className="modal-header">
          <h2>M-GTA エクスポート</h2>
        </header>
        <div className="modal-body">
          <div className="form-row">
            <label>形式</label>
            <div className="radio-row">
              <label>
                <input
                  type="radio"
                  name="fmt"
                  checked={format === 'markdown'}
                  onChange={() => setFormat('markdown')}
                />{' '}
                Markdown
              </label>
              <label>
                <input
                  type="radio"
                  name="fmt"
                  checked={format === 'csv'}
                  onChange={() => setFormat('csv')}
                />{' '}
                CSV
              </label>
            </div>
          </div>
          <label className="block-label">プレビュー</label>
          <pre
            style={{
              background: '#1a1a1a',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 8,
              maxHeight: 400,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: 12,
              margin: 0,
            }}
          >
            {text || '(出力する内容がありません)'}
          </pre>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>閉じる</button>
          <button type="button" onClick={handleCopy}>クリップボードにコピー</button>
          <button type="button" className="primary" onClick={handleDownload}>
            ダウンロード
          </button>
        </footer>
      </div>
    </div>
  );
}

function buildMarkdownExport(
  data: ReturnType<typeof useProjectStore.getState>['project'] extends infer P
    ? P extends { data: infer D }
      ? D
      : never
    : never,
  settings: { analysisTheme: string; focalPerson: string; researchQuestion?: string }
): string {
  const lines: string[] = [];
  lines.push(`# M-GTA 分析ワークシート`);
  lines.push(``);
  lines.push(`- 分析テーマ: ${settings.analysisTheme}`);
  lines.push(`- 分析焦点者: ${settings.focalPerson}`);
  if (settings.researchQuestion) lines.push(`- 研究問題: ${settings.researchQuestion}`);
  lines.push(``);
  lines.push(`## 概念一覧 (${data.m_gta_concepts.length})`);
  lines.push(``);
  for (const c of data.m_gta_concepts) {
    const cat = c.categoryId
      ? data.m_gta_categories.find((cat) => cat.id === c.categoryId)?.name
      : null;
    lines.push(`### ${c.name || '(無名)'}`);
    lines.push(``);
    lines.push(`- 状態: ${CONCEPT_STATUS_LABELS[c.status]}`);
    if (cat) lines.push(`- カテゴリー: ${cat}`);
    if (c.derivedFromGroupId) lines.push(`- 派生元 KJ グループ: ${c.derivedFromGroupId}`);
    lines.push(``);
    lines.push(`**定義**`);
    lines.push(``);
    lines.push(c.definition || '(未記入)');
    lines.push(``);
    const vars = data.m_gta_variations.filter((v) => v.conceptId === c.id);
    if (vars.length > 0) {
      lines.push(`**ヴァリエーション (${vars.length})**`);
      lines.push(``);
      for (const v of vars) {
        const head = VARIATION_ROLE_LABELS[v.role];
        const body = v.selectedTextSnapshot || v.interpretation || '';
        lines.push(`- [${head}] ${body.replace(/\n+/g, ' / ')}`);
      }
      lines.push(``);
    }
    const memos = data.theoretical_memos.filter(
      (m) => m.targetType === 'concept' && m.targetId === c.id
    );
    if (memos.length > 0) {
      lines.push(`**理論的メモ**`);
      lines.push(``);
      for (const m of memos) {
        lines.push(`> ${m.body.replace(/\n/g, '\n> ')}`);
        lines.push(``);
      }
    }
  }
  return lines.join('\n');
}

function buildCsvExport(
  data: ReturnType<typeof useProjectStore.getState>['project'] extends infer P
    ? P extends { data: infer D }
      ? D
      : never
    : never,
  settings: { analysisTheme: string; focalPerson: string }
): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(
    ['concept_id', 'name', 'status', 'category', 'definition', 'variation_role', 'variation_text']
      .map(esc)
      .join(',')
  );
  for (const c of data.m_gta_concepts) {
    const cat = c.categoryId
      ? data.m_gta_categories.find((cat) => cat.id === c.categoryId)?.name ?? ''
      : '';
    const vars = data.m_gta_variations.filter((v) => v.conceptId === c.id);
    if (vars.length === 0) {
      lines.push(
        [c.id, c.name, CONCEPT_STATUS_LABELS[c.status], cat, c.definition, '', '']
          .map(esc)
          .join(',')
      );
    } else {
      for (const v of vars) {
        const body = v.selectedTextSnapshot || v.interpretation || '';
        lines.push(
          [
            c.id,
            c.name,
            CONCEPT_STATUS_LABELS[c.status],
            cat,
            c.definition,
            VARIATION_ROLE_LABELS[v.role],
            body,
          ]
            .map(esc)
            .join(',')
        );
      }
    }
  }
  void settings;
  return lines.join('\n');
}
