import OpenAI from 'openai';

export interface WritingScore {
  tr: number;
  cc: number;
  lr: number;
  gra: number;
  overall: number;
  feedback: string;
  actions: string[];
  rewrites: Array<{
    from: string;
    to: string;
    reason: string;
  }>;
  grammar_table: Array<{
    issue: string;
    example: string;
    fix: string;
  }>;
}

const roundToHalf = (n: number) => Math.round(n * 2) / 2;

const SAFE_FALLBACK: WritingScore = {
  tr: 6.0,
  cc: 6.0,
  lr: 6.0,
  gra: 6.0,
  overall: 6.0,
  feedback:
    "Automated scoring fallback used. Focus on: (1) clear thesis & addressing all parts (TR), (2) paragraph structure with strong topic sentences & cohesive devices (CC), (3) precise academic vocabulary with fewer repetitions (LR), (4) complex but accurate sentences; fix agreement/punctuation (GRA).",
  actions: [
    "Plan 4-paragraph structure before writing (intro, 2 body, conclusion).",
    "Use at least 6 varied cohesive devices (however, moreover, consequently…).",
    "Replace basic words (important→crucial, show→demonstrate).",
    "Write 5 complex sentences daily; check for subject–verb agreement.",
  ],
  rewrites: [],
  grammar_table: [],
};

export async function scoreWriting(essayText: string): Promise<WritingScore> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      // No API key → safe fallback
      return SAFE_FALLBACK;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are a STRICT IELTS Writing examiner. Score TR (Task Response), CC (Coherence & Cohesion), LR (Lexical Resource), GRA (Grammatical Range & Accuracy) on 0–9 in 0.5 increments.

CRITICAL SCORING CRITERIA - BE HARSH AND REALISTIC:

LEXICAL RESOURCE (LR) - Vocabulary Assessment:
Band 9: C2-level vocabulary, sophisticated phrasal verbs, idiomatic expressions, zero errors
Band 8: C1-level words, less common lexis, rare errors
Band 7: Good range, some less common words, few errors
Band 6: Adequate range, attempts less common words, some errors
Band 5: Limited range, repetitive basic vocabulary
Band 4: Very limited vocabulary, frequent repetition, basic words only

PENALIZE HEAVILY FOR:
- Only common words → MAX Band 4.0
- No phrasal verbs → reduce LR by ~1.5 bands
- No C2/C1 vocabulary → MAX Band 5.0
- Repetitive vocabulary → reduce by 1–2 bands

GRAMMATICAL RANGE & ACCURACY (GRA):
Band 9: Full flexibility, rare errors, complex structures
Band 8: Wide range, rare errors
Band 7: Variety of complex structures, good control
Band 6: Mix of simple/complex, some errors
Band 5: Limited complex structures, frequent errors
Band 4: Basic structures only, many errors

COHERENCE & COHESION (CC):
Penalize weak paragraphing, no clear thesis, missing/abused cohesive devices.

TASK RESPONSE (TR):
Penalize partial addressing, missing position, underdevelopment.

COUNT & REPORT (for feedback):
- C2/C1 vocabulary found
- Phrasal verbs found
- Linking words found
- Complex vs simple sentences (estimate)
- Grammar errors with examples
- Punctuation/comma errors

Return STRICT JSON:
{
  "tr": number, "cc": number, "lr": number, "gra": number, "overall": number,
  "feedback": "string",
  "c2_word_count": number, "c2_words_found": ["..."],
  "phrasal_verb_count": number, "phrasal_verbs_found": ["..."],
  "linking_word_count": number, "linking_words_found": ["..."],
  "grammar_error_count": number,
  "actions": ["..."],
  "rewrites": [{"from":"...","to":"...","reason":"..."}],
  "grammar_table": [{"issue":"...","example":"...","fix":"..."}]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Score this IELTS Writing Task 2 essay:\n\n${essayText}` },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 1800,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return SAFE_FALLBACK;

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // One retry with explicit JSON-only instruction
      const retry = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt + '\nReturn JSON ONLY, no prose.' },
          { role: 'user', content: `Score this IELTS Writing Task 2 essay:\n\n${essayText}` },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 1800,
      });
      const retryRaw = retry.choices[0]?.message?.content;
      if (!retryRaw) return SAFE_FALLBACK;
      try {
        parsed = JSON.parse(retryRaw);
      } catch {
        return SAFE_FALLBACK;
      }
    }

    // Guard numbers + round to 0.5
    const tr = roundToHalf(typeof parsed.tr === 'number' ? parsed.tr : 6.0);
    const cc = roundToHalf(typeof parsed.cc === 'number' ? parsed.cc : 6.0);
    const lr = roundToHalf(typeof parsed.lr === 'number' ? parsed.lr : 6.0);
    const gra = roundToHalf(typeof parsed.gra === 'number' ? parsed.gra : 6.0);
    const overall = roundToHalf(
      typeof parsed.overall === 'number' ? parsed.overall : (tr + cc + lr + gra) / 4
    );

    const result: WritingScore = {
      tr,
      cc,
      lr,
      gra,
      overall,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : SAFE_FALLBACK.feedback,
      actions: Array.isArray(parsed.actions) ? parsed.actions : SAFE_FALLBACK.actions,
      rewrites: Array.isArray(parsed.rewrites) ? parsed.rewrites : [],
      grammar_table: Array.isArray(parsed.grammar_table) ? parsed.grammar_table : [],
    };

    return result;
  } catch (err) {
    console.error('Error scoring writing:', err);
    return SAFE_FALLBACK;
  }
}
