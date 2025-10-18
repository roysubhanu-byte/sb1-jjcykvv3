export interface ProcessedTranscript {
  text: string;
  sentences: string[];
  wordCount: number;
  fillerWords: string[];
  fillerCount: number;
}

export function deduplicateSentences(text: string): string {
  if (!text || !text.trim()) return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  const parts = compact
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const deduplicated: string[] = [];
  for (const sentence of parts) {
    const normalized = sentence.toLowerCase().trim();
    if (!normalized) continue;

    const last = deduplicated[deduplicated.length - 1] || '';
    const lastNorm = last.toLowerCase().trim();

    if (normalized === lastNorm) continue;

    if (
      lastNorm &&
      (normalized.startsWith(lastNorm) ||
        lastNorm.startsWith(normalized) ||
        (normalized.includes(lastNorm) && normalized.length < lastNorm.length * 1.5))
    ) {
      if (normalized.length > lastNorm.length) {
        deduplicated[deduplicated.length - 1] = sentence;
      }
      continue;
    }
    deduplicated.push(sentence);
  }
  return deduplicated.join(' ').trim();
}

export function normalizeFillers(text: string): string {
  if (!text) return '';
  const fillerPattern = /\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b/gi;
  const run = new RegExp(
    String.raw`\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b(?:[\s,.-]{0,3}\b\1\b){1,}`,
    'gi'
  );
  let out = text.replace(run, (m) => {
    const first = m.match(fillerPattern);
    return first ? first[0] : m;
  });
  return out.replace(/\s+/g, ' ').trim();
}

export function fixCapitalization(text: string): string {
  if (!text) return '';
  let result = text.trim();
  result = result.replace(/^[a-z]/, (c) => c.toUpperCase());
  result = result.replace(/([.!?])\s+([a-z])/g, (_m, punct: string, letter: string) => `${punct} ${letter.toUpperCase()}`);
  result = result.replace(/\bi\b/g, 'I');
  result = result.replace(/\s+([,.!?;:])/g, '$1');
  result = result.replace(/([.!?])\s*/g, '$1 ');
  return result.trim();
}

export function extractFillers(text: string): string[] {
  if (!text) return [];
  const fillerPattern = /\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b/gi;
  const matches = text.match(fillerPattern);
  return matches ? matches.map(m => m.toLowerCase()) : [];
}

export function processTranscript(rawText: string): ProcessedTranscript {
  if (!rawText || !rawText.trim()) {
    return { text: '', sentences: [], wordCount: 0, fillerWords: [], fillerCount: 0 };
  }
  const fillerWords = extractFillers(rawText);
  let processed = rawText;
  processed = deduplicateSentences(processed);
  processed = normalizeFillers(processed);
  processed = fixCapitalization(processed);

  const sentences = processed
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const words = processed.match(/\b[\w']+\b/g) || [];
  return {
    text: processed,
    sentences,
    wordCount: words.length,
    fillerWords,
    fillerCount: fillerWords.length
  };
}
