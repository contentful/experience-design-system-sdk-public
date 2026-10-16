interface MatchResult {
  score: number;
}

function match(query: string, text: string): MatchResult | null {
  if (query.length === 0) return { score: 0 };
  if (text.length === 0) return null;

  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  let score = 0;
  let qi = 0;
  let lastMatchIndex = -2;

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (textLower[ti] === queryLower[qi]) {
      score += 10;

      if (text[ti] === query[qi]) {
        score += 5;
      }

      if (ti === 0 && qi === 0) {
        score += 15;
      }

      if (ti === lastMatchIndex + 1) {
        score += 5;
      }

      lastMatchIndex = ti;
      qi++;
    }
  }

  if (qi < query.length) return null;

  score -= text.length * 0.1;

  return { score };
}

export function fuzzyMatches(query: string, text: string): boolean {
  return match(query, text) !== null;
}
