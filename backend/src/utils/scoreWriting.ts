import OpenAI from 'openai';

interface WritingScore {
  tr: number;
  cc: number;
  lr: number;
  gra: number;
  overall: number;
  feedback: string;
  actions: string[];
  rewrites: Array<{ from: string; to: string; reason: string }>;
  grammar_table: Array<{ issue: string; example: string; fix: string }>;
}

export async function scoreWriting(essayText: string): Promise<WritingScore> {
  try {
    console.log(
      'DEBUG (scoreWriting): OPENAI_API_KEY:',
      process.env.OPENAI_API_KEY ? 'Configured' : 'Missing'
    );

    if (!process.env.OPENAI_API_KEY) {
      return {
        tr: 6.0,
        cc: 6.0,
        lr: 6.0,
        gra: 6.0,
        overall: 6.0,
        feedback: 'AI scoring unavailable. Using fallback.',
        actions: ['Practice more essays', 'Focus on grammar', 'Expand vocabulary'],
        rewrites: [],
        grammar_table: []
      };
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an IELTS Writing examiner. Score TR, CC, LR, GRA (0–9, step 0.5). Return ONLY JSON:
{
  "tr": number,
  "cc": number,
  "lr": number,
  "gra": number,
  "overall": number,
  "feedback": "string",
  "actions": ["short imperative"],
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

    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error('No response from OpenAI');

    const parsed = JSON.parse(text);

    return {
      tr: parsed.tr ?? 6.0,
      cc: parsed.cc ?? 6.0,
      lr: parsed.lr ?? 6.0,
      gra: parsed.gra ?? 6.0,
      overall: parsed.overall ?? 6.0,
      feedback: parsed.feedback ?? 'Good effort on this essay.',
      actions: parsed.actions ?? ['Practice more essays', 'Focus on structure'],
      rewrites: parsed.rewrites ?? [],
      grammar_table: parsed.grammar_table ?? []
    };
  } catch (err) {
    console.error('Error scoring writing:', err);
    // ✅ FULL fallback to satisfy the interface
    return {
      tr: 6.0,
      cc: 6.0,
      lr: 6.0,
      gra: 6.0,
      overall: 6.0,
      feedback: 'Scoring fallback used due to an internal error or unavailable AI service.',
      actions: ['Rewrite body paragraphs using PEEL', 'Add numbers/examples', 'Fix article/SVA errors'],
      rewrites: [],
      grammar_table: []
    };
  }
}

