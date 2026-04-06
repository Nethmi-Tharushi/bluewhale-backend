const WhatsAppCampaign = require("../models/WhatsAppCampaign");
const WhatsAppCampaignJob = require("../models/WhatsAppCampaignJob");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const {
  ensureConversation,
  saveOutgoingMessage,
} = require("./whatsappCRMService");
const { getTemplateById, prepareTemplateMessage } = require("./whatsappTemplateService");
const { sendMessage } = require("./whatsappService");

let workerInterval = null;
let workerInFlight = false;

const ACTIVE_JOB_STATUSES = new Set(["pending", "processing"]);
const DELIVERY_SUCCESS_JOB_STATUSES = new Set(["sent", "delivered", "read"]);
const TERMINAL_JOB_STATUSES = new Set(["sent", "delivered", "read", "failed", "cancelled"]);

const trimString = (value) => String(value || "").trim();

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

const toDateOrNull = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const millis = value < 1e12 ? value * 1000 : value;
    const fromNumber = new Date(millis);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(value).trim() !== "") {
    const millis = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const fromNumericString = new Date(millis);
    return Number.isNaN(fromNumericString.getTime()) ? null : fromNumericString;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getCampaignHelpers = () => {
  const campaignService = require("./whatsappCampaignService");
  return campaignService.__private || {};
};

const dedupeContacts = (contacts = []) => {
  const seen = new Set();
  const deduped = [];

  for (const contactDoc of contacts) {
    const contact = toObject(contactDoc);
    const dedupeKey = trimString(contact._id || contact.id || contact.phone || contact.waId).toLowerCase();
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    deduped.push(contact);
  }

  return deduped.filter((contact) => trimString(contact.phone || contact.waId));
};

const resolveManualAudienceContacts = async (manualContactIds = []) => {
  const tokens = Array.isArray(manualContactIds)
    ? manualContactIds.map((value) => trimString(value)).filter(Boolean)
    : [];

  if (!tokens.length) {
    return [];
  }

  const objectIdTokens = tokens.filter((value) => /^[a-fA-F0-9]{24}$/.test(value));
  const query = {
    $or: [
      objectIdTokens.length ? { _id: { $in: objectIdTokens } } : null,
      { phone: { $in: tokens } },
      { waId: { $in: tokens } },
    ].filter(Boolean),
  };

  const contacts = await WhatsAppContact.find(query).lean();
  return dedupeContacts(contacts);
};

const resolveSegmentAudienceContacts = async (segmentIds = []) => {
  const tokens = Array.isArray(segmentIds)
    ? segmentIds.map((value) => trimString(value)).filter(Boolean)
    : [];

  if (!tokens.length) {
    return [];
  }

  const conversations = await WhatsAppConversation.find({
    channel: "whatsapp",
    tags: { $in: tokens },
  })
    .populate("contactId")
    .lean();

  return dedupeContacts(conversations.map((conversation) => conversation.contactId).filter(Boolean));
};

const resolveCampaignAudienceContacts = async (campaignDoc) => {
  const campaign = toObject(campaignDoc);
  const audienceType = trimString(campaign.audienceType || "manual");

  if (audienceType === "all_contacts") {
    const contacts = await WhatsAppContact.find({}).sort({ lastActivityAt: -1, _id: 1 }).lean();
    return dedupeContacts(contacts);
  }

  if (audienceType === "segments") {
    return resolveSegmentAudienceContacts(campaign.segmentIds);
  }

  return resolveManualAudienceContacts(campaign.manualContactIds);
};

const buildAudienceSourceMap = (campaignDoc, contacts = []) => {
  const campaign = toObject(campaignDoc);
  const sourceMap = new Map();
  const audienceType = trimString(campaign.audienceType || "manual");

  if (audienceType === "segments") {
    for (const contact of contacts) {
      sourceMap.set(trimString(contact._id || contact.id || contact.phone), "segments");
    }
    return sourceMap;
  }

  if (audienceType === "all_contacts") {
    for (const contact of contacts) {
      sourceMap.set(trimString(contact._id || contact.id || contact.phone), "all_contacts");
    }
    return sourceMap;
  }

  for (const contact of contacts) {
    sourceMap.set(trimString(contact._id || contact.id || contact.phone), "manual");
  }
  return sourceMap;
};

const upsertCampaignJobsForAudience = async (campaignDoc, contacts = []) => {
  const campaign = toObject(campaignDoc);
  const now = new Date();
  const sourceMap = buildAudienceSourceMap(campaign, contacts);

  let queuedCount = 0;
  let completedRecipients = 0;

  for (const [index, contact] of contacts.entries()) {
    const contactId = trimString(contact._id || contact.id);
    if (!contactId || !trimString(contact.phone || contact.waId)) {
      continue;
    }

    const conversation = await ensureConversation({
      contactId,
      autoAssign: true,
    });

    const recipientPhone = trimString(contact.phone || contact.waId);
    let job = await WhatsAppCampaignJob.findOne({
      campaignId: campaign._id,
      recipientPhone,
    });

    if (job && DELIVERY_SUCCESS_JOB_STATUSES.has(trimString(job.status))) {
      completedRecipients += 1;
      continue;
    }

    const runAt = campaign.batchEnabled
      ? new Date(now.getTime() + index * 1000)
      : now;

    if (!job) {
      job = await WhatsAppCampaignJob.create({
        campaignId: campaign._id,
        contactId: contact._id,
        conversationId: conversation?._id || null,
        audienceSource: sourceMap.get(contactId) || trimString(campaign.audienceType || "manual") || "manual",
        recipientPhone,
        recipientName: trimString(contact.name || contact.profile?.name),
        runAt,
        status: "pending",
        metadata: {
          source: "campaign_launch",
        },
      });
    } else {
      job.contactId = contact._id;
      job.conversationId = conversation?._id || null;
      job.audienceSource = sourceMap.get(contactId) || job.audienceSource || "manual";
      job.recipientPhone = recipientPhone;
      job.recipientName = trimString(contact.name || contact.profile?.name);
      job.runAt = runAt;
      job.status = "pending";
      job.errorMessage = "";
      job.resultSummary = "";
      job.processedAt = null;
      job.failedAt = null;
      job.metadata = {
        ...(toObject(job.metadata) || {}),
        source: "campaign_launch",
      };
      await job.save();
    }

    queuedCount += 1;
  }

  return {
    totalRecipients: contacts.length,
    queuedCount,
    completedRecipients,
  };
};

const buildCampaignJobCounts = (jobs = []) => jobs.reduce((summary, jobDoc) => {
  const job = toObject(jobDoc);
  const status = trimString(job.status || "pending");
  summary.total += 1;
  summary[status] = Number(summary[status] || 0) + 1;

  if (DELIVERY_SUCCESS_JOB_STATUSES.has(status)) {
    summary.sentLike += 1;
  }

  if (status === "delivered" || status === "read") {
    summary.deliveredLike += 1;
  }

  if (status === "read") {
    summary.readLike += 1;
  }

  if (ACTIVE_JOB_STATUSES.has(status)) {
    summary.active += 1;
  }

  return summary;
}, {
  total: 0,
  active: 0,
  sentLike: 0,
  deliveredLike: 0,
  readLike: 0,
  pending: 0,
  processing: 0,
  paused: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  cancelled: 0,
});

const syncCampaignStats = async (campaignId) => {
  const [campaign, jobs] = await Promise.all([
    WhatsAppCampaign.findById(campaignId),
    WhatsAppCampaignJob.find({ campaignId }).lean(),
  ]);

  if (!campaign) {
    return null;
  }

  const counts = buildCampaignJobCounts(jobs);
  const nextStats = {
    sent: counts.sentLike,
    delivered: counts.deliveredLike,
    read: counts.readLike,
    clicked: Number(campaign.stats?.clicked || 0),
    failed: counts.failed,
  };

  campaign.stats = nextStats;
  if (counts.total > 0) {
    campaign.audienceSize = counts.total;
  }

  if (campaign.status !== "Cancelled" && campaign.status !== "Paused") {
    if (counts.active > 0) {
      campaign.status = "Running";
    } else if (counts.total > 0) {
      campaign.status = counts.sentLike > 0 ? "Sent" : counts.failed > 0 ? "Failed" : campaign.status;
    }
  }

  await campaign.save();
  return {
    campaign,
    counts,
  };
};

const buildTemplatePayload = async (campaignDoc) => {
  const campaign = toObject(campaignDoc);
  const { buildTemplateSendComponents } = getCampaignHelpers();

  if (campaign.stopIfTemplateMissing) {
    const template = await getTemplateById(campaign.templateId, { includeSyncFallback: false });
    if (!template) {
      throw createHttpError("Selected template could not be found for this campaign");
    }
  }

  return prepareTemplateMessage({
    template: {
      id: trimString(campaign.templateId),
      name: trimString(campaign.templateName),
      language: trimString(campaign.templateVariables?.language || "en_US") || "en_US",
      components: typeof buildTemplateSendComponents === "function"
        ? buildTemplateSendComponents(campaign.templateVariables)
        : [],
    },
  });
};

const sendCampaignJobMessage = async ({ app, campaignDoc, jobDoc }) => {
  const campaign = toObject(campaignDoc);
  const job = jobDoc;

  const [contact, conversation] = await Promise.all([
    WhatsAppContact.findById(job.contactId),
    job.conversationId ? WhatsAppConversation.findById(job.conversationId) : null,
  ]);

  if (!contact?.phone) {
    throw createHttpError("Campaign job contact could not be resolved");
  }

  const resolvedConversation = conversation || await ensureConversation({
    contactId: contact._id,
    autoAssign: true,
  });

  const { buildComposeCampaignText } = getCampaignHelpers();
  const context = {
    conversationId: resolvedConversation._id,
    contactId: contact._id,
    agentId: resolvedConversation.agentId || null,
    campaignId: campaign._id,
    campaignJobId: job._id,
    source: "whatsapp_campaign",
  };

  let sendResult;
  let savedMessage;
  let content;

  if (trimString(campaign.contentMode || "compose") === "template") {
    const template = await buildTemplatePayload(campaign);
    sendResult = await sendMessage({
      to: contact.phone,
      type: "template",
      template,
      context,
    });
    content = `Template: ${template.name}`;
    savedMessage = await saveOutgoingMessage({
      app,
      conversation: resolvedConversation,
      contact,
      agentId: resolvedConversation.agentId || null,
      messageType: "template",
      content,
      response: sendResult.response,
      requestPayload: sendResult.payload,
      sender: "system",
      additionalMetadata: {
        campaign: {
          campaignId: trimString(campaign._id),
          campaignJobId: trimString(job._id),
          name: trimString(campaign.name),
        },
      },
    });
  } else {
    const text = typeof buildComposeCampaignText === "function"
      ? buildComposeCampaignText(campaign)
      : trimString(campaign.bodyText);

    if (!trimString(text)) {
      throw createHttpError("This campaign does not have any sendable compose content");
    }

    sendResult = await sendMessage({
      to: contact.phone,
      type: "text",
      text,
      context,
    });
    content = text;
    savedMessage = await saveOutgoingMessage({
      app,
      conversation: resolvedConversation,
      contact,
      agentId: resolvedConversation.agentId || null,
      messageType: "text",
      content,
      response: sendResult.response,
      requestPayload: sendResult.payload,
      sender: "system",
      additionalMetadata: {
        campaign: {
          campaignId: trimString(campaign._id),
          campaignJobId: trimString(job._id),
          name: trimString(campaign.name),
        },
      },
    });
  }

  const messageSentAt = new Date();
  job.conversationId = resolvedConversation._id;
  job.messageId = savedMessage?._id || null;
  job.externalMessageId = trimString(sendResult?.response?.messages?.[0]?.id || savedMessage?.externalMessageId);
  job.status = "sent";
  job.sentAt = messageSentAt;
  job.processedAt = messageSentAt;
  job.resultSummary = "Message sent to recipient";
  job.errorMessage = "";
  job.attemptCount = Number(job.attemptCount || 0) + 1;
  await job.save();
};

const launchCampaign = async ({ campaignId, actorId = null, app = null, launchedBy = "manual" } = {}) => {
  const campaign = await WhatsAppCampaign.findById(campaignId);
  if (!campaign) {
    throw createHttpError("WhatsApp campaign not found", 404);
  }

  const contacts = await resolveCampaignAudienceContacts(campaign);
  if (!contacts.length) {
    throw createHttpError("This campaign does not have any resolvable audience contacts");
  }

  const now = new Date();
  campaign.status = "Running";
  campaign.launchedAt = now;
  campaign.cancelledAt = null;
  campaign.pausedAt = null;
  if (actorId) {
    campaign.updatedBy = actorId;
    campaign.launchedBy = actorId;
  }
  campaign.audienceSize = contacts.length;
  await campaign.save();

  await upsertCampaignJobsForAudience(campaign, contacts);
  await syncCampaignStats(campaign._id);

  return {
    campaignId: trimString(campaign._id),
    launchedBy,
    audienceSize: contacts.length,
  };
};

const pauseCampaignJobs = async (campaignId) => {
  await WhatsAppCampaignJob.updateMany(
    {
      campaignId,
      status: { $in: ["pending"] },
    },
    {
      $set: {
        status: "paused",
        processedAt: new Date(),
      },
    }
  );

  return syncCampaignStats(campaignId);
};

const resumeCampaignJobs = async (campaignId) => {
  await WhatsAppCampaignJob.updateMany(
    {
      campaignId,
      status: "paused",
    },
    {
      $set: {
        status: "pending",
        runAt: new Date(),
        processedAt: null,
      },
    }
  );

  return syncCampaignStats(campaignId);
};

const cancelCampaignJobs = async (campaignId) => {
  await WhatsAppCampaignJob.updateMany(
    {
      campaignId,
      status: { $in: ["pending", "paused"] },
    },
    {
      $set: {
        status: "cancelled",
        processedAt: new Date(),
      },
    }
  );

  return syncCampaignStats(campaignId);
};

const deleteCampaignJobs = async (campaignId) => {
  await WhatsAppCampaignJob.deleteMany({ campaignId });
};

const processDueScheduledCampaigns = async ({ app = null } = {}) => {
  const dueCampaigns = await WhatsAppCampaign.find({
    status: "Scheduled",
    scheduleType: "later",
    scheduledAt: { $lte: new Date() },
  })
    .sort({ scheduledAt: 1, _id: 1 })
    .limit(20);

  let launched = 0;

  for (const campaign of dueCampaigns) {
    try {
      await launchCampaign({
        campaignId: campaign._id,
        actorId: null,
        app,
        launchedBy: "scheduler",
      });
      launched += 1;
    } catch (error) {
      campaign.status = "Failed";
      campaign.updatedBy = null;
      campaign.notes = trimString(campaign.notes);
      await campaign.save();
      console.error("[WhatsAppCampaignWorker] Failed to launch scheduled campaign:", error);
    }
  }

  return launched;
};

const processPendingCampaignJobs = async (app = null) => {
  if (workerInFlight) {
    return { processed: 0, sent: 0, failed: 0 };
  }

  workerInFlight = true;

  try {
    const jobs = await WhatsAppCampaignJob.find({
      status: "pending",
      runAt: { $lte: new Date() },
    })
      .sort({ runAt: 1, _id: 1 })
      .limit(25);

    let processed = 0;
    let sent = 0;
    let failed = 0;
    const touchedCampaignIds = new Set();

    for (const job of jobs) {
      processed += 1;
      const campaign = await WhatsAppCampaign.findById(job.campaignId);

      if (!campaign) {
        job.status = "cancelled";
        job.errorMessage = "Campaign not found";
        job.processedAt = new Date();
        await job.save();
        continue;
      }

      if (campaign.status === "Cancelled") {
        job.status = "cancelled";
        job.errorMessage = "Campaign was cancelled";
        job.processedAt = new Date();
        await job.save();
        touchedCampaignIds.add(trimString(campaign._id));
        continue;
      }

      if (campaign.status === "Paused") {
        job.status = "paused";
        job.processedAt = new Date();
        await job.save();
        touchedCampaignIds.add(trimString(campaign._id));
        continue;
      }

      job.status = "processing";
      await job.save();

      try {
        await sendCampaignJobMessage({ app, campaignDoc: campaign, jobDoc: job });
        sent += 1;
      } catch (error) {
        job.status = "failed";
        job.failedAt = new Date();
        job.processedAt = new Date();
        job.errorMessage = error.message || "Campaign job send failed";
        job.resultSummary = "Send failed";
        job.attemptCount = Number(job.attemptCount || 0) + 1;
        await job.save();
        failed += 1;
      }

      touchedCampaignIds.add(trimString(campaign._id));
    }

    for (const campaignId of touchedCampaignIds) {
      await syncCampaignStats(campaignId);
    }

    return { processed, sent, failed };
  } finally {
    workerInFlight = false;
  }
};

const trackCampaignMessageStatus = async ({ message }) => {
  const plainMessage = toObject(message);
  const campaignMeta = plainMessage.metadata?.campaign || {};
  const jobId = trimString(campaignMeta.campaignJobId);
  const campaignId = trimString(campaignMeta.campaignId);

  let job = null;
  if (jobId) {
    job = await WhatsAppCampaignJob.findById(jobId);
  }

  if (!job && trimString(plainMessage.externalMessageId)) {
    job = await WhatsAppCampaignJob.findOne({ externalMessageId: trimString(plainMessage.externalMessageId) });
  }

  if (!job) {
    return null;
  }

  const timestamp = toDateOrNull(
    plainMessage.metadata?.lastStatusWebhookAt
      || plainMessage.rawPayload?.response?.messages?.[0]?.timestamp
      || plainMessage.timestamp
  ) || new Date();
  const status = trimString(plainMessage.status || job.status);

  if (status === "delivered") {
    job.status = "delivered";
    job.deliveredAt = timestamp;
  } else if (status === "read") {
    job.status = "read";
    job.readAt = timestamp;
    if (!job.deliveredAt) {
      job.deliveredAt = timestamp;
    }
  } else if (status === "failed") {
    job.status = "failed";
    job.failedAt = timestamp;
    job.errorMessage = trimString(plainMessage.errorMessage);
  } else if (status === "sent") {
    job.status = "sent";
    job.sentAt = job.sentAt || timestamp;
  } else {
    return null;
  }

  job.externalMessageId = trimString(job.externalMessageId || plainMessage.externalMessageId);
  job.messageId = plainMessage._id || job.messageId;
  job.processedAt = timestamp;
  await job.save();

  await syncCampaignStats(campaignId || job.campaignId);
  return job;
};

const startWhatsAppCampaignWorker = (app) => {
  if (workerInterval) {
    return workerInterval;
  }

  workerInterval = setInterval(() => {
    processDueScheduledCampaigns({ app })
      .then(() => processPendingCampaignJobs(app))
      .catch((error) => {
        console.error("[WhatsAppCampaignWorker] Worker failed:", error);
      });
  }, 15000);

  return workerInterval;
};

const stopWhatsAppCampaignWorker = () => {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
};

module.exports = {
  resolveCampaignAudienceContacts,
  launchCampaign,
  pauseCampaignJobs,
  resumeCampaignJobs,
  cancelCampaignJobs,
  deleteCampaignJobs,
  syncCampaignStats,
  processDueScheduledCampaigns,
  processPendingCampaignJobs,
  trackCampaignMessageStatus,
  startWhatsAppCampaignWorker,
  stopWhatsAppCampaignWorker,
  __private: {
    upsertCampaignJobsForAudience,
    resolveManualAudienceContacts,
    resolveSegmentAudienceContacts,
    buildCampaignJobCounts,
  },
};
