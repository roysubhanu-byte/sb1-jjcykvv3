import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// NOTE: MVP returns an HTML Buffer so it works on Render with zero deps.
// Later you can swap to puppeteer/pdfkit to emit a real PDF.
export async function generatePdfReport(attemptData: any): Promise<Buffer> {
  try {
    // ---- Safe access helpers (backward-compatible with older result files) ----
    const bands = attemptData?.bands ?? { listening: 'N/A', writing: 'N/A', overall: 'N/A' };
    const writingReview = attemptData?.writing_review ?? {};
    const detailedFeedback = attemptData?.detailed_feedback || null;

    // 1) criterion_bands (new) with fallbacks to old flat keys
    const cb = attemptData?.feedback_json?.criterion_bands
      ?? writingReview?.criterion_bands
      ?? {
        TR: numberOrNull(writingReview?.tr),
        CC: numberOrNull(writingReview?.cc),
        LR: numberOrNull(writingReview?.lr),
        GRA: numberOrNull(writingReview?.gra),
      };

    // 2) improvement_path (new)
    const improvementPath = attemptData?.feedback_json?.improvement_path ?? {
      current_level: numberOrNull(bands?.writing),
      target_level: 7.5,
    };

    // 3) writing_analysis (new)
    const writingAnalysis = attemptData?.feedback_json?.writing_analysis ?? {
      overall_feedback:
        typeof writingReview?.feedback === 'string' ? writingReview.feedback : 'No feedback available.',
      improvement_actions:
        Array.isArray(writingReview?.actions) ? writingReview.actions : [],
    };

    // 4) 7-day plan fallback
    const plan7d: string[] = Array.isArray(attemptData?.plan7d) ? attemptData.plan7d : [];

    // ---- Small UI helpers ----
    const fmt = (n: number | null | undefined) =>
      typeof n === 'number' && isFinite(n) ? n.toFixed(n % 1 === 0 ? 0 : 1) : 'N/A';

    const critCard = (label: string, value: number | null | undefined, color: string) => `
      <div style="flex:1; text-align:center;">
        <div style="font-size:22px; font-weight:700; color:${color};">${fmt(value)}</div>
        <div style="margin-top:6px; color:#6b7280;">${label}</div>
      </div>
    `;

    // ---- HTML ----
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>IELTS Diagnostic Report</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color:#111827; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #3b82f6; padding-bottom: 20px; }
            .scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0; }
            .score-card { background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; border: 2px solid #e5e7eb; }
            .feedback { background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
            .plan { background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
            .detailed-section { background: #eff6ff; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #3b82f6; page-break-inside: avoid; }
            .weak-areas { background: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444; }
            .strategies { background: #f0f9ff; padding: 15px; margin: 15px 0; border-radius: 8px; }
            .week-plan { background: #f0fdf4; padding: 15px; margin: 15px 0; border-radius: 8px; border: 2px solid #10b981; }
            .resources { background: #faf5ff; padding: 15px; margin: 15px 0; border-radius: 8px; border-left: 4px solid #8b5cf6; }
            h1 { color: #1e40af; margin-bottom: 10px; }
            h2 { color: #1f2937; margin-top: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
            h3 { color: #374151; margin-top: 20px; }
            h4 { color: #4b5563; margin-top: 15px; }
            ul, ol { margin-left: 20px; }
            li { margin-bottom: 8px; }
            .test-type-badge { display: inline-block; background: #3b82f6; color: white; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; font-weight: bold; }
            .intro-box { background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0; }
            pre { background: #f3f4f6; padding: 10px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; }
            .card { background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:16px; }
            .row { display:flex; gap:20px; align-items:center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>IELTS Diagnostic Report</h1>
            <p>Generated on ${new Date(attemptData?.timestamp || Date.now()).toLocaleDateString()}</p>
            ${detailedFeedback ? `<span class="test-type-badge">${detailedFeedback.testType}</span>` : ''}
          </div>

          <!-- Top Scores -->
          <div class="scores">
            <div class="score-card">
              <h3>Listening</h3>
              <div style="font-size: 2em; font-weight: bold; color: #2563eb;">${safe(bands.listening)}</div>
            </div>
            <div class="score-card">
              <h3>Writing</h3>
              <div style="font-size: 2em; font-weight: bold; color: #16a34a;">${safe(bands.writing)}</div>
            </div>
            <div class="score-card">
              <h3>Overall</h3>
              <div style="font-size: 2em; font-weight: bold; color: #7c3aed;">${safe(bands.overall)}</div>
            </div>
          </div>

          <!-- NEW: Writing Criteria Breakdown -->
          <div class="card" style="margin: 24px 0;">
            <h3>Writing Criteria Breakdown</h3>
            <div class="row" style="justify-content:space-between; margin-top: 8px;">
              ${critCard('Task Response', cb?.TR, '#2563eb')}
              ${critCard('Coherence & Cohesion', cb?.CC, '#7c3aed')}
              ${critCard('Lexical Resource', cb?.LR, '#ea580c')}
              ${critCard('Grammar & Accuracy', cb?.GRA, '#ef4444')}
            </div>
          </div>

          <!-- NEW: Improvement Path -->
          <div class="card" style="margin: 24px 0;">
            <h3>Your Improvement Path</h3>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div><strong>Current Level:</strong> ${fmt(improvementPath?.current_level)}</div>
              <div style="height:10px; flex:1; background:#e5e7eb; margin:0 12px; border-radius:9999px; overflow:hidden;">
                <div style="height:100%; width:${progressPercent(improvementPath)}%; background:#10b981;"></div>
              </div>
              <div><strong>Target:</strong> ${fmt(improvementPath?.target_level)}</div>
            </div>
            <p style="color:#6b7280; margin-top:8px;">Follow your personalized plan to reach the target band score.</p>
          </div>

          <!-- Old feedback area (kept) -->
          <div class="feedback">
            <h3>Writing Feedback</h3>
            <p>${safe(writingReview?.feedback || writingAnalysis?.overall_feedback || 'No feedback available.')}</p>
            <h4>Action Items:</h4>
            <ul>
              ${listHtml(writingAnalysis?.improvement_actions?.length ? writingAnalysis.improvement_actions : (writingReview?.actions || []))}
            </ul>
          </div>

          <!-- 7-day plan (kept) -->
          ${plan7d.length ? `
          <div class="plan">
            <h3>Your 7-Day Action Plan</h3>
            <ol>
              ${plan7d.map((day: string) => `<li>${safe(day)}</li>`).join('')}
            </ol>
          </div>` : ''}

          <!-- Detailed personalized section (kept) -->
          ${detailedFeedback ? `
          <div class="detailed-section">
            <h2>📋 Comprehensive Personalized Feedback Report</h2>

            <div class="intro-box">
              <h3>Focus Areas for ${safe(detailedFeedback.candidateName)}</h3>
              <p>${safe(detailedFeedback.personalizedIntro)}</p>
              ${typeof detailedFeedback.overallBand === 'number' ? `
              <p><strong>Current Overall Band:</strong> ${detailedFeedback.overallBand} → <strong>Target:</strong> ${Math.min(detailedFeedback.overallBand + 1, 9.0)}</p>
              ` : ''}
            </div>

            ${Array.isArray(detailedFeedback.weakSections) && detailedFeedback.weakSections.length ? `
            <div class="weak-areas">
              <h3>🎯 Weak Areas Snapshot</h3>

              ${detailedFeedback.weakSections.includes('Writing') ? `
              <h4>Writing</h4>
              <ul>
                ${listHtml(detailedFeedback.weakAreasSnapshot?.writing || [])}
              </ul>` : ''}

              ${detailedFeedback.weakSections.includes('Speaking') ? `
              <h4>Speaking</h4>
              <ul>
                ${listHtml(detailedFeedback.weakAreasSnapshot?.speaking || [])}
              </ul>` : ''}
            </div>` : ''}

            ${detailedFeedback?.weakSections?.includes('Writing') ? `
            <div class="strategies">
              <h3>📝 How to Work on It: Writing</h3>
              <h4>A) Task Response: Answer the Question Fully with PEEL</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.writing?.taskResponse)}</pre>
              <h4>B) Coherence & Cohesion: Logical Flow Before Linkers</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.writing?.coherenceCohesion)}</pre>
              <h4>C) Lexical Resource: Precision + Paraphrase</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.writing?.lexicalResource)}</pre>
              <h4>D) Grammar & Accuracy: Fewer Errors First</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.writing?.grammarAccuracy)}</pre>
              ${detailedFeedback.howToWorkOnIt?.writing?.task1Specific ? `
              <h4>E) Task 1 (${detailedFeedback.testType === 'Academic' ? 'Academic Essentials' : 'Letter Essentials'})</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.writing?.task1Specific)}</pre>` : ''}
            </div>` : ''}

            ${detailedFeedback?.weakSections?.includes('Speaking') ? `
            <div class="strategies">
              <h3>🎤 How to Work on It: Speaking</h3>
              <h4>A) Fluency & Coherence: Build Length & Logic</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.speaking?.fluencyCoherence)}</pre>
              <h4>B) Lexis: Collocations + Numbers</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.speaking?.lexis)}</pre>
              <h4>C) Grammar: Safe Frames</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.speaking?.grammar)}</pre>
              <h4>D) Pronunciation: Clarity, Not Accent</h4>
              <pre>${safe(detailedFeedback.howToWorkOnIt?.speaking?.pronunciation)}</pre>
            </div>` : ''}

            <div class="week-plan">
              <h3>📅 Your 30-Day Action Plan</h3>

              <h4>Weeks 1-2: ${safe(detailedFeedback?.plan30Days?.weeks1to2?.title)}</h4>

              <p><strong>Writing:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks1to2?.writing || [])}</ul>

              <p><strong>Speaking:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks1to2?.speaking || [])}</ul>

              <p><strong>Vocabulary:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks1to2?.vocabulary || [])}</ul>

              <p><strong>KPIs by Day 14:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks1to2?.kpis || [])}</ul>

              <h4 style="margin-top: 20px;">Weeks 3-4: ${safe(detailedFeedback?.plan30Days?.weeks3to4?.title)}</h4>

              <p><strong>Writing:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks3to4?.writing || [])}</ul>

              <p><strong>Speaking:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks3to4?.speaking || [])}</ul>

              <p><strong>Vocabulary:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks3to4?.vocabulary || [])}</ul>

              <p><strong>KPIs by Day 30:</strong></p>
              <ul>${listHtml(detailedFeedback?.plan30Days?.weeks3to4?.kpis || [])}</ul>
            </div>

            <div class="resources">
              <h3>📚 Recommended Resources (IELTSeBooks.com)</h3>
              <p><strong>Core Books:</strong></p>
              <ul>
                ${listHtml(detailedFeedback?.resources?.coreBooks || [])}
                ${detailedFeedback?.resources?.pronunciationDrills ? `<li>${safe(detailedFeedback.resources.pronunciationDrills)}</li>` : ''}
                ${detailedFeedback?.resources?.topicCollocations ? `<li>${safe(detailedFeedback.resources.topicCollocations)}</li>` : ''}
              </ul>
              ${detailedFeedback?.resources?.note ? `
              <div style="background: #fef3c7; padding: 10px; border-radius: 5px; margin-top: 15px;">
                <p><strong>Note:</strong> ${safe(detailedFeedback.resources.note)}</p>
              </div>` : ''}
            </div>
          </div>
          ` : ''}

          <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 2px solid #e5e7eb; color: #6b7280; font-size: 0.9em;">
            <p>Generated by The Last Try IELTS Diagnostic Tool</p>
            <p>Continue your IELTS preparation at thelasttry.com</p>
          </div>
        </body>
      </html>
    `;

    return Buffer.from(htmlContent, 'utf8');
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

/* ---------------- utilities ---------------- */
function safe(x: any): string {
  const s = x == null ? '' : String(x);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function listHtml(arr: any[]): string {
  if (!Array.isArray(arr) || !arr.length) return '<li>No items.</li>';
  return arr.map((t) => `<li>${safe(t)}</li>`).join('');
}
function numberOrNull(v: any): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}
function progressPercent(ip: any): number {
  const cur = numberOrNull(ip?.current_level);
  const tgt = numberOrNull(ip?.target_level);
  if (cur == null || tgt == null || tgt <= 0) return 0;
  const p = (cur / tgt) * 100;
  return Math.max(0, Math.min(100, p));
}
