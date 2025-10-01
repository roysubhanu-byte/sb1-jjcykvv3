import OpenAI from 'openai';

interface WritingScore {
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

export async function scoreWriting(essayText: string): Promise<WritingScore> {
  try {
    console.log(
      'DEBUG (scoreWriting): OPENAI_API_KEY:',
      process.env.OPENAI_API_KEY ? '(configured)' : '(missing)'
    );

    // If no key, return a deterministic fallback with ALL required fields
    if (!process.env.OPENAI_API_KEY) {
      return {
        tr: 6.0,
        cc: 6.0,
        lr: 6.0,
        gra: 6.0,
        overall: 6.0,
        feedback:
          'AI scoring unavailable on server. Returning a sample score for development.',
        actions: [
          'Write one timed essay (40 min).',
          'Plan 5 minutes before writing.',
          'Review and fix grammar after writing.'
        ],
        rewrites: [],
        grammar_table: []
      };
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an IELTS Writing examiner. Score TR, CC, LR, GRA using IELTS public band descriptors. Be STRICT and return ONLY JSON with keys:
{
  "tr": number,
  "cc": number,
  "lr": number,
  "gra": number,
  "overall": number,
  "feedback": "string",
  "actions": ["short imperative items"],
  "rewrites": [{"from":"...","to":"...","reason":"..."}],
  "grammar_table": [{"issue":"...","example":"...","fix":"..."}]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Score this IELTS Writing Task 2 essay:\n\n${essayText}` }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('No response content from OpenAI');

    const parsed = JSON.parse(content);

    // Ensure all fields exist with sensible defaults
    const result: WritingScore = {
      tr: numberOr(parsed.tr, 6.0),
      cc: numberOr(parsed.cc, 6.0),
      lr: numberOr(parsed.lr, 6.0),
      gra: numberOr(parsed.gra, 6.0),
      overall: numberOr(parsed.overall, average4(parsed.tr, parsed.cc, parsed.lr, parsed.gra, 6.0)),
      feedback: stringOr(parsed.feedback, 'Good effort. Focus on structure and clarity.'),
      actions: arrayOr(parsed.actions, ['Plan 5 minutes', 'Write clearly structured paragraphs']),
      rewrites: arrayOr(parsed.rewrites, []),
      grammar_table: arrayOr(parsed.grammar_table, [])
    };

    return result;
  } catch (err) {
    console.error('Error in scoreWriting:', err);

    // Fallback MUST include every property from WritingScore
    return {
      tr: 6.0,
      cc: 6.0,
      lr: 6.0,
      gra: 6.0,
      overall: 6.0,
      feedback:
        'Temporary scoring fallback due to an internal error. Try again shortly.',
      actions: [
        'Rewrite introduction with a clear thesis.',
        'Add examples to each body paragraph.',
        'Proofread for grammar mistakes.'
      ],
      rewrites: [],
      grammar_table: []
    };
  }
}

// ---------- tiny helpers ----------
function numberOr(v: any, d: number): number {
  return typeof v === 'number' ? v : d;
}
function stringOr(v: any, d: string): string {
  return typeof v === 'string' ? v : d;
}
function arrayOr<T>(v: any, d: T[]): T[] {
  return Array.isArray(v) ? v : d;
}
function average4(a: any, b: any, c: any, d: any, def = 6): number {
  const vals = [a, b, c, d].map((x) => (typeof x === 'number' ? x : def));
  return Math.round(((vals[0] + vals[1] + vals[2] + vals[3]) / 4) * 2) / 2;
}
