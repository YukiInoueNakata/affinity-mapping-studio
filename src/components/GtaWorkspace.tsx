import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../stores/projectStore.js';
import {
  buildCodeFromKjGroup,
  buildGtaCategory,
  buildGtaCode,
  getApplicationsForCode,
  getCodesForCategory,
  GTA_CODE_STATUS_LABELS,
  GTA_CODE_TYPE_LABELS,
  GtaError,
  nextCodeName,
} from '../domain/gta.js';
import { buildTheoreticalMemo } from '../domain/mgta.js';
import {
  makeCreateGtaCategoryCommand,
  makeCreateGtaCodeCommand,
  makeCreateTheoreticalMemoCommand,
  makeDeleteGtaCategoryCommand,
  makeDeleteGtaCodeCommand,
  makeDeleteTheoreticalMemoCommand,
  makeEditGtaCodeCommand,
  makeEditTheoreticalMemoCommand,
  makeRemoveGtaCodeApplicationCommand,
} from '../stores/commands.js';
import type {
  GtaCode,
  GtaCodeApplication,
  GtaCodeStatus,
  GtaCodeType,
  TheoreticalMemo,
} from '@shared/types/domain';
import { AnalyticDiagramView } from './AnalyticDiagramView.js';

const STATUS_ORDER: GtaCodeStatus[] = [
  'draft',
  'active',
  'reviewed',
  'merged',
  'rejected',
  'archived',
];

const CODE_TYPE_ORDER: GtaCodeType[] = [
  'open',
  'in_vivo',
  'focused',
  'axial',
  'selective',
  'custom',
];

export function GtaWorkspace() {
  const project = useProjectStore((s) => s.project);
  const selectedCodeId = useProjectStore((s) => s.selectedCodeId);
  const selectCode = useProjectStore((s) => s.selectCode);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const [exportOpen, setExportOpen] = useState(false);
  const [view, setView] = useState<'worksheet' | 'diagram'>('worksheet');

  const codes = useMemo(() => {
    if (!project) return [];
    return [...project.data.gta_codes].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
  }, [project]);

  const categories = useMemo(
    () => (project ? project.data.gta_categories : []),
    [project]
  );

  const selectedCode = useMemo(() => {
    if (!project || !selectedCodeId) return null;
    return project.data.gta_codes.find((c) => c.id === selectedCodeId) ?? null;
  }, [project, selectedCodeId]);

  if (!project) {
    return <div className="empty-state">プロジェクトを開いてください</div>;
  }

  const handleCreateCode = () => {
    const now = new Date().toISOString();
    const code = buildGtaCode({ name: nextCodeName(project.data), now });
    applyCommand(makeCreateGtaCodeCommand(code));
    selectCode(code.id);
  };

  const handleCreateCodeFromGroup = () => {
    const key = prompt('コード候補にする KJ グループ ID または名前');
    if (!key) return;
    const group =
      project.data.groups.find((g) => g.id === key) ??
      project.data.groups.find((g) => g.name === key);
    if (!group) {
      alert(`グループが見つかりません: ${key}`);
      return;
    }
    try {
      const code = buildCodeFromKjGroup(project.data, {
        groupId: group.id,
        now: new Date().toISOString(),
      });
      applyCommand(makeCreateGtaCodeCommand(code));
      selectCode(code.id);
    } catch (e) {
      if (e instanceof GtaError) alert(e.message);
      else throw e;
    }
  };

  const handleCreateCategory = () => {
    const name = prompt('カテゴリー名');
    if (!name) return;
    const now = new Date().toISOString();
    applyCommand(makeCreateGtaCategoryCommand(buildGtaCategory({ name, now })));
  };

  const groupedCodes = useMemo(() => {
    const map = new Map<string | null, GtaCode[]>();
    for (const c of codes) {
      const key = c.categoryId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [codes]);

  const coreCategories = categories.filter((c) => c.isCoreCategory);

  return (
    <div className="mgta-workspace">
      <header className="mgta-header">
        <div className="mgta-header-meta">
          <div className="mgta-header-row">
            <span className="mgta-header-label">GTA モード</span>
            <span className="mgta-header-value">
              コード数: {codes.length} / カテゴリー: {categories.length}
              {coreCategories.length > 0 && ` (コア: ${coreCategories.length})`}
            </span>
          </div>
          <div className="mgta-header-row">
            <span className="mgta-header-label muted small">
              ※ 流派テンプレートは Phase 1.5c では実装していません．コードタイプで区別してください
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
              関連図
            </button>
          </div>
          <button type="button" onClick={() => setExportOpen(true)}>
            エクスポート
          </button>
        </div>
      </header>

      {view === 'diagram' ? (
        <AnalyticDiagramView mode="gta" />
      ) : (
      <div className="mgta-body">
        <aside className="mgta-left">
          <section className="panel-section">
            <h3>コード ({codes.length})</h3>
            <div className="mgta-actions-row">
              <button type="button" onClick={handleCreateCode}>+ 新規コード</button>
              <button type="button" onClick={handleCreateCodeFromGroup}>
                KJグループから
              </button>
            </div>
            <ul className="mgta-concept-list">
              {Array.from(groupedCodes.entries()).map(([catId, cs]) => {
                const cat = catId ? categories.find((c) => c.id === catId) : null;
                return (
                  <li key={catId ?? 'none'} className="mgta-category-block">
                    <div className="mgta-category-name">
                      {cat ? (
                        <>
                          {cat.name}
                          {cat.isCoreCategory && (
                            <span className="gta-core-badge">コア</span>
                          )}
                        </>
                      ) : (
                        '(未カテゴリー)'
                      )}
                    </div>
                    <ul className="mgta-concept-sublist">
                      {cs.map((c) => (
                        <li
                          key={c.id}
                          className={c.id === selectedCodeId ? 'active' : ''}
                          onClick={() => selectCode(c.id)}
                        >
                          <span className="mgta-concept-name">{c.name || '(無名)'}</span>
                          <span className={`mgta-concept-status status-${c.status}`}>
                            {GTA_CODE_STATUS_LABELS[c.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
              {codes.length === 0 && <li className="muted">(まだコードがありません)</li>}
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
          {selectedCode ? (
            <CodeWorksheet codeId={selectedCode.id} />
          ) : (
            <div className="empty-state">左からコードを選ぶか、新規作成してください</div>
          )}
        </section>
      </div>
      )}

      {exportOpen && <GtaExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function CodeWorksheet({ codeId }: { codeId: string }) {
  const project = useProjectStore((s) => s.project);
  const applyCommand = useProjectStore((s) => s.applyCommand);
  const selectCode = useProjectStore((s) => s.selectCode);
  const setMode = useProjectStore((s) => s.setMode);
  const selectCard = useProjectStore((s) => s.selectCard);
  const selectSegment = useProjectStore((s) => s.selectSegment);

  const code = useMemo(() => {
    if (!project) return null;
    return project.data.gta_codes.find((c) => c.id === codeId) ?? null;
  }, [project, codeId]);

  const applications = useMemo(() => {
    if (!project || !code) return [];
    return getApplicationsForCode(project.data, code.id);
  }, [project, code]);

  const categories = useMemo(() => (project ? project.data.gta_categories : []), [
    project,
  ]);

  const memos = useMemo(() => {
    if (!project || !code) return [];
    return project.data.theoretical_memos.filter(
      (m) => m.targetType === 'code' && m.targetId === code.id
    );
  }, [project, code]);

  const [draftName, setDraftName] = useState('');
  const [draftDef, setDraftDef] = useState('');

  useEffect(() => {
    setDraftName(code?.name ?? '');
    setDraftDef(code?.definition ?? '');
  }, [code?.id, code?.name, code?.definition]);

  if (!code || !project) return <div className="empty-state">コードが見つかりません</div>;

  const commitField = (
    field: 'name' | 'definition' | 'codeType' | 'status' | 'categoryId',
    value: string | undefined
  ) => {
    if (!code) return;
    const prev = {
      name: code.name,
      definition: code.definition,
      codeType: code.codeType,
      categoryId: code.categoryId,
      status: code.status,
      updatedAt: code.updatedAt,
    };
    const next: typeof prev & { now: string } = {
      ...prev,
      now: new Date().toISOString(),
    };
    if (field === 'name') next.name = value ?? '';
    else if (field === 'definition') next.definition = value;
    else if (field === 'codeType') next.codeType = (value as GtaCodeType) ?? 'open';
    else if (field === 'status') next.status = (value as GtaCodeStatus) ?? 'draft';
    else if (field === 'categoryId') next.categoryId = value || undefined;
    if (
      prev.name === next.name &&
      prev.definition === next.definition &&
      prev.codeType === next.codeType &&
      prev.status === next.status &&
      prev.categoryId === next.categoryId
    )
      return;
    applyCommand(makeEditGtaCodeCommand(code.id, prev, next));
  };

  const handleDelete = () => {
    if (!code) return;
    if (
      !confirm(
        `コード「${code.name}」を削除しますか？ 付与済み ${applications.length} 件も削除されます (Undo で復元可)`
      )
    )
      return;
    applyCommand(makeDeleteGtaCodeCommand(code, applications));
    selectCode(null);
  };

  const handleAddComparisonMemo = () => {
    const body = prompt(
      '比較メモ（A: / B: / 共通点: / 相違点: / 解釈: / 次に確認すべき: の形式推奨）'
    );
    if (!body) return;
    applyCommand(
      makeCreateTheoreticalMemoCommand(
        buildTheoreticalMemo({
          methodKind: 'gta',
          targetType: 'code',
          targetId: code.id,
          memoType: 'comparison',
          body,
          now: new Date().toISOString(),
        })
      )
    );
  };

  const handleAddSaturationMemo = () => {
    const body = prompt('飽和判断メモ');
    if (!body) return;
    applyCommand(
      makeCreateTheoreticalMemoCommand(
        buildTheoreticalMemo({
          methodKind: 'gta',
          targetType: 'code',
          targetId: code.id,
          memoType: 'saturation',
          body,
          now: new Date().toISOString(),
        })
      )
    );
  };

  const targetName = (a: GtaCodeApplication) => {
    if (a.targetType === 'card') {
      const c = project.data.cards.find((x) => x.id === a.targetId);
      return c?.code ?? '(削除済み)';
    }
    if (a.targetType === 'source_segment') {
      const s = project.data.source_segments.find((x) => x.id === a.targetId);
      return s ? `${s.sourceFile} #${s.order + 1}` : '(削除済み)';
    }
    return '(範囲)';
  };

  return (
    <div className="mgta-worksheet">
      <section className="panel-section">
        <h3>コード詳細</h3>
        <label className="block-label">コード名</label>
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => commitField('name', draftName.trim())}
        />
        <label className="block-label">定義</label>
        <textarea
          value={draftDef}
          onChange={(e) => setDraftDef(e.target.value)}
          onBlur={() => commitField('definition', draftDef)}
          rows={4}
        />
        <label className="block-label">コードタイプ</label>
        <select
          value={code.codeType}
          onChange={(e) => commitField('codeType', e.target.value)}
        >
          {CODE_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {GTA_CODE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="block-label">状態</label>
        <select
          value={code.status}
          onChange={(e) => commitField('status', e.target.value)}
        >
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {GTA_CODE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="block-label">カテゴリー</label>
        <select
          value={code.categoryId ?? ''}
          onChange={(e) => commitField('categoryId', e.target.value || undefined)}
        >
          <option value="">（未割当）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isCoreCategory ? ' [コア]' : ''}
            </option>
          ))}
        </select>
        <div className="right-actions">
          <button type="button" onClick={handleDelete} className="danger">
            コードを削除
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>適用箇所 ({applications.length})</h3>
        <p className="muted small">
          コード付与は KJ モードの「カード詳細」または「原文ビューア」から行ってください．
        </p>
        {applications.length === 0 ? (
          <div className="muted">まだ付与がありません</div>
        ) : (
          <ul className="mgta-variation-list">
            {applications.map((a) => (
              <li key={a.id} className="mgta-variation-item">
                <div className="mgta-variation-head">
                  <span className="muted small">
                    {a.targetType === 'card'
                      ? 'カード'
                      : a.targetType === 'source_segment'
                        ? '原文'
                        : '範囲'}
                    : {targetName(a)}
                  </span>
                  <button
                    type="button"
                    className="segment-action-btn"
                    onClick={() => {
                      setMode('kj');
                      if (a.targetType === 'card') selectCard(a.targetId);
                      else if (a.targetType === 'source_segment')
                        selectSegment(a.targetId);
                    }}
                  >
                    KJモードで表示
                  </button>
                  <button
                    type="button"
                    className="segment-action-btn"
                    onClick={() => applyCommand(makeRemoveGtaCodeApplicationCommand(a))}
                  >
                    解除
                  </button>
                </div>
                {a.selectedTextSnapshot && (
                  <div className="mgta-variation-body">{a.selectedTextSnapshot}</div>
                )}
                {a.memo && (
                  <div className="muted small" style={{ marginTop: 4 }}>
                    メモ: {a.memo}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h3>メモ ({memos.length})</h3>
        <div className="mgta-actions-row">
          <button type="button" onClick={handleAddComparisonMemo}>
            + 継続的比較メモ
          </button>
          <button type="button" onClick={handleAddSaturationMemo}>
            + 飽和判断メモ
          </button>
        </div>
        {memos.map((m) => (
          <CodeMemoRow key={m.id} memo={m} />
        ))}
      </section>
    </div>
  );
}

function CodeMemoRow({ memo }: { memo: TheoreticalMemo }) {
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
      <div className="muted small">
        [{memoTypeLabel(memo.memoType)}] {memo.updatedAt.slice(0, 16).replace('T', ' ')}
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        rows={Math.max(2, Math.min(8, draft.split('\n').length))}
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

function memoTypeLabel(t: TheoreticalMemo['memoType']): string {
  switch (t) {
    case 'comparison':
      return '比較';
    case 'saturation':
      return '飽和';
    case 'sampling':
      return '理論的サンプリング';
    case 'idea':
      return '着想';
    default:
      return t;
  }
}

function GtaExportDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [format, setFormat] = useState<'markdown' | 'csv'>('markdown');

  if (!project) return null;
  const md = buildGtaMarkdown(project.data);
  const csv = buildGtaCsv(project.data);
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
    a.download = `gta-codebook.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720 }}>
        <header className="modal-header">
          <h2>GTA コードブックエクスポート</h2>
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

function buildGtaMarkdown(
  data: ReturnType<typeof useProjectStore.getState>['project'] extends infer P
    ? P extends { data: infer D }
      ? D
      : never
    : never
): string {
  const lines: string[] = [];
  lines.push('# GTA コードブック');
  lines.push('');
  lines.push(`コード数: ${data.gta_codes.length} / カテゴリー: ${data.gta_categories.length}`);
  lines.push('');
  if (data.gta_categories.length > 0) {
    lines.push('## カテゴリー一覧');
    lines.push('');
    for (const cat of data.gta_categories) {
      lines.push(`### ${cat.name}${cat.isCoreCategory ? ' [コアカテゴリー]' : ''}`);
      lines.push('');
      if (cat.definition) {
        lines.push(cat.definition);
        lines.push('');
      }
    }
  }
  lines.push('## コード一覧');
  lines.push('');
  for (const c of data.gta_codes) {
    const cat = c.categoryId
      ? data.gta_categories.find((x) => x.id === c.categoryId)?.name
      : null;
    lines.push(`### ${c.name}`);
    lines.push('');
    lines.push(`- タイプ: ${GTA_CODE_TYPE_LABELS[c.codeType]}`);
    lines.push(`- 状態: ${GTA_CODE_STATUS_LABELS[c.status]}`);
    if (cat) lines.push(`- カテゴリー: ${cat}`);
    lines.push('');
    if (c.definition) {
      lines.push(`**定義**`);
      lines.push('');
      lines.push(c.definition);
      lines.push('');
    }
    const apps = data.gta_code_applications.filter((a) => a.codeId === c.id);
    if (apps.length > 0) {
      lines.push(`**適用箇所 (${apps.length})**`);
      lines.push('');
      for (const a of apps) {
        const body = a.selectedTextSnapshot || a.memo || '';
        lines.push(`- [${a.targetType}] ${body.replace(/\n+/g, ' / ')}`);
      }
      lines.push('');
    }
    const memos = data.theoretical_memos.filter(
      (m) => m.targetType === 'code' && m.targetId === c.id
    );
    if (memos.length > 0) {
      lines.push(`**メモ**`);
      lines.push('');
      for (const m of memos) {
        lines.push(`> [${m.memoType}] ${m.body.replace(/\n/g, '\n> ')}`);
        lines.push('');
      }
    }
  }
  return lines.join('\n');
}

function buildGtaCsv(
  data: ReturnType<typeof useProjectStore.getState>['project'] extends infer P
    ? P extends { data: infer D }
      ? D
      : never
    : never
): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(
    [
      'code_id',
      'name',
      'code_type',
      'status',
      'category',
      'definition',
      'target_type',
      'target_id',
      'target_text',
    ]
      .map(esc)
      .join(',')
  );
  for (const c of data.gta_codes) {
    const cat = c.categoryId
      ? data.gta_categories.find((x) => x.id === c.categoryId)?.name ?? ''
      : '';
    const apps = data.gta_code_applications.filter((a) => a.codeId === c.id);
    if (apps.length === 0) {
      lines.push(
        [
          c.id,
          c.name,
          GTA_CODE_TYPE_LABELS[c.codeType],
          GTA_CODE_STATUS_LABELS[c.status],
          cat,
          c.definition ?? '',
          '',
          '',
          '',
        ]
          .map(esc)
          .join(',')
      );
    } else {
      for (const a of apps) {
        lines.push(
          [
            c.id,
            c.name,
            GTA_CODE_TYPE_LABELS[c.codeType],
            GTA_CODE_STATUS_LABELS[c.status],
            cat,
            c.definition ?? '',
            a.targetType,
            a.targetId,
            a.selectedTextSnapshot ?? '',
          ]
            .map(esc)
            .join(',')
        );
      }
    }
  }
  return lines.join('\n');
}
