/**
 * Transcript post-processing:
 * - deduplicate repeated lines (ASR sometimes repeats)
 * - compute audio features for scoring
 */

export interface Segment {
  start?: number;
  end?: number;
  text?: string;
}

function deduplicate(text: string): string {
  if (!text) return '';
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/([.!?])\s+/)
    .reduce<string[]>((acc, part, idx, arr) => {
      const chunk = (part + (/[.!?]/.test(arr[idx + 1] || '') ? (arr[idx + 1] || '') : '')).trim();
      if (!chunk) return acc;
      if (acc.length === 0 || acc[acc.length - 1].toLowerCase() !== chunk.toLowerCase()) {
        acc.push(chunk);
      }
      return acc;
    }, []);

  return parts.join(' ').replace(/\s+([,.!?;:])/g, '$1');
}

function countFillers(text: string): { count: number; fillers: string[] } {
  const fillerWords = ['um', 'uh', 'er', 'erm', 'like', 'you know', 'i mean', 'sort of', 'kind of'];
  const lowered = text.toLowerCase();
  let count = 0;
  const found: string[] = [];

  for (const f of fillerWords) {
    const re = new RegExp(`\\b${f.replace(' ', '\\s+')}\\b`, 'g');
    const matches = lowered.match(re);
    if (matches?.length) {
      count += matches.length;
      found.push(`${f}×${matches.length}`);
    }
  }
  return { count, fillers: found };
}

function sentenceCount(text: string): number {
  const s = text.split(/[.!?]+/).map(x => x.trim()).filter(Boolean);
  return s.length;
}

export function processTranscript(rawText: string, segments: Segment[]) {
  const text = deduplicate(rawText);

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentCount = sentenceCount(text);

  // estimate timings
  const totalDuration =
    segments?.length ? (segments.at(-1)?.end ?? 0) - (segments[0]?.start ?? 0) : Math.max(wordCount / 2.8, 1); // fallback

  // Features
  const wpm = totalDuration > 0 ? (wordCount / totalDuration) * 60 : 0;

  // Pauses
  let longPauseCount = 0;
  let pauseCount = 0;
  let pauseDurations: number[] = [];

  for (let i = 1; i < segments.length; i++) {
    const prevEnd = segments[i - 1]?.end ?? 0;
    const curStart = segments[i]?.start ?? 0;
    const gap = Math.max(0, curStart - prevEnd);
    if (gap > 0.2) {
      pauseCount++;
      pauseDurations.push(gap);
      if (gap >= 0.8) longPauseCount++;
    }
  }
  const meanPauseDuration = pauseDurations.length
    ? pauseDurations.reduce((a, b) => a + b, 0) / pauseDurations.length
    : 0;

  // Fillers
  const { count: fillerCount } = countFillers(text);
  const fillerPer100 = wordCount ? (fillerCount / wordCount) * 100 : 0;

  // Articulation rate ~ syllables/sec (rough estimate 1.4 syllables per word)
  const articulationRate = totalDuration > 0 ? (wordCount * 1.4) / totalDuration : 0;

  return {
    text,
    audioFeatures: {
      wpm: Number(wpm.toFixed(1)),
      fillerPer100: Number(fillerPer100.toFixed(2)),
      longPauseCount,
      pauseCount,
      meanPauseDuration: Number(meanPauseDuration.toFixed(2)),
      speechDuration: Number(totalDuration.toFixed(2)),
      articulationRate: Number(articulationRate.toFixed(2)),
      wordCount,
      sentenceCount: sentCount
    }
  };
}
