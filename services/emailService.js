const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const getResendClient = () => {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
};

const getFromAddress = () => {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER;
};

const buildDisplayFromAddress = (label, fromAddress) => {
  return `"${label}" <${fromAddress}>`;
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

const mapEmailErrorMessage = (error, fallbackMessage) => {
  return error?.responseCode === 535
    ? "SMTP authentication failed. Check EMAIL_USER and EMAIL_PASS (Gmail requires App Password)."
    : error?.code === 'EAUTH'
      ? 'Email authentication failed. Verify SMTP credentials.'
      : error?.code === 'ENOTFOUND'
        ? 'SMTP host not found. Verify SMTP_HOST.'
        : error?.code === 'ETIMEDOUT'
          ? 'Email service connection timed out. Verify Resend or SMTP connectivity.'
          : error?.message || fallbackMessage;
};

const sendEmailWithFallback = async ({
  fromAddress,
  smtpFrom,
  to,
  subject,
  html,
  resendAttachments,
  smtpAttachments,
  verifySmtp = false,
  resendErrorMessage = "Resend failed to send email",
}) => {
  const resend = getResendClient();
  let resendFailure = null;

  if (resend) {
    try {
      const { data, error } = await resend.emails.send({
        from: fromAddress,
        to,
        subject,
        html,
        ...(Array.isArray(resendAttachments) && resendAttachments.length
          ? { attachments: resendAttachments }
          : {}),
      });

      if (error) {
        const resendError = new Error(error.message || resendErrorMessage);
        resendError.statusCode = Number(error.statusCode || error.status || 500);
        throw resendError;
      }

      return { messageId: data?.id, provider: "resend" };
    } catch (error) {
      resendFailure = error;
      console.error(`Resend send failed for "${subject}". Falling back to SMTP if available:`, error.message || error);
    }
  }

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    if (resendFailure) {
      throw resendFailure;
    }

    const err = new Error("Email service is not configured. Set RESEND_API_KEY or SMTP credentials.");
    err.statusCode = 400;
    throw err;
  }

  const transporter = createTransporter();
  if (verifySmtp) {
    await transporter.verify();
  }

  const info = await transporter.sendMail({
    from: smtpFrom,
    to,
    subject,
    html,
    ...(Array.isArray(smtpAttachments) && smtpAttachments.length
      ? { attachments: smtpAttachments }
      : {}),
  });

  return { messageId: info?.messageId, provider: "smtp" };
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
    assertEmailConfigured();
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

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Job Portal", fromAddress),
      to: email,
      subject: 'Password Reset Request - Job Portal',
      html,
      resendErrorMessage: 'Resend failed to send reset email',
    });

    console.log(`Password reset email sent via ${result.provider}:`, result.messageId);
    return { success: true, messageId: result.messageId, provider: result.provider };
  } catch (error) {
    console.error('Email sending failed:', error);
    const message = mapEmailErrorMessage(error, 'Failed to send reset email');
    const err = new Error(message);
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

const sendAdminLoginOtpEmail = async ({ to, name, otpCode, expiresInMinutes = 5, ip = "", device = "" }) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();
    const safeName = String(name || "there").trim() || "there";
    const subject = "Your Blue Whale CRM login verification code";
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f7fb;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; border: 1px solid #e5e7eb;">
          <h2 style="margin: 0 0 12px; color: #1e3a8a;">Login verification</h2>
          <p style="margin: 0 0 16px; color: #334155;">Hi ${safeName}, use this one-time code to complete your sign in:</p>
          <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0f172a; text-align: center; background: #eff6ff; border-radius: 10px; padding: 12px 0; margin-bottom: 16px;">
            ${String(otpCode || "")}
          </div>
          <p style="margin: 0 0 8px; color: #475569;">This code expires in ${Number(expiresInMinutes) || 5} minutes.</p>
          ${ip ? `<p style="margin: 0 0 6px; color: #64748b;">IP: ${String(ip)}</p>` : ""}
          ${device ? `<p style="margin: 0; color: #64748b;">Device: ${String(device)}</p>` : ""}
          <p style="margin: 16px 0 0; color: #64748b; font-size: 13px;">If you did not try to sign in, please reset your password.</p>
        </div>
      </div>
    `;

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Blue Whale CRM", fromAddress),
      to,
      subject,
      html,
      resendErrorMessage: "Resend failed to send OTP email",
    });

    return { success: true, messageId: result.messageId, provider: result.provider };
  } catch (error) {
    const err = new Error(mapEmailErrorMessage(error, "Failed to send OTP email"));
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

// Meeting reminder function
const sendMeetingReminderEmail = async (user, meeting) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();

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

    const subject = `Reminder: Meeting "${meeting.title}"`;
    const html = `
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
      `;

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Job Portal", fromAddress),
      to: user.email,
      subject,
      html,
      verifySmtp: true,
      resendErrorMessage: "Resend failed to send meeting reminder email",
    });

    console.log(`Meeting reminder sent to ${user.email} via ${result.provider}: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error(`Failed to send reminder to ${user.email}:`, error);
    const err = new Error(mapEmailErrorMessage(error, "Failed to send meeting reminder email"));
    err.statusCode = error?.statusCode || 500;
    throw err; 
  }
};

const sendInquiryResponseEmail = async (inquiry, replyMessage, recipientEmail = null, context = null) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();
    
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

    const subject = `Response to your inquiry: ${inquiry.subject}`;
    const html = `
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
                <p>Thank you for reaching out to us.<br/>Blue Whale Migration Team</p>
              </div>
            </div>
          </body>
        </html>
      `;

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Blue Whale Migration", fromAddress),
      to: toEmail,
      subject,
      html,
      resendErrorMessage: "Resend failed to send inquiry response email",
    });

    console.log(`Inquiry response email sent to ${toEmail} via ${result.provider}: ${result.messageId}`);
    return result;
  } catch (error) {
    console.error("Failed to send inquiry response email:", error);
    const err = new Error(mapEmailErrorMessage(error, "Failed to send inquiry response email"));
    err.statusCode = error?.statusCode || 500;
    throw err;
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

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Blue Whale Migration Billing", fromAddress),
      to,
      subject,
      html,
      resendAttachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          content: Buffer.isBuffer(pdfBuffer)
            ? pdfBuffer.toString("base64")
            : Buffer.from(pdfBuffer).toString("base64"),
        },
      ],
      smtpAttachments: [
        {
          filename: `${invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
      verifySmtp: true,
      resendErrorMessage: "Resend failed to send invoice email",
    });

    return result;
  } catch (error) {
    console.error("Failed to send invoice email:", error);
    const message = mapEmailErrorMessage(error, "Failed to send invoice email");
    const err = new Error(message);
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

const sendPortalWelcomeEmail = async ({
  to,
  name,
  userType,
  password = "11112222",
  portalUrl = "",
}) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();
    const safeName = String(name || "there").trim() || "there";
    const loginUrl = resolveClientUrl(
      portalUrl || process.env.JOB_PORTAL_URL || process.env.CLIENT_URL || process.env.FRONTEND_URL
    );
    const subject = "Welcome to Blue Whale Job Portal";
    const accountLabel = String(userType || "").toLowerCase() === "agent" ? "B2B Agent" : "B2C Candidate";
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f7fb;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; border: 1px solid #e5e7eb;">
          <h2 style="margin: 0 0 12px; color: #1e3a8a;">Welcome to Blue Whale Job Portal</h2>
          <p style="margin: 0 0 16px; color: #334155;">Hi ${safeName}, your ${accountLabel} portal account has been created by our CRM team.</p>
          <div style="background:#eff6ff;border-radius:10px;padding:16px;margin:16px 0;">
            <p style="margin:0 0 8px;color:#0f172a;"><strong>Login email:</strong> ${to}</p>
            <p style="margin:0 0 8px;color:#0f172a;"><strong>Temporary password:</strong> ${password}</p>
            ${loginUrl ? `<p style="margin:0;color:#0f172a;"><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>` : ""}
          </div>
          <div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:14px;margin:18px 0;">
            Please log in and change your password immediately for security.
          </div>
          <p style="margin: 0; color: #64748b;">If you did not expect this account, please contact Blue Whale Migration support.</p>
        </div>
      </div>
    `;

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Blue Whale Migration", fromAddress),
      to,
      subject,
      html,
      resendErrorMessage: "Resend failed to send welcome email",
    });

    return { success: true, messageId: result.messageId, provider: result.provider };
  } catch (error) {
    const err = new Error(mapEmailErrorMessage(error, "Failed to send welcome email"));
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

const sendLeadReminderEmail = async ({
  to,
  creatorName,
  leadName,
  leadEmail = "",
  leadPhone = "",
  title,
  message = "",
  remindAt,
}) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();
    const safeName = String(creatorName || "there").trim() || "there";
    const safeLeadName = String(leadName || "Lead").trim() || "Lead";
    const subject = `Lead reminder due: ${title || safeLeadName}`;
    const formattedRemindAt = remindAt
      ? new Date(remindAt).toLocaleString("en-GB", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f7fb;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; border: 1px solid #e5e7eb;">
          <h2 style="margin: 0 0 12px; color: #1e3a8a;">Lead reminder due</h2>
          <p style="margin: 0 0 16px; color: #334155;">Hi ${safeName}, this is your scheduled reminder for <strong>${safeLeadName}</strong>.</p>
          <div style="background:#eff6ff;border-radius:10px;padding:16px;margin:16px 0;">
            <p style="margin:0 0 8px;color:#0f172a;"><strong>Reminder title:</strong> ${title || safeLeadName}</p>
            ${formattedRemindAt ? `<p style="margin:0 0 8px;color:#0f172a;"><strong>Scheduled for:</strong> ${formattedRemindAt}</p>` : ""}
            <p style="margin:0 0 8px;color:#0f172a;"><strong>Lead name:</strong> ${safeLeadName}</p>
            ${leadEmail ? `<p style="margin:0 0 8px;color:#0f172a;"><strong>Lead email:</strong> ${leadEmail}</p>` : ""}
            ${leadPhone ? `<p style="margin:0;color:#0f172a;"><strong>Lead phone:</strong> ${leadPhone}</p>` : ""}
          </div>
          ${message ? `<div style="background:#f8fafc;border-left:4px solid #1e3a8a;border-radius:8px;padding:14px 16px;color:#334155;"><strong>Note:</strong><br/>${message}</div>` : ""}
          <p style="margin: 18px 0 0; color: #64748b;">Please follow up on this lead from the CRM dashboard.</p>
        </div>
      </div>
    `;

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Blue Whale CRM", fromAddress),
      to,
      subject,
      html,
      resendErrorMessage: "Resend failed to send lead reminder email",
    });

    return { success: true, messageId: result.messageId, provider: result.provider };
  } catch (error) {
    const err = new Error(mapEmailErrorMessage(error, "Failed to send lead reminder email"));
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

const sendAdminAccountWelcomeEmail = async ({
  to,
  name,
  role,
  password,
  loginUrl = "",
}) => {
  try {
    assertEmailConfigured();
    const fromAddress = getFromAddress();
    const safeName = String(name || "there").trim() || "there";
    const safeRole = String(role || "Team Member").trim() || "Team Member";
    const safePassword = String(password || "").trim();
    const resolvedLoginUrl = resolveClientUrl(
      loginUrl ||
      process.env.CRM_LOGIN_URL ||
      process.env.PUBLIC_CRM_URL ||
      "https://app.bluewhalemigration.com/crm/"
    );
    const subject = "Your Blue Whale CRM account is ready";
    const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f4f7fb;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; border: 1px solid #e5e7eb;">
          <h2 style="margin: 0 0 12px; color: #1e3a8a;">Welcome to Blue Whale CRM</h2>
          <p style="margin: 0 0 16px; color: #334155;">Hi ${safeName}, your CRM account has been created successfully.</p>
          <div style="background:#eff6ff;border-radius:10px;padding:16px;margin:16px 0;">
            <p style="margin:0 0 8px;color:#0f172a;"><strong>User role:</strong> ${safeRole}</p>
            <p style="margin:0 0 8px;color:#0f172a;"><strong>Username:</strong> ${to}</p>
            <p style="margin:0 0 8px;color:#0f172a;"><strong>Temporary password:</strong> ${safePassword}</p>
            ${resolvedLoginUrl ? `<p style="margin:0;color:#0f172a;"><strong>Login link:</strong> <a href="${resolvedLoginUrl}">${resolvedLoginUrl}</a></p>` : ""}
          </div>
          <div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;padding:14px;margin:18px 0;">
            Please log in and change your password immediately for security.
          </div>
          <p style="margin: 0; color: #64748b;">If you were not expecting this account, please contact Blue Whale Migration support.</p>
        </div>
      </div>
    `;

    const result = await sendEmailWithFallback({
      fromAddress,
      smtpFrom: buildDisplayFromAddress("Blue Whale CRM", fromAddress),
      to,
      subject,
      html,
      resendErrorMessage: "Resend failed to send admin welcome email",
    });

    return { success: true, messageId: result.messageId, provider: result.provider };
  } catch (error) {
    const err = new Error(mapEmailErrorMessage(error, "Failed to send admin welcome email"));
    err.statusCode = error?.statusCode || 500;
    throw err;
  }
};

module.exports = {
  sendPasswordResetEmail,
  sendMeetingReminderEmail,
  sendInquiryResponseEmail,
  sendInvoiceEmail,
  sendAdminLoginOtpEmail,
  sendPortalWelcomeEmail,
  sendLeadReminderEmail,
  sendAdminAccountWelcomeEmail,
};
