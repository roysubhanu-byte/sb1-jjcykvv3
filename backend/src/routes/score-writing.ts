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
  // NEW DETAIL FIELDS
  spelling_errors: number;
  punctuation_errors: number;
  hyphenation_errors: number;
  paragraph_count: number;
  linking_devices: string[];
  advanced_c2_words: string[];
  phrasal_verbs: string[];
  collocations: string[];
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

    // Construct comprehensive IELTS grading prompt with detailed feedback roadmap
    const systemPrompt = `You are an EXTREMELY STRICT IELTS Writing examiner. Provide comprehensive, actionable feedback showing the path from current band to Band 8.0.

You will receive:
- task_prompt (the exact question)
- module (Academic|General)
- task_type (Task 1|Task 2)
- essay_text
- word_count
- min_required_words

Strict Enforcement Rules:
1) Do NOT reward length beyond the minimum
2) Judge Task Response ONLY against task_prompt. If mostly off-topic: set off_topic=true, cap at 3.0
3) If word_count < min_required_words: cap at 5.0
4) Grammar very weak: cap GRA at 4.0
5) Basic vocabulary only: cap LR at 5.0
6) Severe repetition: reduce 0.5–1.0
7) Template phrases >20%: reduce up to 0.5
8) Use 0.5 increments

DETAILED TRACKING (COUNT EVERYTHING):
- spelling_errors: ALL misspellings
- punctuation_errors: comma splices, missing commas, run-ons
- hyphenation_errors: missing/incorrect hyphens
- paragraph_count: total paragraphs
- linking_devices: ALL cohesive devices (however, therefore, furthermore, consequently)
- advanced_c2_words: C2/C1 words (mitigate, notwithstanding, albeit, nonetheless, exacerbate, proliferation)
- phrasal_verbs: natural phrasal verbs (carry out, account for, give rise to, bring about)
- collocations: strong collocations (make a decision, heavy traffic, conduct research, significant impact)

PENALTIES (STRICT):
- spelling_errors: -0.1 each up to -1.0 from LR
- punctuation_errors: -0.1 each up to -1.0 from GRA
- hyphenation_errors: -0.05 each up to -0.5 from GRA
- paragraph_count < 4 for Task 2: reduce CC by 0.5
- linking_devices < 4: reduce CC by 0.5
- advanced_c2_words < 5: cap LR at 5.5
- phrasal_verbs < 3: reduce LR by 0.5
- collocations < 5: reduce LR by 0.5

REWARDS:
- advanced_c2_words >= 10 AND collocations >= 15: may raise LR up to 0.5
- linking_devices >= 8 unique: may raise CC by 0.5

COMPREHENSIVE FEEDBACK FORMAT:

For feedback_bullets, provide 10-15 detailed points covering:

TASK RESPONSE (TR: X.X):
1. What you did well (2-3 specific points with examples)
2. What cost you marks (3-5 specific issues with line references)
3. Calculation showing: "Base score - penalties = final"

COHERENCE & COHESION (CC: X.X):
4. Strengths (linking devices used, paragraph structure)
5. Weaknesses (missing topic sentences, unclear references, poor paragraphing)
6. Calculation

LEXICAL RESOURCE (LR: X.X):
7. Vocabulary analysis (C2 words found, collocations, phrasal verbs)
8. Issues (repetition, spelling errors, inappropriate word choice)
9. Calculation

GRAMMATICAL RANGE & ACCURACY (GRA: X.X):
10. Complex structures identified
11. All grammar errors listed with corrections
12. Calculation

For improvements, provide DETAILED 30-day roadmap with 15-20 actionable steps:

PATH FROM [current] → 8.0:

TASK RESPONSE IMPROVEMENT:
- Week 1-2: [Specific drills for TR]
  • Practice analyzing essay questions (spend 5 min identifying: topic, instruction, scope)
  • Write 5 thesis statements daily for different topics
  • Use template: "While X has merit, I contend that Y because [reason 1] and [reason 2]"

COHERENCE & COHESION IMPROVEMENT:
- Week 1: Master paragraphing
  • Start EVERY paragraph with topic sentence
  • Use PEEL structure: Point, Example, Explain, Link
  • Practice: Rewrite 3 essays with clear structure
- Week 2: Advanced linking
  • Replace basic linkers (and, but, so) with sophisticated ones
  • Use: "Furthermore/Moreover" (addition), "Nevertheless/Nonetheless" (contrast), "Consequently/Thus" (result)

LEXICAL RESOURCE IMPROVEMENT:
- Week 1: Vocabulary expansion (20 words/day)
  • Replace "important" with: crucial, vital, essential, paramount, significant
  • Replace "show" with: demonstrate, illustrate, indicate, reveal, manifest
  • Replace "think" with: contend, argue, posit, maintain, assert
- Week 2: Collocation mastery
  • Learn 50 academic collocations (make progress, conduct research, face challenges)
  • Practice using 5 new collocations per essay
- Week 3: Eliminate spelling errors
  • Drill these 50 commonly misspelled words daily
  • Use mnemonic devices for difficult words

GRAMMAR IMPROVEMENT:
- Week 1: Fix common errors
  • Subject-verb agreement: Practice 20 sentences daily
  • Article usage (a/an/the): Complete Khan Academy grammar module
  • Conditional forms: Master If + present → will, If + past → would
- Week 2: Add sophistication
  • Inversion for emphasis: "Not only... but also", "Rarely do..."
  • Cleft sentences: "What concerns me most is...", "It is X that..."
  • Participle clauses: "Having considered...", "Being aware of..."
- Week 3: Passive voice mastery
  • Use passive for formal academic tone: "It is widely believed that..."
  • Practice: Convert 20 active sentences to passive daily

DAILY PRACTICE SCHEDULE:
- Days 1-7: Write 1 Task 2 essay daily, focus on TR (answering all parts)
- Days 8-14: Rewrite Week 1 essays improving CC (add linkers, fix paragraphing)
- Days 15-21: Vocabulary upgrade (replace ALL basic words with Band 8 alternatives)
- Days 22-28: Grammar perfection (eliminate ALL errors, add complex structures)
- Days 29-30: Timed practice (40 min Task 2, then review)

SPECIFIC RESOURCES:
- IELTS Liz (ieltsliz.com): Essay structures and band descriptors
- Academic Word List: Master 570 most common academic words
- Grammarly Premium: Real-time grammar checking
- Cambridge IELTS Books 14-18: Practice with official materials
- YouTube: E2 IELTS Writing, IELTS Advantage

MICRO-DRILLS (Do these DAILY):
1. Vocabulary drill: Learn 20 academic words, use in sentences
2. Grammar drill: Write 10 complex sentences with different structures
3. Paraphrasing drill: Rewrite 5 sentences using synonyms
4. Linking drill: Write paragraph using 5 different cohesive devices
5. Speed drill: Write introduction in 7 minutes

TARGET TIMELINE:
- After Week 2: +0.5 band improvement (better structure, fewer errors)
- After Week 4: +1.0 band improvement (stronger vocabulary, complex grammar)
- After 8 weeks: +1.5 bands (consistent Band 7.0-7.5 performance)
- After 12 weeks: Band 8.0 achievable with dedicated practice

Return JSON ONLY with this exact schema:
{
  "tr": number,
  "cc": number,
  "lr": number,
  "gra": number,
  "band_overall": number,
  "on_topic_percent": number,
  "off_topic": boolean,
  "word_count": number,
  "evidence_quotes": ["..."],
  "grammar_error_count": number,
  "grammar_examples": [{"error": "…", "excerpt": "…", "fix": "…"}],
  "cohesion_issues": ["…"],
  "lexical_notes": ["…"],
  "repetition_notes": ["…"],
  "template_likelihood": number,
  "feedback_bullets": ["TASK RESPONSE (Band X.X): [detailed analysis]", "What you did well: ...", "What cost you marks: ...", "COHERENCE & COHESION (Band X.X): ...", ...],
  "improvements": ["PATH FROM X.X → 8.0:", "TASK RESPONSE IMPROVEMENT:", "- Week 1-2: ...", "COHERENCE IMPROVEMENT:", "- Week 1: ...", "LEXICAL IMPROVEMENT:", "- Week 1: ...", "GRAMMAR IMPROVEMENT:", "- Week 1: ...", "DAILY PRACTICE SCHEDULE:", "MICRO-DRILLS:", "TARGET TIMELINE:", ...],
  "spelling_errors": number,
  "punctuation_errors": number,
  "hyphenation_errors": number,
  "paragraph_count": number,
  "linking_devices": ["however", "therefore", "..."],
  "advanced_c2_words": ["mitigate", "notwithstanding", "..."],
  "phrasal_verbs": ["carry out", "account for", "..."],
  "collocations": ["make a decision", "heavy traffic", "..."]
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

    // Apply strict caps for serious issues
    if (off_topic === true || (on_topic_percent && on_topic_percent <= 50)) {
      band_overall = Math.min(band_overall, 3.0);
      off_topic = true;
    }

    if (word_count < minRequiredWords) {
      band_overall = Math.min(band_overall, 5.0);
    }

    // Round all bands to nearest 0.5 (IELTS standard)
    const roundToHalf = (num: number) => Math.round(num * 2) / 2;
    tr = roundToHalf(tr);
    cc = roundToHalf(cc);
    lr = roundToHalf(lr);
    gra = roundToHalf(gra);
    band_overall = roundToHalf(band_overall);

    // Ensure all new detail fields have default values
    const finalResult: ScoreWritingResponse = {
      ...scoringResult,
      tr,
      cc,
      lr,
      gra,
      band_overall,
      off_topic: off_topic || false,
      on_topic_percent: on_topic_percent || 100,
      word_count,
      spelling_errors: scoringResult.spelling_errors || 0,
      punctuation_errors: scoringResult.punctuation_errors || 0,
      hyphenation_errors: scoringResult.hyphenation_errors || 0,
      paragraph_count: scoringResult.paragraph_count || 0,
      linking_devices: scoringResult.linking_devices || [],
      advanced_c2_words: scoringResult.advanced_c2_words || [],
      phrasal_verbs: scoringResult.phrasal_verbs || [],
      collocations: scoringResult.collocations || []
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

