import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// NOTE: This returns an HTML Buffer (MVP). Swap to real PDF (puppeteer/pdfkit) later.
export async function generatePdfReport(attemptData: any): Promise<Buffer> {
  try {
    const detailedFeedback = attemptData.detailed_feedback || null;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>IELTS Diagnostic Report</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
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
          </style>
        </head>
        <body>
          <div class="header">
            <h1>IELTS Diagnostic Report</h1>
            <p>Generated on ${new Date(attemptData.timestamp).toLocaleDateString()}</p>
            ${detailedFeedback ? `<span class="test-type-badge">${detailedFeedback.testType}</span>` : ''}
          </div>

          <div class="scores">
            <div class="score-card">
              <h3>Listening</h3>
              <div style="font-size: 2em; font-weight: bold; color: #2563eb;">${attemptData.bands.listening}</div>
            </div>
            <div class="score-card">
              <h3>Writing</h3>
              <div style="font-size: 2em; font-weight: bold; color: #16a34a;">${attemptData.bands.writing}</div>
            </div>
            <div class="score-card">
              <h3>Overall</h3>
              <div style="font-size: 2em; font-weight: bold; color: #7c3aed;">${attemptData.bands.overall}</div>
            </div>
          </div>

          <div class="feedback">
            <h3>Writing Feedback</h3>
            <p>${attemptData.writing_review.feedback}</p>
            <h4>Action Items:</h4>
            <ul>
              ${attemptData.writing_review.actions.map((action: string) => `<li>${action}</li>`).join('')}
            </ul>
          </div>

          <div class="plan">
            <h3>Your 7-Day Action Plan</h3>
            <ol>
              ${attemptData.plan7d.map((day: string) => `<li>${day}</li>`).join('')}
            </ol>
          </div>

          ${detailedFeedback ? `
          <div class="detailed-section">
            <h2>📋 Comprehensive Personalized Feedback Report</h2>

            <div class="intro-box">
              <h3>Focus Areas for ${detailedFeedback.candidateName}</h3>
              <p>${detailedFeedback.personalizedIntro}</p>
              ${detailedFeedback.overallBand && typeof detailedFeedback.overallBand === 'number' ? `
              <p><strong>Current Overall Band:</strong> ${detailedFeedback.overallBand} → <strong>Target:</strong> ${Math.min(detailedFeedback.overallBand + 1, 9.0)}</p>
              ` : ''}
            </div>

            ${detailedFeedback.weakSections.length > 0 ? `
            <div class="weak-areas">
              <h3>🎯 Weak Areas Snapshot</h3>

              ${detailedFeedback.weakSections.includes('Writing') ? `
              <h4>Writing</h4>
              <ul>
                ${detailedFeedback.weakAreasSnapshot.writing.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>
              ` : ''}

              ${detailedFeedback.weakSections.includes('Speaking') ? `
              <h4>Speaking</h4>
              <ul>
                ${detailedFeedback.weakAreasSnapshot.speaking.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>
              ` : ''}
            </div>
            ` : ''}

            ${detailedFeedback.weakSections.includes('Writing') ? `
            <div class="strategies">
              <h3>📝 How to Work on It: Writing</h3>

              <h4>A) Task Response: Answer the Question Fully with PEEL</h4>
              <pre>${detailedFeedback.howToWorkOnIt.writing.taskResponse}</pre>

              <h4>B) Coherence & Cohesion: Logical Flow Before Linkers</h4>
              <pre>${detailedFeedback.howToWorkOnIt.writing.coherenceCohesion}</pre>

              <h4>C) Lexical Resource: Precision + Paraphrase</h4>
              <pre>${detailedFeedback.howToWorkOnIt.writing.lexicalResource}</pre>

              <h4>D) Grammar & Accuracy: Fewer Errors First</h4>
              <pre>${detailedFeedback.howToWorkOnIt.writing.grammarAccuracy}</pre>

              ${detailedFeedback.howToWorkOnIt.writing.task1Specific ? `
              <h4>E) Task 1 (${detailedFeedback.testType === 'Academic' ? 'Academic Essentials' : 'Letter Essentials'})</h4>
              <pre>${detailedFeedback.howToWorkOnIt.writing.task1Specific}</pre>
              ` : ''}
            </div>
            ` : ''}

            ${detailedFeedback.weakSections.includes('Speaking') ? `
            <div class="strategies">
              <h3>🎤 How to Work on It: Speaking</h3>

              <h4>A) Fluency & Coherence: Build Length & Logic</h4>
              <pre>${detailedFeedback.howToWorkOnIt.speaking.fluencyCoherence}</pre>

              <h4>B) Lexis: Collocations + Numbers</h4>
              <pre>${detailedFeedback.howToWorkOnIt.speaking.lexis}</pre>

              <h4>C) Grammar: Safe Frames</h4>
              <pre>${detailedFeedback.howToWorkOnIt.speaking.grammar}</pre>

              <h4>D) Pronunciation: Clarity, Not Accent</h4>
              <pre>${detailedFeedback.howToWorkOnIt.speaking.pronunciation}</pre>
            </div>
            ` : ''}

            <div class="week-plan">
              <h3>📅 Your 30-Day Action Plan</h3>

              <h4>Weeks 1-2: ${detailedFeedback.plan30Days.weeks1to2.title}</h4>

              <p><strong>Writing:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks1to2.writing.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <p><strong>Speaking:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks1to2.speaking.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <p><strong>Vocabulary:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks1to2.vocabulary.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <p><strong>KPIs by Day 14:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks1to2.kpis.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <h4 style="margin-top: 20px;">Weeks 3-4: ${detailedFeedback.plan30Days.weeks3to4.title}</h4>

              <p><strong>Writing:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks3to4.writing.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <p><strong>Speaking:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks3to4.speaking.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <p><strong>Vocabulary:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks3to4.vocabulary.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>

              <p><strong>KPIs by Day 30:</strong></p>
              <ul>
                ${detailedFeedback.plan30Days.weeks3to4.kpis.map((item: string) => `<li>${item}</li>`).join('')}
              </ul>
            </div>

            <div class="resources">
              <h3>📚 Recommended Resources (IELTSeBooks.com)</h3>

              <p><strong>Core Books:</strong></p>
              <ul>
                ${detailedFeedback.resources.coreBooks.map((book: string) => `<li>${book}</li>`).join('')}
                <li>${detailedFeedback.resources.pronunciationDrills}</li>
                <li>${detailedFeedback.resources.topicCollocations}</li>
              </ul>

              <div style="background: #fef3c7; padding: 10px; border-radius: 5px; margin-top: 15px;">
                <p><strong>Note:</strong> ${detailedFeedback.resources.note}</p>
              </div>
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
