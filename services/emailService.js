const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const getResendClient = () => {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
};

const getFromAddress = () => {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER;
};

const createTransporter = () => {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  // Prefer explicit SMTP configuration when provided.
  if (smtpHost) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // Backward compatibility with existing Gmail setup.
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

const assertEmailConfigured = () => {
  if (process.env.RESEND_API_KEY) {
    if (!getFromAddress()) {
      const err = new Error("Email sender is not configured. Set EMAIL_FROM (or EMAIL_USER).");
      err.statusCode = 400;
      throw err;
    }
    return;
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const err = new Error("Email service is not configured. Set EMAIL_USER and EMAIL_PASS in server/.env.");
    err.statusCode = 400;
    throw err;
  }
};

const resolveClientUrl = (candidate) => {
  const raw = String(
    candidate ||
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_APP_URL ||
      "https://app.bluewhalemigration.com"
  ).trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
};

const sanitizeRedirectTarget = (rawTarget) => {
  const value = String(rawTarget || '').trim();
  if (!value) return '';
  if (/^javascript:/i.test(value)) return '';
  // Allow standard web URLs and app deep links (e.g., bluewhale://login)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  return '';
};

const sendPasswordResetEmail = async (email, resetToken, userType, options = {}) => {
  try {
    const clientUrl = resolveClientUrl(options.clientUrl) || resolveClientUrl(process.env.CLIENT_URL);
    if (!clientUrl) {
      throw new Error("CLIENT_URL is not configured for password reset links.");
    }
    const redirectTo = sanitizeRedirectTarget(options.redirectTo);
    const redirectQuery = redirectTo ? `&redirectTo=${encodeURIComponent(redirectTo)}` : '';
    const sourceQuery =
      String(options.source || '').toLowerCase() === 'mobile' ? '&source=mobile' : '';
    const resetURL = `${clientUrl}/reset-password?token=${resetToken}&type=${encodeURIComponent(userType || "candidate")}${redirectQuery}${sourceQuery}`;
    const fromAddress = getFromAddress();
    if (!fromAddress) {
      throw new Error("Email sender is not configured. Set EMAIL_FROM or EMAIL_USER.");
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .container {
              max-width: 600px;
              margin: 0 auto;
              font-family: Arial, sans-serif;
              background-color: #f9f9f9;
              padding: 20px;
            }
            .email-content {
              background-color: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .header {
              text-align: center;
              color: #1B3890;
              margin-bottom: 30px;
            }
            .reset-button {
              display: inline-block;
              background: #1B3890;
              color:  #ffffff;
              padding: 15px 30px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: bold;
              margin: 20px 0;
            }
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #eee;
              color: #666;
              font-size: 14px;
            }
            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffeaa7;
              color: #856404;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="email-content">
              <div class="header">
                <h1>Password Reset Request</h1>
              </div>
              
              <p>Hello,</p>
              
              <p>We received a request to reset your password for your Job Portal ${userType === 'agent' ? 'Agent' : 'Candidate'} account. If you made this request, please click the button below to reset your password:</p>
              
              <div style="text-align: center;">
                <a href="${resetURL}" style="
     display: inline-block;
     background-color: #1B3890; 
     color: #ffffff !important; 
     padding: 15px 30px;
     text-decoration: none !important;
     border-radius: 8px;
     font-weight: bold;
     font-family: Arial, sans-serif;
   ">Reset Your Password</a>
              </div>
              
              <div class="warning">
                <strong>Important:</strong> This link will expire in 1 hour for security reasons.
              </div>
              
              <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
              
              <p>If the button above doesn't work, you can copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #1B3890;">${resetURL}</p>
              
              <div class="footer">
                <p>Best regards,<br>Job Portal Team</p>
                <p><strong>Security Notice:</strong> Never share your password or reset links with anyone.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const resend = getResendClient();
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to: email,
        subject: 'Password Reset Request - Job Portal',
        html,
      });

      if (error) {
        throw new Error(error.message || 'Resend failed to send reset email');
      }

      console.log('Password reset email sent via Resend:', data?.id);
      return { success: true, messageId: data?.id };
    }

    const transporter = createTransporter();

    const mailOptions = {
      from: `"Job Portal" <${fromAddress}>`,
      to: email,
      subject: 'Password Reset Request - Job Portal',
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email sending failed:', error);
    const message =
      error?.responseCode === 535
        ? "SMTP authentication failed. Check EMAIL_USER and EMAIL_PASS (Gmail requires App Password)."
        : error?.code === 'EAUTH'
          ? 'Email authentication failed. Verify SMTP credentials.'
          : error?.code === 'ENOTFOUND'
            ? 'SMTP host not found. Verify SMTP_HOST.'
            : error?.code === 'ETIMEDOUT'
              ? 'Email service connection timed out. Configure RESEND_API_KEY and EMAIL_FROM on production.'
            : error?.message || 'Failed to send reset email';
    const err = new Error(message);
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

// Meeting reminder function
const sendMeetingReminderEmail = async (user, meeting) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Email credentials not configured');
    }

    const transporter = createTransporter();
    await transporter.verify();

    // email content based on user type
    let greeting = `Hello ${user.name},`;
    let meetingContext = "your upcoming meeting";
    
    if (user.type === 'agent' && user.managedCandidateName) {
      meetingContext = `${user.managedCandidateName}'s upcoming meeting`;
    }

    const managedCandidateDetailsHtml = user.type === 'agent'
      ? `
          <div style="margin-top:12px;padding:12px;border:1px solid #dbeafe;border-radius:8px;background:#f8fbff;">
            <p style="margin:0 0 8px 0;"><strong>Managed Candidate Details</strong></p>
            <p style="margin:0;"><strong>Name:</strong> ${user.managedCandidateName || "N/A"}</p>
            <p style="margin:4px 0 0 0;"><strong>Email:</strong> ${user.managedCandidateEmail || "N/A"}</p>
            <p style="margin:4px 0 0 0;"><strong>Candidate ID:</strong> ${user.managedCandidateId || "N/A"}</p>
          </div>
        `
      : "";

    const mailOptions = {
      from: `"Job Portal" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: `Reminder: Meeting "${meeting.title}"`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>${greeting}</h2>
          <p>This is a reminder for ${meetingContext}:</p>
          <ul>
            <li><strong>Title:</strong> ${meeting.title}</li>
            <li><strong>Date:</strong> ${meeting.date.toLocaleDateString('en-GB')}</li>
            <li><strong>Time:</strong> ${meeting.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</li>
            <li><strong>Type:</strong> ${meeting.locationType}</li>
            ${meeting.link ? `<li><strong>Join Link:</strong> <a href="${meeting.link}">${meeting.link}</a></li>` : ""}
          </ul>
          ${user.type === 'agent' ? `<p><em>This meeting is for your managed candidate: ${user.managedCandidateName}</em></p>` : ""}
          ${managedCandidateDetailsHtml}
          <p>Thanks,<br/>Job Portal Team</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Meeting reminder sent to ${user.email}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`Failed to send reminder to ${user.email}:`, error);
    throw error; 
  }
};

const sendInquiryResponseEmail = async (inquiry, replyMessage, recipientEmail = null, context = null) => {
  try {
    const transporter = createTransporter();
    
    // Use provided recipient email or fallback to inquiry email
    const toEmail = recipientEmail || inquiry.email;
    const managedCandidateDetailsHtml = context?.targetType === "managedCandidate"
      ? `
          <div style="margin-top:14px;padding:12px;border:1px solid #dbeafe;border-radius:8px;background:#f8fbff;">
            <p style="margin:0 0 8px 0;"><strong>Managed Candidate Details</strong></p>
            <p style="margin:0;"><strong>Name:</strong> ${context?.candidateName || "N/A"}</p>
            <p style="margin:4px 0 0 0;"><strong>Email:</strong> ${context?.candidateEmail || "N/A"}</p>
            <p style="margin:4px 0 0 0;"><strong>Candidate ID:</strong> ${context?.candidateId || "N/A"}</p>
          </div>
        `
      : "";

    const mailOptions = {
      from: `"Blue Whale Migration" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: `Response to your inquiry: ${inquiry.subject}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
              .container { max-width: 600px; background: white; margin: auto; padding: 20px; border-radius: 10px; }
              .header { color: #1B3890; margin-bottom: 15px; }
              .reply-box { background: #f0f7ff; border-left: 4px solid #1B3890; padding: 15px; border-radius: 5px; }
              .footer { font-size: 13px; color: #888; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2 class="header">Response to Your Inquiry</h2>
              <p>Dear ${inquiry.candidateType === 'B2B' ? 'Agent' : 'Candidate'},</p>
              <p>We have reviewed your inquiry titled <strong>"${inquiry.subject}"</strong> and here's our response:</p>

              <div class="reply-box">
                ${replyMessage}
              </div>
              ${managedCandidateDetailsHtml}

              <div class="footer">
                <p>Thank you for reaching out to us.<br/>— Blue Whale Migration Team</p>
              </div>
            </div>
          </body>
        </html>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`Inquiry response email sent to ${toEmail}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error("Failed to send inquiry response email:", error);
  }
};

const sendInvoiceEmail = async ({ to, invoiceNumber, customerName, pdfBuffer, context }) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();
    const subject = `Invoice ${invoiceNumber} from Blue Whale Migration`;
    const managedCandidateDetailsHtml = context?.targetType === "managedCandidate"
      ? `
        <div style="margin-top:12px;padding:12px;border:1px solid #dbeafe;border-radius:8px;background:#f8fbff;">
          <p style="margin:0 0 8px 0;"><strong>Managed Candidate Details</strong></p>
          <p style="margin:0;"><strong>Name:</strong> ${context?.candidateName || "N/A"}</p>
          <p style="margin:4px 0 0 0;"><strong>Email:</strong> ${context?.candidateEmail || "N/A"}</p>
          <p style="margin:4px 0 0 0;"><strong>Candidate ID:</strong> ${context?.candidateId || "N/A"}</p>
        </div>
      `
      : "";
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Invoice ${invoiceNumber}</h2>
        <p>Hello ${context?.targetType === "managedCandidate" ? (context?.agentName || "Agent") : (customerName || "Customer")},</p>
        ${context?.targetType === "managedCandidate" ? `<p>This invoice belongs to your managed candidate.</p>` : ""}
        ${managedCandidateDetailsHtml}
        <p>Please find your invoice attached as a PDF.</p>
        <p>Thank you,<br/>Blue Whale Migration Billing Team</p>
      </div>
    `;

    const resend = getResendClient();
    if (resend) {
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to,
        subject,
        html,
        attachments: [
          {
            filename: `${invoiceNumber}.pdf`,
            content: Buffer.isBuffer(pdfBuffer)
              ? pdfBuffer.toString("base64")
              : Buffer.from(pdfBuffer).toString("base64"),
          },
        ],
      });

      if (error) {
        const err = new Error(error.message || "Resend failed to send invoice email");
        err.statusCode = Number(error.statusCode || error.status || 500);
        throw err;
      }

      return { messageId: data?.id, provider: "resend" };
    }

    const transporter = createTransporter();
    await transporter.verify();
    const info = await transporter.sendMail({
      from: `"Blue Whale Migration Billing" <${fromAddress}>`,
      to,
      subject,
      html,
      attachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
    return info;
  } catch (error) {
    console.error("Failed to send invoice email:", error);
    const message =
      error?.responseCode === 535
        ? "SMTP authentication failed. Check EMAIL_USER and EMAIL_PASS (for Gmail use an App Password)."
        : error?.message || "Failed to send invoice email";
    const err = new Error(message);
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendMeetingReminderEmail,
  sendInquiryResponseEmail,
  sendInvoiceEmail
};
