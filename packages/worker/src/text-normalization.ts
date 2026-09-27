/**
 * Repairs a common OCR/PDF text-layer artefact where characters are emitted as
 * separate tokens, for example `0 1 . 0 1 . 2 0 2 2`.
 *
 * Normal word spacing is preserved. Only runs containing at least three
 * single-character tokens are considered. Numeric runs are always repaired;
 * non-numeric runs need at least four tokens to avoid changing short phrases
 * such as `a b c` accidentally.
 */
export function normalizeOcrSpacing(text: string): string {
  return text.split('\n').map(normalizeLine).join('\n');
}

interface TextToken {
  start: number;
  end: number;
  value: string;
}

function normalizeLine(line: string): string {
  const tokens: TextToken[] = [...line.matchAll(/\S+/gu)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    value: match[0]
  }));

  if (tokens.length < 3) return line;

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  let index = 0;

  while (index < tokens.length) {
    if (!isSingleCharacterToken(tokens[index].value)) {
      index += 1;
      continue;
    }

    let end = index;
    while (end + 1 < tokens.length && isSingleCharacterToken(tokens[end + 1].value)) {
      end += 1;
    }

    const run = tokens.slice(index, end + 1);
    const joined = run.map((token) => token.value).join('');
    if (run.length >= 3 && shouldRepair(run, joined)) {
      replacements.push({
        start: run[0].start,
        end: run[run.length - 1].end,
        value: joined
      });
    }

    index = end + 1;
  }

  if (!replacements.length) return line;

  let result = '';
  let cursor = 0;
  for (const replacement of replacements) {
    result += line.slice(cursor, replacement.start);
    result += replacement.value;
    cursor = replacement.end;
  }
  return result + line.slice(cursor);
}

function isSingleCharacterToken(value: string): boolean {
  return Array.from(value).length === 1;
}

function shouldRepair(run: TextToken[], joined: string): boolean {
  return /\p{N}/u.test(joined) || run.length >= 4;
}
