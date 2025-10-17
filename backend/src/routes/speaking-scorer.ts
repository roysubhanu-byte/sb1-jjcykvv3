// backend/src/routes/speaking-scorer.ts
import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

type Part = 1 | 2 | 3;

interface SpeakingScoreRequest {
  transcript: string;
  audioFeatures: {
    wpm: number;
    fillerPer100: number;
    longPauseCount: number;
    pauseCount: number;
    meanPauseDuration: number;
    speechDuration: number;
    articulationRate: number;
    wordCount: number;
    sentenceCount: number;
  };
  part: Part;
  attemptId?: string;
}

router.post('/score', async (req, res) => {
  try {
    const { transcript, audioFeatures, part, attemptId } = req.body as SpeakingScoreRequest;

    // Basic validation
    if (!transcript || !audioFeatures || !part) {
      return res.status(400).json({ error: 'Missing transcript, audioFeatures, or part' });
    }
    if (![1, 2, 3].includes(Number(part))) {
      return res.status(400).json({ error: 'Invalid part. Must be 1, 2, or 3.' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an EXTREMELY STRICT IELTS Speaking examiner. Use ONLY official band descriptors. Cap all bands at 6.5 for this diagnostic. Return STRICT JSON only.

Schema:
{
  "bands": {
    "fluency_coherence": number,
    "lexical_resource": number,
    "grammatical_range": number,
    "pronunciation": number
  },
  "overall": number,
  "detailed_analysis": {
    "fluency": { "wpm": number, "wpm_band": "excellent"|"good"|"acceptable"|"weak", "filled_pauses": number, "pause_quality": "minimal"|"acceptable"|"excessive", "hesitation_level":"low"|"moderate"|"high" },
    "lexical": { "unique_words": number, "c2_words": string[], "phrasal_verbs": string[], "collocations": string[], "repetition_rate": number, "lexical_diversity": number },
    "grammar": { "complex_structures": number, "error_count": number, "error_examples": [{"error":"...","excerpt":"...","fix":"..."}], "sentence_variety": "excellent"|"good"|"limited"|"poor" },
    "pronunciation": { "articulation_rate": number, "clarity_estimate": "excellent"|"good"|"acceptable"|"unclear", "intonation_notes": string[] },
    "coherence": { "linking_devices": string[], "topic_development": string, "discourse_structure": "clear"|"adequate"|"weak" }
  },
  "penalties_applied": {
    "fluency_penalties": [{"reason":"...","penalty":0.5}],
    "lexical_penalties": [{"reason":"...","penalty":0.5}],
    "grammar_penalties": [{"reason":"...","penalty":0.2}],
    "pronunciation_penalties": [{"reason":"...","penalty":0.5}]
  },
  "rewards_applied": {
    "lexical_rewards": [{"reason":"...","reward":0.5}],
    "grammar_rewards": [{"reason":"...","reward":0.5}]
  },
  "feedback_bullets": string[],
  "improvements": string[]
}`;

    const userPrompt = JSON.stringify({
      transcript,
      audioFeatures,
      part,
      task_context:
        part === 1 ? 'Introduction and Interview'
        : part === 2 ? 'Individual Long Turn (2 minutes)'
        : 'Two-way Discussion'
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 3200,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return res.status(500).json({ error: 'No response from AI' });

    let result: any;
    try {
      result = JSON.parse(content);
    } catch {
      return res.status(500).json({ error: 'Invalid JSON from AI' });
    }

    // Round to 0.5 and cap at 6.5
    const roundHalf = (n: number) => Math.round(n * 2) / 2;
    const cap65 = (n: number) => Math.min(6.5, n);

    result.bands = result.bands || {};
    result.bands.fluency_coherence = cap65(roundHalf(result.bands.fluency_coherence ?? 5.5));
    result.bands.lexical_resource  = cap65(roundHalf(result.bands.lexical_resource ?? 5.5));
    result.bands.grammatical_range = cap65(roundHalf(result.bands.grammatical_range ?? 5.5));
    result.bands.pronunciation     = cap65(roundHalf(result.bands.pronunciation ?? 5.5));

    result.overall = cap65(
      roundHalf(
        ((result.bands.fluency_coherence ?? 5.5) +
         (result.bands.lexical_resource ?? 5.5) +
         (result.bands.grammatical_range ?? 5.5) +
         (result.bands.pronunciation ?? 5.5)) / 4
      )
    );

    // Optional: save to Supabase
    if (attemptId) {
      const supabase = createClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { autoRefreshToken: false, persistSession: false } }
      );

      const { error } = await supabase
        .from('speaking_attempts')
        .upsert(
          {
            attempt_id: attemptId,
            transcript,
            wpm: audioFeatures.wpm,
            filled_pause_rate: audioFeatures.fillerPer100,
            band: result.overall,
            feedback_json: result,
            created_at: new Date().toISOString()
          },
          { onConflict: 'attempt_id' }
        );

      if (error) {
        // Don’t block the response—just log it
        console.error('Supabase insert error (speaking_attempts):', error);
      }
    }

    res.json(result);
  } catch (err) {
    console.error('speaking-scorer error:', err);
    res.status(500).json({ error: 'Scoring failed' });
  }
});

export default router;
