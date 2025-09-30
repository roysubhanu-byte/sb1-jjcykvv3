import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

interface ScoreWritingRequest {
  task_prompt: string;
  module: 'Academic' | 'General';
  task_type: 'Task 1' | 'Task 2';
  essay_text: string;
  word_count: number;
  attempt_id: string | null;
}

interface ScoreWritingResponse {
  tr: number;
  cc: number;
  lr: number;
  gra: number;
  band_overall: number;
  on_topic_percent: number;
  off_topic: boolean;
  word_count: number;
  evidence_quotes: string[];
  grammar_error_count: number;
  grammar_examples: Array<{
    error: string;
    excerpt: string;
    fix: string;
  }>;
  cohesion_issues: string[];
  lexical_notes: string[];
  repetition_notes: string[];
  template_likelihood: number;
  feedback_bullets: string[];
  improvements: string[];
}

router.post('/score-writing', async (req, res) => {
  try {
    const {
      task_prompt,
      module,
      task_type,
      essay_text,
      word_count,
      attempt_id
    }: ScoreWritingRequest = req.body;

    // Validation
    if (!task_prompt || !module || !task_type || !essay_text) {
      return res.status(400).json({ 
        error: 'Missing required fields: task_prompt, module, task_type, essay_text' 
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured on server' 
      });
    }

    // Initialize OpenAI client here, inside the handler
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Supabase client here, inside the handler
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const minRequiredWords = task_type === "Task 2" ? 250 : 150;

    // Construct the strict IELTS grading prompt
    const systemPrompt = `You are an EXTREMELY STRICT IELTS Writing examiner. Evaluate IELTS Writing using official band descriptors with ZERO tolerance for poor performance.

You will receive:
- task_prompt (the exact question)
- module (Academic|General)
- task_type (Task 1|Task 2)
- essay_text
- word_count
- min_required_words

Strict rules:
1) Do NOT reward length beyond the minimum; length itself must not raise bands.
2) Judge Task Response ONLY against task_prompt. If mostly off-topic:
   - set off_topic=true
   - on_topic_percent ≤ 50
   - cap band_overall at 3.0 (the client may also cap)
3) If word_count < min_required_words: cap band_overall at 5.0 (the client may also cap).
4) Grammar very weak throughout: cap at 4.0.
5) Basic vocabulary only: cap at 5.0.
6) Repetition (ideas/phrases) severe: reduce 0.5–1.0.
7) Suspected memorised/template intro (e.g., "People have different opinions…", "In the modern world…") → note and reduce up to 0.5 if formulaic >20%.
8) Use 0.5 increments for TR/CC/LR/GRA and band_overall. Compute band_overall as average(TR,CC,LR,GRA) then apply caps/reductions above.

Return ONLY compact JSON with this schema:
{
  "tr": number,             // Task Response
  "cc": number,             // Coherence & Cohesion
  "lr": number,             // Lexical Resource
  "gra": number,            // Grammatical Range & Accuracy
  "band_overall": number,   // after caps/penalties
  "on_topic_percent": number,     // 0-100
  "off_topic": boolean,
  "word_count": number,
  "evidence_quotes": [ "short phrase showing task relevance", "..." ],
  "grammar_error_count": number,  // approximate
  "grammar_examples": [ { "error": "…", "excerpt": "…", "fix": "…" } ],
  "cohesion_issues": [ "…" ],
  "lexical_notes": [ "…" ],
  "repetition_notes": [ "…" ],
  "template_likelihood": number,  // 0..1
  "feedback_bullets": [ "…", "…" ],
  "improvements": [ "short imperative actions" ]
}`;

    const userPrompt = JSON.stringify({
      task_prompt,
      module,
      task_type,
      essay_text,
      word_count,
      min_required_words: minRequiredWords
    });

    // Call OpenAI with strict JSON format
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" }
      });
    } catch (openaiError) {
      console.error('OpenAI API error:', openaiError);
      return res.status(500).json({ 
        error: 'AI scoring service unavailable' 
      });
    }

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      return res.status(500).json({ 
        error: 'No response from AI scoring service' 
      });
    }

    // Parse JSON response with retry logic
    let scoringResult: ScoreWritingResponse;
    try {
      scoringResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('JSON parse failed, retrying with explicit instruction:', responseText);
      
      // Retry with explicit JSON instruction
      try {
        const retryCompletion = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt + '\n\nReturn JSON only. No additional text.' },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_tokens: 2000,
          response_format: { type: "json_object" }
        });

        const retryResponseText = retryCompletion.choices[0]?.message?.content;
        if (!retryResponseText) {
          throw new Error('No response from retry attempt');
        }

        scoringResult = JSON.parse(retryResponseText);
      } catch (retryError) {
        console.error('Retry also failed:', retryError);
        return res.status(500).json({ 
          error: 'AI response format error' 
        });
      }
    }

    // Server-side post-processing and safety caps
    let { band_overall, tr, cc, lr, gra, off_topic, on_topic_percent } = scoringResult;

    // Apply strict caps
    if (off_topic === true || (on_topic_percent && on_topic_percent <= 50)) {
      band_overall = Math.min(band_overall, 3.0);
      off_topic = true;
    }

    if (word_count < minRequiredWords) {
      band_overall = Math.min(band_overall, 5.0);
    }

    // Cap all writing scores at 6.5 maximum
    band_overall = Math.min(band_overall, 6.5);
    tr = Math.min(tr, 6.5);
    cc = Math.min(cc, 6.5);
    lr = Math.min(lr, 6.5);
    gra = Math.min(gra, 6.5);

    // Round all bands to nearest 0.5
    const roundToHalf = (num: number) => Math.round(num * 2) / 2;
    tr = roundToHalf(tr);
    cc = roundToHalf(cc);
    lr = roundToHalf(lr);
    gra = roundToHalf(gra);
    band_overall = roundToHalf(band_overall);

    // Update the scoring result with processed values
    const finalResult: ScoreWritingResponse = {
      ...scoringResult,
      tr,
      cc,
      lr,
      gra,
      band_overall,
      off_topic: off_topic || false,
      on_topic_percent: on_topic_percent || 100,
      word_count
    };

    // Store in Supabase
    if (attempt_id) {
      const taskNumber = task_type === 'Task 1' ? 1 : 2;
      
      const { error: insertError } = await supabase
        .from('writing_submissions')
        .upsert({
          attempt_id,
          task: taskNumber,
          text_md: essay_text,
          word_count,
          band: finalResult.band_overall,
          feedback_json: finalResult,
          on_topic_percent: finalResult.on_topic_percent ?? null,
          off_topic: finalResult.off_topic ?? null,
          grammar_error_count: finalResult.grammar_error_count ?? null,
          template_likelihood: finalResult.template_likelihood ?? null,
          gatekeeper_result: 'ok', // Assume ok if we reach full scoring
          gatekeeper_reason: 'Passed gatekeeper check',
          created_at: new Date().toISOString()
        }, { onConflict: 'attempt_id,task' });

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        return res.status(500).json({ 
          error: 'Failed to save scoring results' 
        });
      }
    }

    // Return the processed result
    res.json(finalResult);

  } catch (error) {
    console.error('Error in score-writing route:', error);
    res.status(500).json({ 
      error: 'Internal server error during scoring' 
    });
  }
});

export { router as scoreWritingRouter };