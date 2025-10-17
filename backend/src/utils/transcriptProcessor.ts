export interface Segment {
  start?: number;
  end?: number;
  text?: string;
}

// Remove repeated sentences/phrases and normalize punctuation
function deduplicate(text: string): string {
  if (!text) return '';
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/([.!?])\s+/)
    .reduce<string[]>((acc, part, idx, arr) => {
      const nextPunct = /[.!?]/.test(arr[idx + 1] || '') ? (arr[idx + 1] || '') : '';
      const chunk = (part + nextPunct).trim();
      if (!chunk) return acc;
      if (acc.length === 0 || acc[acc.length - 1].toLowerCase() !== chunk.toLowerCase()) {
        acc.push(chunk);
      }
      return acc;
    }, []);

  return parts.join(' ').replace(/\s+([,.!?;:])/g, '$1');
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).length;
}

function countFillers(text: string) {
  const list = ['um', 'uh', 'er', 'erm', 'like', 'you know', 'i mean', 'sort of', 'kind of'];
  const lower = text.toLowerCase();
  let count = 0;
  for (const f of list) {
    const re = new RegExp(`\\b${f.replace(' ', '\\s+')}\\b`, 'g');
    count += lower.match(re)?.length || 0;
  }
  return count;
}

export function processTranscript(rawText: string, segments: Segment[]) {
  const text = deduplicate(rawText);

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentenceCountVal = sentenceCount(text);

  // Estimate duration from segments (fallback if missing)
  let totalDuration = 0;
  if (segments && segments.length > 0) {
    const firstStart = segments[0]?.start ?? 0;
    const lastEnd = segments[segments.length - 1]?.end ?? 0; // ← no .at()
    totalDuration = Math.max(0, lastEnd - firstStart);
  } else {
    // crude fallback: ~2.8 words/sec speaking rate
    totalDuration = Math.max(wordCount / 2.8, 1);
  }

  // Pauses
  let longPauseCount = 0;
  let pauseCount = 0;
  const pauseDur: number[] = [];
  for (let i = 1; i < (segments?.length || 0); i++) {
    const gap = Math.max(0, (segments[i].start ?? 0) - (segments[i - 1].end ?? 0));
    if (gap > 0.2) {
      pauseCount++;
      pauseDur.push(gap);
      if (gap >= 0.8) longPauseCount++;
    }
  }
  const meanPauseDuration = pauseDur.length ? pauseDur.reduce((a, b) => a + b, 0) / pauseDur.length : 0;

  // Features
  const wpm = totalDuration > 0 ? (wordCount / totalDuration) * 60 : 0;
  const fillerCount = countFillers(text);
  const fillerPer100 = wordCount ? (fillerCount / wordCount) * 100 : 0;
  const articulationRate = totalDuration > 0 ? (wordCount * 1.4) / totalDuration : 0; // rough syll/sec

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
      sentenceCount: sentenceCountVal,
    },
  };
}
