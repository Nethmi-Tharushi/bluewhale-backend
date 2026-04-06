require("dotenv").config();
const mongoose = require("mongoose");

const AdminUser = require("../models/AdminUser");
const WhatsAppCampaign = require("../models/WhatsAppCampaign");
const WhatsAppContact = require("../models/WhatsAppContact");
const WhatsAppConversation = require("../models/WhatsAppConversation");
const WhatsAppTemplate = require("../models/WhatsAppTemplate");

const DEV_NOTE = "Local dev seed for WhatsApp campaign pagination testing";
const DEFAULT_TIMEZONE = "Asia/Colombo";

const trimString = (value) => String(value || "").trim();

const shiftDate = ({ days = 0, hours = 0, minutes = 0 } = {}) => {
  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + days);
  next.setHours(next.getHours() + hours);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
};

const uniqueStrings = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = trimString(value);
    if (!normalized) return false;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
};

const buildSegmentSummary = (conversations = []) => {
  const counts = new Map();

  conversations.forEach((conversation) => {
    const tags = Array.isArray(conversation.tags) ? conversation.tags : [];
    uniqueStrings(tags).forEach((tag) => {
      counts.set(tag, Number(counts.get(tag) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag, audienceSize]) => ({ tag, audienceSize }));
};

const buildTemplateLookup = (templates = []) => {
  const byName = new Map();
  const ordered = [...templates].sort((left, right) => left.name.localeCompare(right.name));

  ordered.forEach((template) => {
    byName.set(trimString(template.name).toLowerCase(), {
      templateId: trimString(template.templateId),
      templateName: trimString(template.name),
      language: trimString(template.language || "en_US") || "en_US",
    });
  });

  const pick = (...preferredNames) => {
    for (const name of preferredNames) {
      const match = byName.get(trimString(name).toLowerCase());
      if (match) {
        return match;
      }
    }

    return ordered[0]
      ? {
          templateId: trimString(ordered[0].templateId),
          templateName: trimString(ordered[0].name),
          language: trimString(ordered[0].language || "en_US") || "en_US",
        }
      : null;
  };

  return { pick };
};

const buildAdminLookup = (admins = []) => {
  const byRole = new Map();
  admins.forEach((admin) => {
    if (!byRole.has(admin.role)) {
      byRole.set(admin.role, []);
    }
    byRole.get(admin.role).push(admin);
  });

  const pick = (...roles) => {
    for (const role of roles) {
      const items = byRole.get(role) || [];
      if (items.length) {
        return items[0];
      }
    }
    return admins[0] || null;
  };

  return { pick };
};

const computeAudienceSize = ({ audienceType, manualContactIds, segmentIds, contacts, conversations }) => {
  if (audienceType === "all_contacts") {
    return contacts.length;
  }

  if (audienceType === "manual") {
    return uniqueStrings(manualContactIds).length;
  }

  const targetTags = new Set(uniqueStrings(segmentIds).map((tag) => tag.toLowerCase()));
  if (!targetTags.size) {
    return 0;
  }

  const contactIds = new Set();
  conversations.forEach((conversation) => {
    const tags = Array.isArray(conversation.tags) ? conversation.tags : [];
    if (tags.some((tag) => targetTags.has(trimString(tag).toLowerCase()))) {
      contactIds.add(trimString(conversation.contactId));
    }
  });
  return contactIds.size;
};

const buildComposeCampaign = (definition) => ({
  contentMode: "compose",
  messageTitle: definition.messageTitle || "",
  headerText: definition.headerText || "",
  bodyText: definition.bodyText || "",
  ctaText: definition.ctaText || "",
  ctaUrl: definition.ctaUrl || "",
  quickReplies: Array.isArray(definition.quickReplies) ? definition.quickReplies : [],
  contentLabel: definition.messageTitle || definition.name,
  templateId: "",
  templateName: "",
  templateVariables: {},
});

const buildTemplateCampaign = (definition, template) => ({
  contentMode: "template",
  contentLabel: template.templateName,
  templateId: template.templateId,
  templateName: template.templateName,
  templateVariables: {
    language: template.language,
    ...(definition.templateVariables || {}),
  },
  messageTitle: definition.messageTitle || "",
  headerText: "",
  bodyText: definition.bodyText || "",
  ctaText: definition.ctaText || "",
  ctaUrl: definition.ctaUrl || "",
  quickReplies: Array.isArray(definition.quickReplies) ? definition.quickReplies : [],
});

const CAMPAIGN_BLUEPRINTS = [
  {
    name: "Free Assessment Promotion",
    type: "Promotional",
    channel: "WhatsApp",
    audienceType: "all_contacts",
    scheduleType: "send_now",
    status: "Sent",
    templateKey: "welcome_offer",
    stats: { sent: 15, delivered: 13, read: 8, clicked: 4, failed: 2 },
    timestamps: {
      createdAt: shiftDate({ days: -21 }),
      updatedAt: shiftDate({ days: -18, hours: 2 }),
      launchedAt: shiftDate({ days: -18 }),
    },
    notes: "Promoted free migration assessments to opted-in WhatsApp contacts.",
  },
  {
    name: "Interview Preparation Reminder",
    type: "Reminder",
    channel: "WhatsApp",
    audienceType: "segments",
    segmentNames: ["Interview Prep", "High Intent Clients"],
    scheduleType: "later",
    status: "Scheduled",
    messageTitle: "Interview prep reminder",
    headerText: "Blue Whale Migration",
    bodyText: "Your interview preparation session is coming up soon. Reply if you need the checklist again.",
    ctaText: "Review checklist",
    ctaUrl: "https://app.bluewhalemigration.com/interview-prep",
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -5 }),
      updatedAt: shiftDate({ days: -1 }),
      scheduledAt: shiftDate({ days: 2, hours: 3 }),
    },
  },
  {
    name: "Consultation Slot Promotion",
    type: "Promotional",
    channel: "Both",
    audienceType: "manual",
    manualCount: 3,
    scheduleType: "send_now",
    status: "Sent",
    templateKey: "webinar_save_my_seat",
    stats: { sent: 3, delivered: 3, read: 2, clicked: 1, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -16 }),
      updatedAt: shiftDate({ days: -13, hours: 4 }),
      launchedAt: shiftDate({ days: -13 }),
    },
    notes: "Targeted consultation slot offer for warm leads.",
  },
  {
    name: "Work Visa Documents Follow-up",
    type: "Follow-up",
    channel: "WhatsApp",
    audienceType: "manual",
    manualCount: 4,
    scheduleType: "draft",
    status: "Draft",
    messageTitle: "Work visa documents follow-up",
    headerText: "Required next steps",
    bodyText: "Please upload the remaining work visa documents so our team can continue your application review.",
    ctaText: "Upload docs",
    ctaUrl: "https://app.bluewhalemigration.com/documents",
    quickReplies: ["Uploaded", "Need help"],
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -3 }),
      updatedAt: shiftDate({ days: -2, hours: 2 }),
    },
  },
  {
    name: "Student Intake Reminder May",
    type: "Reminder",
    channel: "WhatsApp",
    audienceType: "segments",
    segmentNames: ["Students", "Consultation Pending"],
    scheduleType: "later",
    status: "Scheduled",
    templateKey: "webinar_save_my_seat",
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -4 }),
      updatedAt: shiftDate({ days: -1, hours: -2 }),
      scheduledAt: shiftDate({ days: 5, hours: 1 }),
    },
  },
  {
    name: "New Leads Welcome Burst",
    type: "Broadcast",
    channel: "WhatsApp",
    audienceType: "all_contacts",
    scheduleType: "send_now",
    status: "Running",
    templateKey: "hello_world",
    stats: { sent: 7, delivered: 5, read: 2, clicked: 0, failed: 1 },
    timestamps: {
      createdAt: shiftDate({ days: -1, hours: -6 }),
      updatedAt: shiftDate({ hours: -2 }),
      launchedAt: shiftDate({ hours: -3 }),
    },
  },
  {
    name: "Assessment Follow-up Push",
    type: "Follow-up",
    channel: "WhatsApp",
    audienceType: "segments",
    segmentNames: ["Assessment Promo", "Follow-up Required"],
    scheduleType: "send_now",
    status: "Paused",
    messageTitle: "Assessment follow-up",
    headerText: "Blue Whale Migration",
    bodyText: "We noticed you have not booked your assessment yet. Our consultants still have a few slots open this week.",
    ctaText: "Book assessment",
    ctaUrl: "https://app.bluewhalemigration.com/assessment",
    stats: { sent: 4, delivered: 4, read: 2, clicked: 1, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -7 }),
      updatedAt: shiftDate({ days: -3, hours: 5 }),
      launchedAt: shiftDate({ days: -4 }),
      pausedAt: shiftDate({ days: -3 }),
    },
  },
  {
    name: "Overseas Jobs April Push",
    type: "Broadcast",
    channel: "Instagram",
    audienceType: "segments",
    segmentNames: ["Overseas Jobs Leads", "High Intent Clients"],
    scheduleType: "later",
    status: "Cancelled",
    messageTitle: "Overseas jobs push",
    headerText: "April hiring update",
    bodyText: "We paused this push after the first planning review, but it remains useful for frontend status coverage.",
    ctaText: "View roles",
    ctaUrl: "https://app.bluewhalemigration.com/jobs",
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -12 }),
      updatedAt: shiftDate({ days: -10 }),
      scheduledAt: shiftDate({ days: -9 }),
      cancelledAt: shiftDate({ days: -8 }),
    },
  },
  {
    name: "Document Checklist Reminder",
    type: "Reminder",
    channel: "WhatsApp",
    audienceType: "manual",
    manualCount: 2,
    scheduleType: "send_now",
    status: "Failed",
    templateKey: "feedback",
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 2 },
    timestamps: {
      createdAt: shiftDate({ days: -9 }),
      updatedAt: shiftDate({ days: -8, hours: 1 }),
      launchedAt: shiftDate({ days: -8 }),
    },
    notes: "Retained as a failed sample for frontend filters and empty analytics edge cases.",
  },
  {
    name: "Visa Eligibility Callback Reminder",
    type: "Reminder",
    channel: "Both",
    audienceType: "manual",
    manualCount: 3,
    scheduleType: "send_now",
    status: "Sent",
    messageTitle: "Visa eligibility callback",
    headerText: "Callback reminder",
    bodyText: "Our consultant tried reaching you about your visa eligibility review. Reply with a convenient time for a callback.",
    ctaText: "Confirm callback",
    ctaUrl: "https://app.bluewhalemigration.com/callback",
    stats: { sent: 3, delivered: 3, read: 1, clicked: 1, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -11 }),
      updatedAt: shiftDate({ days: -9, hours: 6 }),
      launchedAt: shiftDate({ days: -9 }),
    },
  },
  {
    name: "Student Visa Callback Wave",
    type: "Follow-up",
    channel: "WhatsApp",
    audienceType: "manual",
    manualCount: 4,
    scheduleType: "draft",
    status: "Draft",
    messageTitle: "Student visa callback wave",
    headerText: "Admissions follow-up",
    bodyText: "We are ready to review your student visa options. Share your preferred callback time and our team will reach out.",
    ctaText: "Share availability",
    ctaUrl: "https://app.bluewhalemigration.com/callback",
    quickReplies: ["Morning", "Afternoon", "Evening"],
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -2 }),
      updatedAt: shiftDate({ days: -1, hours: 4 }),
    },
  },
  {
    name: "Work Visa Expo Warm Audience",
    type: "Promotional",
    channel: "WhatsApp",
    audienceType: "segments",
    segmentNames: ["Work Migration Leads", "Students"],
    scheduleType: "later",
    status: "Scheduled",
    templateKey: "welcome_offer",
    stats: { sent: 0, delivered: 0, read: 0, clicked: 0, failed: 0 },
    timestamps: {
      createdAt: shiftDate({ days: -6 }),
      updatedAt: shiftDate({ days: -1, hours: -1 }),
      scheduledAt: shiftDate({ days: 4, hours: 2 }),
    },
  },
];

async function seedWhatsAppCampaigns() {
  try {
    const runningInProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const allowDevSeedOverride = String(process.env.ALLOW_DEV_SEED || "").toLowerCase() === "true";
    if (runningInProduction && !allowDevSeedOverride) {
      throw new Error("WhatsApp campaign seeding is blocked in production unless ALLOW_DEV_SEED=true is set explicitly");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const [admins, contacts, conversations, templates] = await Promise.all([
      AdminUser.find({}).select("_id name email role").lean(),
      WhatsAppContact.find({}).select("_id phone waId name").sort({ createdAt: 1 }).lean(),
      WhatsAppConversation.find({ channel: "whatsapp" }).select("_id contactId tags").sort({ createdAt: 1 }).lean(),
      WhatsAppTemplate.find({ status: "APPROVED" }).select("templateId name language status").sort({ updatedAt: -1 }).lean(),
    ]);

    if (!admins.length) {
      throw new Error("No admin users found; seed admin users first");
    }

    if (contacts.length < 4) {
      throw new Error("At least four WhatsApp contacts are required before seeding campaigns");
    }

    if (!templates.length) {
      throw new Error("No approved WhatsApp templates found; sync or create templates first");
    }

    const adminLookup = buildAdminLookup(admins);
    const templateLookup = buildTemplateLookup(templates);
    const segmentSummary = buildSegmentSummary(conversations);
    const availableSegmentNames = segmentSummary.map((item) => item.tag);
    const manualContactIds = contacts.map((contact) => String(contact._id));

    let manualCursor = 0;
    const pickManualContacts = (count) => {
      const results = [];
      for (let index = 0; index < count; index += 1) {
        results.push(manualContactIds[(manualCursor + index) % manualContactIds.length]);
      }
      manualCursor += count;
      return uniqueStrings(results);
    };

    const createdNames = [];
    const skippedNames = [];

    for (const blueprint of CAMPAIGN_BLUEPRINTS) {
      const existing = await WhatsAppCampaign.findOne({ name: blueprint.name }).select("_id name").lean();
      if (existing) {
        skippedNames.push(blueprint.name);
        continue;
      }

      const createdBy = adminLookup.pick("MainAdmin", "SalesAdmin", "SalesStaff");
      const updatedBy = adminLookup.pick("SalesAdmin", "MainAdmin", "SalesStaff");
      const launchedBy = adminLookup.pick("SalesStaff", "SalesAdmin", "MainAdmin");

      const resolvedSegmentIds = blueprint.audienceType === "segments"
        ? uniqueStrings(
            (blueprint.segmentNames || []).filter((tag) => availableSegmentNames.includes(tag))
          )
        : [];
      const segmentIds = blueprint.audienceType === "segments"
        ? (resolvedSegmentIds.length ? resolvedSegmentIds : availableSegmentNames.slice(0, 2))
        : [];
      const contactIds = blueprint.audienceType === "manual"
        ? pickManualContacts(blueprint.manualCount || 3)
        : [];
      const template = blueprint.templateKey
        ? templateLookup.pick(blueprint.templateKey)
        : null;

      const basePayload = {
        name: blueprint.name,
        type: blueprint.type,
        channel: blueprint.channel,
        status: blueprint.status,
        audienceType: blueprint.audienceType,
        segmentIds,
        manualContactIds: contactIds,
        scheduleType: blueprint.scheduleType,
        scheduledAt: blueprint.timestamps.scheduledAt || null,
        timezone: DEFAULT_TIMEZONE,
        notes: blueprint.notes || DEV_NOTE,
        batchEnabled: Boolean(blueprint.scheduleType === "later"),
        skipInactiveContacts: false,
        stopIfTemplateMissing: Boolean(template),
        stats: blueprint.stats,
        launchedAt: blueprint.timestamps.launchedAt || null,
        pausedAt: blueprint.timestamps.pausedAt || null,
        resumedAt: blueprint.timestamps.resumedAt || null,
        cancelledAt: blueprint.timestamps.cancelledAt || null,
        createdBy: createdBy?._id || null,
        updatedBy: updatedBy?._id || createdBy?._id || null,
        launchedBy: blueprint.timestamps.launchedAt ? launchedBy?._id || updatedBy?._id || null : null,
      };

      const contentPayload = template
        ? buildTemplateCampaign(blueprint, template)
        : buildComposeCampaign(blueprint);
      const audienceSize = computeAudienceSize({
        audienceType: blueprint.audienceType,
        manualContactIds: contactIds,
        segmentIds,
        contacts,
        conversations,
      });

      const campaign = await WhatsAppCampaign.create({
        ...basePayload,
        ...contentPayload,
        audienceSize,
      });

      await WhatsAppCampaign.collection.updateOne(
        { _id: campaign._id },
        {
          $set: {
            createdAt: blueprint.timestamps.createdAt || campaign.createdAt,
            updatedAt: blueprint.timestamps.updatedAt || blueprint.timestamps.createdAt || campaign.updatedAt,
          },
        }
      );

      createdNames.push(blueprint.name);
    }

    const [totalCampaigns, statusBreakdown] = await Promise.all([
      WhatsAppCampaign.countDocuments({}),
      WhatsAppCampaign.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    console.log("WhatsApp campaigns seeded successfully.");
    console.log(
      JSON.stringify(
        {
          campaignsCreated: createdNames.length,
          campaignsSkipped: skippedNames.length,
          createdNames,
          skippedNames,
          totalCampaigns,
          statusBreakdown,
        },
        null,
        2
      )
    );

    process.exit(0);
  } catch (error) {
    console.error("Failed to seed WhatsApp campaigns:", error);
    process.exit(1);
  }
}

seedWhatsAppCampaigns();
