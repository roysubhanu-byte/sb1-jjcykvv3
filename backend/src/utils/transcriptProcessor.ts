// src/utils/transcriptProcessor.ts
// Transcript post-processing utilities: deduplication, filler cleanup, capitalization,
// sentence splitting, and simple metrics.

export interface ProcessedTranscript {
  text: string;
  sentences: string[];
  wordCount: number;
  fillerWords: string[];
  fillerCount: number;
}

/**
 * Deduplicate sentences that appear multiple times or as near-duplicates.
 */
export function deduplicateSentences(text: string): string {
  if (!text || !text.trim()) return '';
  const compact = text.replace(/\s+/g, ' ').trim();

  const parts = compact
    .split(/(?<=[.!?])\s+/)   // split after ., !, ?
    .map(s => s.trim())
    .filter(Boolean);

  const dedup: string[] = [];

  for (const sentence of parts) {
    const norm = sentence.toLowerCase().trim();
    if (!norm) continue;

    const last = dedup[dedup.length - 1] || '';
    const lastNorm = last.toLowerCase().trim();

    // exact duplicate
    if (norm === lastNorm) continue;

    // near-duplicate (prefix/contains/overlap)
    if (
      lastNorm &&
      (
        norm.startsWith(lastNorm) ||
        lastNorm.startsWith(norm) ||
        (norm.includes(lastNorm) && norm.length < lastNorm.length * 1.5)
      )
    ) {
      // keep the longer one
      if (norm.length > lastNorm.length) {
        dedup[dedup.length - 1] = sentence;
      }
      continue;
    }

    dedup.push(sentence);
  }

  return dedup.join(' ').trim();
}

/**
 * Collapse runs of repeated fillers (um, uh, you know, like, I mean, etc.)
 */
export function normalizeFillers(text: string): string {
  if (!text) return '';

  // master filler pattern
  const fillerPattern = /\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b/gi;

  // collapse sequences like "um, um, um" or "uh uh"
  const run = new RegExp(
    String.raw`\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b(?:[\s,.-]{0,3}\b\1\b){1,}`,
    'gi'
  );

  let out = text.replace(run, (m) => {
    const first = m.match(fillerPattern);
    return first ? first[0] : m;
  });

  // clean extra spaces
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Fix simple capitalization and spacing around punctuation.
 */
export function fixCapitalization(text: string): string {
  if (!text) return '';
  let result = text.trim();

  // Capitalize first letter if alphabetic
  result = result.replace(/^[a-z]/, (c) => c.toUpperCase());

  // Capitalize letter after sentence enders
  result = result.replace(/([.!?])\s+([a-z])/g, (_m, punct: string, letter: string) => {
    return `${punct} ${letter.toUpperCase()}`;
  });

  // Capitalize standalone "i"
  result = result.replace(/\bi\b/g, 'I');

  // Fix spaces around punctuation
  result = result.replace(/\s+([,.!?;:])/g, '$1'); // remove space before punctuation
  result = result.replace(/([.!?])\s*/g, '$1 ');   // ensure space after enders

  return result.trim();
}

/**
 * Extract filler words for reporting.
 */
export function extractFillers(text: string): string[] {
  if (!text) return [];
  const fillerPattern = /\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b/gi;
  const matches = text.match(fillerPattern);
  return matches ? matches.map(m => m.toLowerCase()) : [];
}

/**
 * Full processing pipeline with basic metrics.
 */
export function processTranscript(rawText: string): ProcessedTranscript {
  if (!rawText || !rawText.trim()) {
    return {
      text: '',
      sentences: [],
      wordCount: 0,
      fillerWords: [],
      fillerCount: 0
    };
  }

  // Extract fillers first
  const fillerWords = extractFillers(rawText);

  // Pipeline
  let processed = rawText;
  processed = deduplicateSentences(processed);
  processed = normalizeFillers(processed);
  processed = fixCapitalization(processed);

  // Sentence split (simple heuristic)
  const sentences = processed
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  // Word count
  const words = processed.match(/\b[\w']+\b/g) || [];
  const wordCount = words.length;

  return {
    text: processed,
    sentences,
    wordCount,
    fillerWords,
    fillerCount: fillerWords.length
  };
}
