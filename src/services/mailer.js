const nodemailer = require('nodemailer');
const config = require('../config');

// Brevo SMTP. Credentials come only from the environment.
let transporter = null;

const isMailConfigured = () =>
  Boolean(config.mail.host && config.mail.user && config.mail.password && config.mail.from);

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465, // 587 uses STARTTLS
      auth: { user: config.mail.user, pass: config.mail.password },
    });
  }
  return transporter;
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const sendEmailVerificationCode = async ({ to, name, code, minutes }) => {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,';
  // Resolves with Brevo's acceptance info (messageId, response)
  return getTransporter().sendMail({
    from: config.mail.from,
    to,
    subject: `${code} is your Vizhaa verification code`,
    text: `${name ? `Hi ${name},` : 'Hi,'}\n\nYour Vizhaa email verification code is ${code}.\nIt expires in ${minutes} minutes.\n\nIf you didn't request this, you can ignore this email.`,
    html: `
      <div style="background:#EAF7FD;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
        <div style="max-width:440px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:20px;padding:32px 28px;">
          <p style="margin:0 0 6px;color:#0284C7;font-weight:bold;font-size:14px;letter-spacing:1px;">VIZHAA</p>
          <h1 style="margin:0 0 16px;color:#111827;font-size:22px;">Verify your email</h1>
          <p style="margin:0 0 20px;color:#64748B;font-size:15px;line-height:22px;">${greeting}<br/>Use this code to verify your email address in the Vizhaa app.</p>
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:18px;text-align:center;">
            <span style="font-size:32px;font-weight:bold;letter-spacing:10px;color:#111827;">${code}</span>
          </div>
          <p style="margin:20px 0 0;color:#94A3B8;font-size:13px;line-height:19px;">This code expires in ${minutes} minutes. If you didn't request it, you can safely ignore this email.</p>
        </div>
      </div>`,
  });
};

module.exports = { isMailConfigured, sendEmailVerificationCode, getTransporter };
