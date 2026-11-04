/**
 * 文（句点）ごとに分ける．句点は前の文に残し，後ろの空白は捨てる．
 * 「。．！？!?」の後ろは空白が無くても切り，半角の「.」は後ろに空白があるときだけ切る．
 *
 * 以前は `text.split(/(?<=[。．！？!?])\s*|(?<=\.)\s+/u)` と書いていたが，後読み
 * （`(?<=...)`）は Safari 16.4 より古い WebKit では構文エラーになる．macOS 12 の
 * アプリの WebView はそれにあたり，読み込みの時点で JavaScript 全体が止まって
 * 画面が真っ白になった（2026-11-04 macbookpro で確認）．後読みを使わずに同じ結果を返す．
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[。．！？!?]\s*|\.\s+/gu;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // String.split と同じく，文字列の末尾ちょうどでは切らない（空の文を作らない）．
    if (m.index + 1 >= text.length) break;
    // 句点はどれも 1 文字．句点までを前の文に入れ，続く空白は捨てる．
    out.push(text.slice(start, m.index + 1));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out;
}
