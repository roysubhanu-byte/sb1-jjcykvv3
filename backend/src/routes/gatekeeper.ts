import express from 'express';
import OpenAI from 'openai';

const router = express.Router();

interface GatekeeperRequest {
  task_type: 'writing_t1' | 'writing_t2' | 'speaking';
  prompt_text: string;
  candidate_text: string;
  min_words_override?: number | null;
}

interface GatekeeperResponse {
  result: 'ok' | 'reject_off_topic' | 'needs_rewrite' | 'suspected_template';
  reason: string;
  measures: {
    word_count: number;
    topic_relevance_0_100: number;
    coverage_flags: {
      addresses_all_parts: boolean;
      clear_position: boolean;
    };
    template_signals: string[];
  };
}

router.post('/check', async (req, res) => {
  try {
    const {
      task_type,
      prompt_text,
      candidate_text,
      min_words_override
    }: GatekeeperRequest = req.body;

    if (!task_type || !prompt_text || !candidate_text) {
      return res.status(400).json({ 
        error: 'Missing required fields: task_type, prompt_text, candidate_text' 
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured on server' 
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an IELTS task gatekeeper. Decide if the candidate's response is on-topic and eligible for scoring.

Rules:
- Writing Task 2 minimum words: 250 (Task 1: 150). Speaking: ignore wordcount.
- Reject if response is off-topic, mostly copied, or obviously templated (generic memorized intros with no task-specific details).
- Return STRICT JSON (no markdown, no extra text).

Input:
- task_type: one of ["writing_t1","writing_t2","speaking"]
- prompt_text: ${prompt_text}
- candidate_text: ${candidate_text}
- min_words_override (optional): ${min_words_override}

Output JSON schema:
{
  "result": "ok" | "reject_off_topic" | "needs_rewrite" | "suspected_template",
  "reason": "string, short",
  "measures": {
    "word_count": number,
    "topic_relevance_0_100": number,
    "coverage_flags": { "addresses_all_parts": boolean, "clear_position": boolean },
    "template_signals": [ "string", ... ]
  }
}

Decision logic:
- If task_type starts with "writing" and word_count < required => result="needs_rewrite".
- If topic_relevance_0_100 < 55 OR addresses_all_parts=false => result="reject_off_topic".
- If heavy templating cues (e.g., "This is a very controversial topic…", "In a nutshell…") => result="suspected_template".
- Otherwise => result="ok".

Now produce ONLY the JSON.`;

    const userPrompt = JSON.stringify({
      task_type,
      prompt_text,
      candidate_text,
      min_words_override
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) return res.status(500).json({ error: 'No response from gatekeeper AI' });

    let gatekeeperResult: GatekeeperResponse;
    try {
      gatekeeperResult = JSON.parse(responseText);
    } catch {
      console.error('Gatekeeper JSON parse failed:', responseText);
      return res.status(500).json({ error: 'Invalid response format from gatekeeper AI' });
    }

    if (!gatekeeperResult.result || !gatekeeperResult.reason || !gatekeeperResult.measures) {
      return res.status(500).json({ error: 'Incomplete gatekeeper response' });
    }

    res.json(gatekeeperResult);
  } catch (error) {
    console.error('Error in gatekeeper route:', error);
    res.status(500).json({ error: 'Internal server error during gatekeeper check' });
  }
});

export { router as gatekeeperRouter };
