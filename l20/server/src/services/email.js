import nodemailer from 'nodemailer';
import { formatReportEmail } from '../services/statistics.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    }
  });

  return transporter;
}

export async function sendWeeklyReportEmail(email, report) {
  const transport = getTransporter();
  const htmlBody = formatReportEmail(report);

  const mailOptions = {
    from: process.env.EMAIL_FROM || 'noreply@ai-avatar.app',
    to: email,
    subject: `AI Avatar 周报 - ${report.weekStart.toLocaleDateString()} ~ ${report.weekEnd.toLocaleDateString()}`,
    text: htmlBody,
    html: `<pre style="font-family: monospace; line-height: 1.6;">${htmlBody}</pre>`
  };

  try {
    const info = await transport.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}
