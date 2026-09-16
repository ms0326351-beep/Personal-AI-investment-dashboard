/**
 * Deterministic keyword matching — no AI. Given a piece of text and a map of
 * id -> alias keywords, returns the ids whose alias appears in the text.
 * English aliases match case-insensitively as whole words; CJK aliases match
 * as plain substrings (CJK text has no word boundaries to anchor on).
 */
export function matchAliasesInText(text: string, aliasesById: Record<string, string[]>): string[] {
  const haystack = text;
  const haystackLower = haystack.toLowerCase();
  const matched: string[] = [];
  for (const [id, aliases] of Object.entries(aliasesById)) {
    const hit = aliases.some(alias => {
      if (!alias) return false;
      const isCjk = /[一-鿿]/.test(alias);
      if (isCjk) return haystack.includes(alias);
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(haystackLower);
    });
    if (hit) matched.push(id);
  }
  return matched;
}
