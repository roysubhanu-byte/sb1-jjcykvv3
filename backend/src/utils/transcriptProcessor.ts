/**
 * Transcript post-processing utilities
 * Handles deduplication, normalization, and cleaning
 */

export interface ProcessedTranscript {
  text: string;
  sentences: string[];
  wordCount: number;
  fillerWords: string[];
  fillerCount: number;
}

/**
 * Deduplicate sentences that appear multiple times
 * Handles cases like "I think I think I think that..."
 */
export function deduplicateSentences(text: string): string {
  if (!text || !text.trim()) return '';

  // Normalize whitespace
  const compact = text.replace(/\s+/g, ' ').trim();

  // Split by sentence enders, keeping punctuation
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

    // Skip exact duplicates
    if (normalized === lastNorm) continue;

    // Skip near-duplicates (one starts with the other, or overlap)
    if (
      lastNorm &&
      (
        normalized.startsWith(lastNorm) ||
        lastNorm.startsWith(normalized) ||
        (normalized.includes(lastNorm) && normalized.length < lastNorm.length * 1.5)
      )
    ) {
      // Keep the longer sentence
      if (normalized.length > lastNorm.length) {
        deduplicated[deduplicated.length - 1] = sentence;
      }
      continue;
    }

    deduplicated.push(sentence);
  }

  return deduplicated.join(' ').trim();
}

/**
 * Normalize filler words - collapse runs of repeated fillers
 * Example: "um um um ... uh uh" -> "um ... uh"
 */
export function normalizeFillers(text: string): string {
  if (!text) return '';

  // Master filler pattern (global, case-insensitive)
  const fillerPattern = /\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b/gi;

  // 1) Collapse three-or-more repeats of the SAME filler to a single instance
  //    Do this by repeatedly replacing 2+ consecutive same fillers down to one.
  let out = text;
  // Replace sequences like: "um , um , um" or "um um" (allow light punctuation/spaces between)
  const run = new RegExp(
    String.raw`\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b(?:[\s,.-]{0,3}\b\1\b){1,}`, // one or more repeats
    'gi'
  );
  out = out.replace(run, (m) => {
    // keep the first occurrence only
    const first = m.match(fillerPattern);
    return first ? first[0] : m;
  });

  // 2) Clean extra spaces
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

/**
 * Fix sentence casing and punctuation
 */
export function fixCapitalization(text: string): string {
  if (!text) return '';

  let result = text.trim();

  // Capitalize first letter if alphabetic
  result = result.replace(/^[a-z]/, (c) => c.toUpperCase());

  // Capitalize after sentence endings
  result = result.replace(/([.!?])\s+([a-z])/g, (_m, punct: string, letter: string) => {
    return `${punct} ${letter.toUpperCase()}`;
  });

  // Capitalize standalone "i"
  result = result.replace(/\bi\b/g, 'I');

  // Fix spaces around punctuation
  result = result.replace(/\s+([,.!?;:])/g, '$1'); // remove space before punctuation
  result = result.replace(/([.!?])\s*/g, '$1 ');   // ensure exactly one space after enders

  return result.trim();
}

/**
 * Extract filler words for analysis
 */
export function extractFillers(text: string): string[] {
  if (!text) return [];
  const fillerPattern = /\b(um+|uh+|er+|ah+|hmm+|you know|like|I mean)\b/gi;
  const matches = text.match(fillerPattern);
  return matches ? matches.map(m => m.toLowerCase()) : [];
}

/**
 * Complete transcript processing pipeline
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

  // Extract fillers before processing
  const fillerWords = extractFillers(rawText);

  // Processing pipeline
  let processed = rawText;
  processed = deduplicateSentences(processed);
  processed = normalizeFillers(processed);
  processed = fixCapitalization(processed);

  // Split into sentences (simple heuristic)
  const sentences = processed
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  // Count words
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
