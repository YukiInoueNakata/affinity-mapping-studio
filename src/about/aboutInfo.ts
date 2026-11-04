// 「このソフトについて」に出す情報 (版・作者・引用文)．
// 方法の文献 (METHOD_REFERENCES) は，書誌を確かめたものだけを載せる．推測で足さない．
// 2026-11-04 に確認: 川喜田 1967・1986 は NDL サーチ，田中 2011 は DOI と J-STAGE の目次．
// 川喜田 1997 (KJ法入門コーステキスト 4.0) は NDL に所蔵が無く原典未確認のため載せない．

export const APP_NAME = 'Affinity Mapping Studio';
export const REPO_URL = 'https://github.com/YukiInoueNakata/affinity-mapping-studio';
export const WEBPAGE_URL = 'https://yukiinouenakata.github.io/';
export const LICENSE_NAME = 'Apache License 2.0';

export const AUTHOR = {
  nameJa: '中田 友貴',
  nameEn: 'Yuki Inoue Nakata',
  affiliationJa: '立命館大学 総合心理学部',
  affiliationEn: 'College of Comprehensive Psychology, Ritsumeikan University',
};

export interface CitationText {
  id: string;
  label: string;
  text: string;
}

/** ソフトウェア自体の引用文．版と年はビルドから入る． */
export function softwareCitations(version: string, year: string): CitationText[] {
  return [
    {
      id: 'apa',
      label: 'APA 第 7 版（英語）',
      text: `Nakata, Y. I. (${year}). ${APP_NAME} (Version ${version}) [Computer software]. ${REPO_URL}`,
    },
    {
      id: 'ja',
      label: '日本語の原稿',
      text: `中田 友貴 (${year}). ${APP_NAME} (Version ${version}) [Computer software]. ${REPO_URL}`,
    },
    {
      id: 'bibtex',
      label: 'BibTeX',
      text: [
        `@software{nakata_affinity_mapping_studio_${year},`,
        `  author  = {Nakata, Yuki Inoue},`,
        `  title   = {${APP_NAME}},`,
        `  version = {${version}},`,
        `  year    = {${year}},`,
        `  url     = {${REPO_URL}}`,
        `}`,
      ].join('\n'),
    },
  ];
}

/** 方法の文献 (KJ 法)．書誌を確かめてから足す． */
export const METHOD_REFERENCES: CitationText[] = [
  {
    id: 'kawakita1967',
    label: '川喜田 (1967)',
    text: '川喜田 二郎 (1967). 発想法：創造性開発のために 中央公論社',
  },
  {
    id: 'kawakita1986',
    label: '川喜田 (1986)',
    text: '川喜田 二郎 (1986). KJ法：渾沌をして語らしめる 中央公論社',
  },
  {
    id: 'tanaka2011',
    label: '田中 (2011)',
    text: '田中 博晃 (2011). KJ法入門：質的データ分析法としてKJ法を行う前に メソドロジー研究部会報告論集, 1, 17–29. https://doi.org/10.69194/methodologysig.1.02',
  },
];
