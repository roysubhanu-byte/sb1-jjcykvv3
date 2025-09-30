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
    // Debug log to check API key availability
    console.log('DEBUG (inside scoreWriting function): OPENAI_API_KEY value:', process.env.OPENAI_API_KEY ? 'Configured (starts with ' + process.env.OPENAI_API_KEY.substring(0, 5) + '...)' : 'Missing or Empty');

    if (!process.env.OPENAI_API_KEY) {
      // Fallback scoring if no API key
      return {
        tr: 6.0,
        cc: 6.0,
        lr: 6.0,
        gra: 6.0,
        overall: 6.0,
        feedback: "AI scoring unavailable. This is a sample score.",
        actions: ["Practice more essays", "Focus on grammar", "Expand vocabulary"],
        rewrites: [],
        grammar_table: []
      };
    }

    // Initialize OpenAI client here, inside the function
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const systemPrompt = `You are an IELTS Writing examiner. Score TR (Task Response), CC (Coherence & Cohesion), LR (Lexical Resource), GRA (Grammatical Range & Accuracy) on a scale of 0-9 in 0.5 increments. Return JSON:

Be EXTREMELY STRICT and realistic in your scoring. Use official IELTS band descriptors precisely:
- Band 4: Basic competence, limited vocabulary, frequent grammatical errors
- Band 5: Modest competence, adequate vocabulary, some grammatical errors
- Band 6: Competent user, adequate vocabulary range, occasional errors
- Band 7: Good user, flexible vocabulary, few errors
- Band 8: Very good user, wide vocabulary range, rare errors
- Band 9: Expert user, very wide vocabulary, virtually no errors

Apply strict penalties for:
- Insufficient word count (under 150 for Task 1, under 250 for Task 2)
- Repetitive language or ideas: Reduce by 1-2 bands
- Copy-paste or memorized content: Maximum band 4.0
- Basic vocabulary only: Maximum band 5.0
- Poor essay structure: Reduce by 1 band
- Off-topic responses
- Grammatical errors throughout: Maximum band 4.0

{
  "tr": number,
  "cc": number, 
  "lr": number,
  "gra": number,
  "overall": number,
  "feedback": "string",
  "actions": ["short imperative sentences"],
  "rewrites": [{"from": "original text", "to": "improved text", "reason": "explanation"}],
  "grammar_table": [{"issue": "grammar issue", "example": "incorrect example", "fix": "corrected version"}]
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Score this IELTS Writing Task 2 essay:\n\n${essayText}` }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    const parsed = JSON.parse(response);
    
    // Validate and ensure all required fields
    return {
      tr: parsed.tr || 6.0,
      cc: parsed.cc || 6.0,
      lr: parsed.lr || 6.0,
      gra: parsed.gra || 6.0,
      overall: parsed.overall || 6.0,
      feedback: parsed.feedback || 'Good effort on this essay.',
      actions: parsed.actions || ['Practice more essays', 'Focus on structure'],
      rewrites: parsed.rewrites || [],
      grammar_table: parsed.grammar_table || []
    };

  } catch (error) {
    console.error('Error scoring writing:', error);
    
    // Fallback scoring
    return {
      tr: 6.0,
      cc: 6.0,
      lr: 6.0,
      gra: 6.0,
      overall: 6.0,
      }
  }
}