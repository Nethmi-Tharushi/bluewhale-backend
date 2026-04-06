require("dotenv").config();
const mongoose = require("mongoose");
const WhatsAppContact = require("./models/WhatsAppContact");
const WhatsAppConversation = require("./models/WhatsAppConversation");

const DEV_SEED_SOURCE = "dev_seed_whatsapp_tags";
const REQUIRED_CONVERSATION_COUNT = 15;
const TAG_DEFINITIONS = [
  "Student Visa Leads",
  "Work Migration Leads",
  "Consultation Pending",
  "Follow-up Required",
  "High Intent Clients",
  "Overseas Jobs Leads",
  "Students",
  "Document Reminder",
  "Interview Prep",
  "Assessment Promo",
];

const CONVERSATION_BLUEPRINTS = [
  ["Student Visa Leads", "Students", "Consultation Pending"],
  ["Student Visa Leads", "Document Reminder"],
  ["Student Visa Leads", "Assessment Promo"],
  ["Work Migration Leads", "High Intent Clients"],
  ["Work Migration Leads", "Follow-up Required"],
  ["Work Migration Leads", "Consultation Pending"],
  ["Overseas Jobs Leads", "Interview Prep"],
  ["Overseas Jobs Leads", "Follow-up Required"],
  ["Overseas Jobs Leads", "Assessment Promo"],
  ["Consultation Pending", "High Intent Clients"],
  ["Document Reminder", "Follow-up Required"],
  ["Interview Prep", "High Intent Clients"],
  ["Students", "Assessment Promo"],
  ["Students", "Follow-up Required"],
  ["Document Reminder", "Consultation Pending"],
];

const CONTACT_SEEDS = [
  { name: "Nimal Perera", phone: "+94770000011", source: "Facebook Leads" },
  { name: "Ayesha Silva", phone: "+94770000012", source: "Walk-in Inquiry" },
  { name: "Kasun Fernando", phone: "+94770000013", source: "WhatsApp" },
  { name: "Tharushi Jayasuriya", phone: "+94770000014", source: "Website Form" },
  { name: "Rashmi Herath", phone: "+94770000015", source: "Referral" },
  { name: "Dhanushka Madushanka", phone: "+94770000016", source: "Student Expo" },
  { name: "Ishara Wickramasinghe", phone: "+94770000017", source: "Jobs Landing Page" },
  { name: "Madhavi Senanayake", phone: "+94770000018", source: "Consultation Follow-up" },
  { name: "Chamodi De Silva", phone: "+94770000019", source: "Campaign Reply" },
  { name: "Yasan Wijeratne", phone: "+94770000020", source: "Meta Lead Ads" },
  { name: "Shenali Ranasinghe", phone: "+94770000021", source: "Referral" },
  { name: "Rukshan Abeysekara", phone: "+94770000022", source: "Walk-in Inquiry" },
  { name: "Nethmi Karunaratne", phone: "+94770000023", source: "Website Form" },
  { name: "Dinusha Ekanayake", phone: "+94770000024", source: "Jobs Landing Page" },
  { name: "Supun Hettiarachchi", phone: "+94770000025", source: "Facebook Leads" },
];

const trimString = (value) => String(value || "").trim();

const normalizeTags = (tags) => {
  const source = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
  const seen = new Set();
  const normalized = [];

  source.forEach((tag) => {
    const value = trimString(tag);
    if (!value) return;
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push(value);
  });

  return normalized;
};

const mergeTags = (existingTags, nextTags) => normalizeTags([...(existingTags || []), ...(nextTags || [])]);

const createContactPayload = (seed, index) => ({
  phone: seed.phone,
  waId: seed.phone,
  name: seed.name,
  source: DEV_SEED_SOURCE,
  profile: {
    name: seed.name,
    source: seed.source,
    optedIn: true,
    devSeed: true,
  },
  lastActivityAt: new Date(Date.now() - index * 60 * 60 * 1000),
});

const createConversationPayload = ({ contactId, tags, index }) => ({
  contactId,
  status: index % 4 === 0 ? "assigned" : "open",
  channel: "whatsapp",
  lastMessageAt: new Date(Date.now() - index * 45 * 60 * 1000),
  lastIncomingAt: new Date(Date.now() - index * 45 * 60 * 1000),
  lastOutgoingAt: index % 2 === 0 ? new Date(Date.now() - index * 30 * 60 * 1000) : null,
  lastMessagePreview: "Dev seed conversation for WhatsApp campaigns audience testing",
  unreadCount: 0,
  assignmentMethod: "unassigned",
  tags: normalizeTags(tags),
});

const ensureEnoughContacts = async (requiredCount) => {
  const existingSeedContacts = await WhatsAppContact.find({ source: DEV_SEED_SOURCE }).sort({ createdAt: 1 });
  const contacts = [...existingSeedContacts];

  for (let index = contacts.length; index < requiredCount; index += 1) {
    const seed = CONTACT_SEEDS[index % CONTACT_SEEDS.length];
    const contact = await WhatsAppContact.findOneAndUpdate(
      { phone: seed.phone },
      {
        $set: createContactPayload(seed, index),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
    contacts.push(contact);
  }

  return contacts;
};

const buildSegmentSummary = (conversations) => {
  const counts = new Map();

  conversations.forEach((conversation) => {
    normalizeTags(conversation.tags).forEach((tag) => {
      counts.set(tag, Number(counts.get(tag) || 0) + 1);
    });
  });

  return TAG_DEFINITIONS.map((tag) => ({
    tag,
    audienceSize: Number(counts.get(tag) || 0),
  })).filter((item) => item.audienceSize > 0);
};

async function seedWhatsAppConversationTags() {
  try {
    const runningInProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const allowDevSeedOverride = String(process.env.ALLOW_DEV_SEED || "").toLowerCase() === "true";
    if (runningInProduction && !allowDevSeedOverride) {
      throw new Error("WhatsApp tag seeding is blocked in production unless ALLOW_DEV_SEED=true is set explicitly");
    }

    await mongoose.connect(process.env.MONGO_URI);

    const existingConversations = await WhatsAppConversation.find({ channel: "whatsapp" })
      .sort({ updatedAt: -1, _id: 1 })
      .limit(REQUIRED_CONVERSATION_COUNT);
    const createdContacts = [];
    let createdConversations = 0;
    let updatedConversations = 0;
    let totalTagsAssigned = 0;

    if (existingConversations.length < REQUIRED_CONVERSATION_COUNT) {
      const neededCount = REQUIRED_CONVERSATION_COUNT - existingConversations.length;
      const seededContacts = await ensureEnoughContacts(neededCount);

      for (let index = 0; index < neededCount; index += 1) {
        const contact = seededContacts[index];
        const conversation = await WhatsAppConversation.findOne({ contactId: contact._id, channel: "whatsapp" });
        if (conversation) {
          existingConversations.push(conversation);
          continue;
        }

        const createdConversation = await WhatsAppConversation.create(
          createConversationPayload({
            contactId: contact._id,
            tags: [],
            index: existingConversations.length + index,
          })
        );
        existingConversations.push(createdConversation);
        createdContacts.push(contact);
        createdConversations += 1;
      }
    }

    for (let index = 0; index < CONVERSATION_BLUEPRINTS.length; index += 1) {
      const conversation = existingConversations[index];
      if (!conversation) {
        break;
      }

      const tagsToAssign = CONVERSATION_BLUEPRINTS[index];
      const mergedTags = mergeTags(conversation.tags, tagsToAssign);
      const previousCount = normalizeTags(conversation.tags).length;

      conversation.tags = mergedTags;
      conversation.lastMessagePreview = conversation.lastMessagePreview || "Dev seed conversation for WhatsApp campaigns audience testing";
      conversation.lastMessageAt = conversation.lastMessageAt || new Date();
      await conversation.save();

      updatedConversations += 1;
      totalTagsAssigned += Math.max(0, mergedTags.length - previousCount);
    }

    const seededConversations = await WhatsAppConversation.find({
      _id: { $in: existingConversations.slice(0, CONVERSATION_BLUEPRINTS.length).map((item) => item._id) },
    }).lean();
    const segmentSummary = buildSegmentSummary(seededConversations);

    console.log("WhatsApp conversation tags seeded successfully.");
    console.log(
      JSON.stringify(
        {
          updatedConversations,
          createdConversations,
          createdContacts: createdContacts.length,
          tagsAssigned: totalTagsAssigned,
          sampleTags: TAG_DEFINITIONS,
          expectedSegments: segmentSummary,
        },
        null,
        2
      )
    );
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed WhatsApp conversation tags:", error);
    process.exit(1);
  }
}

seedWhatsAppConversationTags();
