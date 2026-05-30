export const CURRENT_SCHEMA_VERSION = 9 as const;
export const MIN_SUPPORTED_SCHEMA_VERSION = 1 as const;

export type SchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// v9: 最終図解 (FinalDiagram) を ProjectMetadata に追加．Group に narrative を追加．
//     旧版 (v1〜v8) は ProjectMetadata.finalDiagram と Group.narrative が無いだけで
//     互換性は壊さない (両者 optional)．
