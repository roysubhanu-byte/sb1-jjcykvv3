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
    const { transcript, audioFeatures, part, attemptId }: SpeakingScoreRequest = req.body;

    if (!transcript || !audioFeatures) {
      return res.status(400).json({ error: 'Missing transcript or audioFeatures' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `You are an EXTREMELY STRICT IELTS Speaking examiner. Use official band descriptors. Cap all bands at 6.5 for diagnostic.

Return ONLY JSON with:
{
  "bands": {
    "fluency_coherence": number,
    "lexical_resource": number,
    "grammatical_range": number,
    "pronunciation": number
  },
  "overall": number,
  "detailed_analysis": {
    "fluency": { "wpm": number, "wpm_band": "excellent|good|acceptable|weak", "filled_pauses": number, "pause_quality": "minimal|acceptable|excessive", "hesitation_level":"low|moderate|high" },
    "lexical": { "unique_words": number, "c2_words": string[], "phrasal_verbs": string[], "collocations": string[], "repetition_rate": number, "lexical_diversity": number },
    "grammar": { "complex_structures": number, "error_count": number, "error_examples": [{"error":"...","excerpt":"...","fix":"..."}], "sentence_variety": "excellent|good|limited|poor" },
    "pronunciation": { "articulation_rate": number, "clarity_estimate": "excellent|good|acceptable|unclear", "intonation_notes": string[] },
    "coherence": { "linking_devices": string[], "topic_development": string, "discourse_structure": "clear|adequate|weak" }
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

    const result = JSON.parse(content);

    // Round to 0.5 and cap at 6.5
    const rt = (n: number) => Math.min(6.5, Math.round(n * 2) / 2);
    result.bands.fluency_coherence = rt(result.bands.fluency_coherence);
    result.bands.lexical_resource = rt(result.bands.lexical_resource);
    result.bands.grammatical_range = rt(result.bands.grammatical_range);
    result.bands.pronunciation = rt(result.bands.pronunciation);
    result.overall = rt(
      (result.bands.fluency_coherence + result.bands.lexical_resource + result.bands.grammatical_range + result.bands.pronunciation) / 4
    );

    // Save to Supabase if requested
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
            feedback_json: result
          },
          { onConflict: 'attempt_id' }
        );
      if (error) console.error('Supabase insert error:', error);
    }

    res.json(result);
  } catch (err) {
    console.error('speaking score error:', err);
    res.status(500).json({ error: 'Scoring failed' });
  }
});

export default router;
