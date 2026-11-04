import { describe, expect, it } from 'vitest';
import { splitSentences } from '../sentences.js';

// 以前の書き方（後読み）．Node は後読みを使えるので，結果が同じかを比べる．
const legacy = (t: string) => t.split(/(?<=[。．！？!?])\s*|(?<=\.)\s+/u);

describe('splitSentences', () => {
  const cases = [
    '',
    '一文だけ',
    '朝は楽しい。昼も楽しい。',
    '朝は楽しい。 昼も楽しい。夜は眠い',
    '本当？ うん！ そうだね。。終わり',
    'Hello world. This is a test.No split here. End',
    'Wait!Really?Yes. ok',
    '全角．句点．\n改行のあと。',
    '  前後に空白。  ',
    'a.b.c 3.14 は円周率. 次',
    '絵文字なし😀の文。次の文',
  ];
  for (const c of cases) {
    it(`以前の結果と同じ: ${JSON.stringify(c)}`, () => {
      expect(splitSentences(c)).toEqual(legacy(c));
    });
  }

  it('この版のソースに後読みが残っていない', () => {
    expect(splitSentences.toString()).not.toMatch(/\(\?<[=!]/);
  });
});
