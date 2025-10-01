import nodemailer from 'nodemailer';

export async function sendEmailReport(email: string, result: any): Promise<void> {
  try {
    // For now, just log the email (you can integrate SendLayer later)
    console.log(`📧 Would send email to: ${email}`);
    console.log(`📊 Results: Listening ${result.bands.listening}, Writing ${result.bands.writing}, Overall ${result.bands.overall}`);
    
    // TODO: Integrate with SendLayer or your WordPress email system
    // For MVP, we'll just log this
    
    // If you want to use SMTP, uncomment below:
    /*
    const transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const htmlContent = generateEmailHTML(result);
    
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: 'Your IELTS Diagnostic Results',
      html: htmlContent,
    });
    */
    
  } catch (error) {
    console.error('Email service error:', error);
    throw error;
  }
}

function generateEmailHTML(result: any): string {
  return `
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">Your IELTS Diagnostic Results</h1>
        
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2>Band Scores</h2>
          <p><strong>Listening:</strong> ${result.bands.listening}</p>
          <p><strong>Writing:</strong> ${result.bands.writing}</p>
          <p><strong>Overall:</strong> ${result.bands.overall}</p>
        </div>
        
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3>Your 7-Day Action Plan</h3>
          <ol>
            ${result.plan7d.map((day: string) => `<li>${day}</li>`).join('')}
          </ol>
        </div>
        
        <p>Keep practicing and good luck with your IELTS preparation!</p>
      </body>
    </html>
  `;
}
