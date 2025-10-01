import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

interface DetailedScoringRequest {
  task_type: "writing_t1" | "writing_t2";
  prompt_text: string;
  essay_text: string;
  consistency_check?: boolean;
  target_band?: number | null;
  measured_features: {
    word_count: number;
    paragraph_count: number;
    sentence_variety_counts: { simple: number; compound: number; complex: number };
    cohesive_devices_per_100w: number;
    lexical_diversity_ttr_0_1: number;
    rare_academic_terms: string[];
    grammar_error_density_per_100w: number;
    template_cues: string[];
    synonym_inflation_score_0_100: number;
  };
  attempt_id?: string;
}

interface DetailedScoringResponse {
  result: "band" | "needs_rewrite" | "reject_off_topic" | "suspected_ai_generated";
  overall_band: number;
  criterion_bands: { TR: number; CC: number; LR: number; GRA: number };
  justifications: {
    TR: string;
    CC: string;
    LR: string;
    GRA: string;
  };
  measured_features: {
    word_count: number;
    paragraph_count: number;
    topic_relevance_0_100: number;
    task_requirements: { 
      addresses_all_parts: boolean; 
      clear_position: boolean; 
      overview_or_conclusion_present: boolean;
    };
    cohesive_devices_per_100w: number;
    lexical_diversity_ttr_0_1: number;
    rare_academic_terms: string[];
    grammar_error_density_per_100w: number;
    sentence_variety_counts: { simple: number; compound: number; complex: number };
    template_cues: string[];
    synonym_inflation_score_0_100: number;
  };
  next_steps: {
    three_point_plan: string[];
    micro_drills: Array<{
      name: string;
      instructions: string;
    }>;
  };
  evidence_quotes: {
    TR: string[];
    CC: string[];
    LR: string[];
    GRA: string[];
  };
  confidence: {
    band_low: number;
    band_high: number;
    stability_sigma: number;
  };
  notes_internal_if_consistency_check_true?: string;
}

router.post('/detailed-scoring', async (req, res) => {
  try {
    const {
      task_type,
      prompt_text,
      essay_text,
      consistency_check = false,
      target_band = null,
      measured_features,
      attempt_id
    }: DetailedScoringRequest = req.body;

    // Validation
    if (!task_type || !prompt_text || !essay_text || !measured_features) {
      return res.status(400).json({ 
        error: 'Missing required fields: task_type, prompt_text, essay_text, measured_features' 
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured on server' 
      });
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Supabase client
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

    // Construct the detailed IELTS grading prompt
    const systemPrompt = `You are an IELTS Writing examiner. Grade ONLY per the public band descriptors.
Return STRICT JSON; no markdown, no extra text.

Input:
- task_type: "${task_type}"
- prompt_text: ${prompt_text}
- essay_text: ${essay_text}
- consistency_check: ${consistency_check}
- target_band: ${target_band}

Scoring rules:
- Criteria: TR (Task Response), CC (Coherence & Cohesion), LR (Lexical Resource), GRA (Grammar Range & Accuracy).
- Penalize: off-prompt content, <250 words (T2) / <150 (T1), obvious template reuse, synonym inflation, repetition.
- Do NOT award 7.0+ if word_count < required or if task is partially addressed.

Pre-calculated features (use these for accuracy):
- word_count: ${measured_features.word_count}
- paragraph_count: ${measured_features.paragraph_count}
- sentence_variety_counts: ${JSON.stringify(measured_features.sentence_variety_counts)}
- cohesive_devices_per_100w: ${measured_features.cohesive_devices_per_100w}
- lexical_diversity_ttr_0_1: ${measured_features.lexical_diversity_ttr_0_1}
- rare_academic_terms: ${JSON.stringify(measured_features.rare_academic_terms)}
- grammar_error_density_per_100w: ${measured_features.grammar_error_density_per_100w}
- template_cues: ${JSON.stringify(measured_features.template_cues)}
- synonym_inflation_score_0_100: ${measured_features.synonym_inflation_score_0_100}

Output JSON schema:
{
  "result": "band" | "needs_rewrite" | "reject_off_topic" | "suspected_ai_generated",
  "overall_band": number,
  "criterion_bands": { "TR": number, "CC": number, "LR": number, "GRA": number },
  "justifications": {
    "TR": "≤220 chars, specific to prompt",
    "CC": "≤220 chars",
    "LR": "≤220 chars",
    "GRA": "≤220 chars"
  },
  "measured_features": {
    "word_count": number,
    "paragraph_count": number,
    "topic_relevance_0_100": number,
    "task_requirements": { "addresses_all_parts": boolean, "clear_position": boolean, "overview_or_conclusion_present": boolean },
    "cohesive_devices_per_100w": number,
    "lexical_diversity_ttr_0_1": number,
    "rare_academic_terms": [ "string", ... ],
    "grammar_error_density_per_100w": number,
    "sentence_variety_counts": { "simple": number, "compound": number, "complex": number },
    "template_cues": [ "string", ... ],
    "synonym_inflation_score_0_100": number
  },
  "next_steps": {
    "three_point_plan": [ "actionable step 1", "actionable step 2", "actionable step 3" ],
    "micro_drills": [
      { "name": "10-min Thesis+Plan", "instructions": "2-sentence stance + 2 body points; timebox 10 min" },
      { "name": "Linker Ladder", "instructions": "Replace 3 basic linkers with concessive and resultive forms" }
    ]
  },
  "evidence_quotes": {
    "TR": [ "short snippet from essay proving/violating TR" ],
    "CC": [ "…" ],
    "LR": [ "…" ],
    "GRA": [ "…" ]
  },
  "confidence": {
    "band_low": number,
    "band_high": number,
    "stability_sigma": number
  },
  "notes_internal_if_consistency_check_true": "omit or provide brief stability cues when consistency_check=true"
}

Process:
1) Compute measured_features first.
2) Map features → criterion bands using IELTS public descriptors; justify briefly.
3) Compute overall_band as the mean rounded to nearest 0.5.
4) Set confidence range wider if features disagree.
5) If essay clearly off-prompt, return result="reject_off_topic". If too short, result="needs_rewrite".
6) Keep language concise, concrete, and tied to descriptors.

Now output ONLY the JSON.`;

    // Call OpenAI with the detailed prompt
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Grade this ${task_type} essay according to IELTS band descriptors.` }
      ],
      temperature: 0.2,
      max_tokens: 3000,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      return res.status(500).json({ 
        error: 'No response from detailed scoring AI' 
      });
    }

    // Parse JSON response
    let scoringResult: DetailedScoringResponse;
    try {
      scoringResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Detailed scoring JSON parse failed:', responseText);
      return res.status(500).json({ 
        error: 'Invalid response format from detailed scoring AI' 
      });
    }

    // Validate response structure
    if (!scoringResult.overall_band || !scoringResult.criterion_bands) {
      return res.status(500).json({ 
        error: 'Incomplete detailed scoring response' 
      });
    }

    // Apply server-side caps and post-processing
    let { overall_band, criterion_bands } = scoringResult;
    const minWords = task_type === "writing_t2" ? 250 : 150;

    // Apply strict caps
    if (measured_features.word_count < minWords) {
      overall_band = Math.min(overall_band, 5.0);
    }

    if (scoringResult.measured_features?.topic_relevance_0_100 && 
        scoringResult.measured_features.topic_relevance_0_100 < 55) {
      overall_band = Math.min(overall_band, 3.0);
    }

    // Cap all writing scores at 6.5 maximum
    overall_band = Math.min(overall_band, 6.5);
    criterion_bands.TR = Math.min(criterion_bands.TR, 6.5);
    criterion_bands.CC = Math.min(criterion_bands.CC, 6.5);
    criterion_bands.LR = Math.min(criterion_bands.LR, 6.5);
    criterion_bands.GRA = Math.min(criterion_bands.GRA, 6.5);

    // Round to nearest 0.5
    const roundToHalf = (num: number) => Math.round(num * 2) / 2;
    overall_band = roundToHalf(overall_band);
    criterion_bands.TR = roundToHalf(criterion_bands.TR);
    criterion_bands.CC = Math.round(criterion_bands.CC * 2) / 2;
    criterion_bands.LR = Math.round(criterion_bands.LR * 2) / 2;
    criterion_bands.GRA = Math.round(criterion_bands.GRA * 2) / 2;

    // Update the result with processed values
    const finalResult: DetailedScoringResponse = {
      ...scoringResult,
      overall_band,
      criterion_bands
    };

    // Store detailed results in Supabase
    if (attempt_id) {
      const taskNumber = task_type === 'writing_t1' ? 1 : 2;
      
      const { error: insertError } = await supabase
        .from('writing_submissions')
        .upsert({
          attempt_id,
          task: taskNumber,
          text_md: essay_text,
          word_count: measured_features.word_count,
          band: finalResult.overall_band,
          feedback_json: {
            ...finalResult,
            // Legacy compatibility fields
            tr: criterion_bands.TR,
            cc: criterion_bands.CC,
            lr: criterion_bands.LR,
            gra: criterion_bands.GRA,
            feedback_bullets: finalResult.next_steps?.three_point_plan || [],
            improvements: finalResult.next_steps?.micro_drills?.map(drill => `${drill.name}: ${drill.instructions}`) || [],
            on_topic_percent: finalResult.measured_features?.topic_relevance_0_100,
            off_topic: finalResult.measured_features?.topic_relevance_0_100 ? finalResult.measured_features.topic_relevance_0_100 < 55 : false,
            grammar_error_count: Math.round((finalResult.measured_features?.grammar_error_density_per_100w || 0) * measured_features.word_count / 100),
            template_likelihood: finalResult.measured_features?.template_cues?.length ? finalResult.measured_features.template_cues.length / 10 : 0
          },
          on_topic_percent: finalResult.measured_features?.topic_relevance_0_100 || null,
          off_topic: finalResult.measured_features?.topic_relevance_0_100 ? finalResult.measured_features.topic_relevance_0_100 < 55 : false,
          grammar_error_count: Math.round((finalResult.measured_features?.grammar_error_density_per_100w || 0) * measured_features.word_count / 100),
          template_likelihood: finalResult.measured_features?.template_cues?.length ? finalResult.measured_features.template_cues.length / 10 : null,
          gatekeeper_result: finalResult.result === 'band' ? 'ok' : finalResult.result,
          gatekeeper_reason: finalResult.result === 'band' ? 'Passed detailed scoring' : `Detailed scoring: ${finalResult.result}`,
          created_at: new Date().toISOString()
        }, { onConflict: 'attempt_id,task' });

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        return res.status(500).json({ 
          error: 'Failed to save detailed scoring results' 
        });
      }
    }

    // Return the detailed result
    res.json(finalResult);

  } catch (error) {
    console.error('Error in detailed-scoring route:', error);
    res.status(500).json({ 
      error: 'Internal server error during detailed scoring' 
    });
  }
});

export { router as detailedScoringRouter };
