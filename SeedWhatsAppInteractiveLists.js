require("dotenv").config();
const mongoose = require("mongoose");
const WhatsAppInteractiveList = require("./models/WhatsAppInteractiveList");

const LEGACY_TEST_LIST_NAMES = [
  "Production Failure Verification List",
  "Provider Rejection Verification List",
];

const LIST_DEFINITIONS = [
  {
    name: "Get Started",
    description: "Help the customer choose the next step",
    buttonText: "View options",
    category: "onboarding",
    sections: [
      {
        title: "Main Options",
        rows: [
          {
            id: "book_consultation",
            title: "Book Consultation",
            description: "Schedule a consultation",
          },
          {
            id: "free_assessment",
            title: "Free Assessment",
            description: "Start with an eligibility check",
          },
          {
            id: "visa_options",
            title: "Visa Options",
            description: "Explore available visa paths",
          },
          {
            id: "talk_to_support",
            title: "Talk to Support",
            description: "Contact our team directly",
          },
        ],
      },
    ],
  },
  {
    name: "Visa Services",
    description: "Let the customer choose the visa service they need",
    buttonText: "View visas",
    category: "visa_services",
    sections: [
      {
        title: "Visa Types",
        rows: [
          {
            id: "student_visa",
            title: "Student Visa",
            description: "Study abroad support",
          },
          {
            id: "skilled_migration",
            title: "Skilled Migration",
            description: "Skilled migration pathways",
          },
          {
            id: "visit_visa",
            title: "Visit Visa",
            description: "Tourist and visit visa help",
          },
          {
            id: "partner_visa",
            title: "Partner Visa",
            description: "Family and partner migration",
          },
        ],
      },
    ],
  },
  {
    name: "Document Help",
    description: "Help the customer with required paperwork",
    buttonText: "View docs",
    category: "documents",
    sections: [
      {
        title: "Document Support",
        rows: [
          {
            id: "required_documents",
            title: "Required Documents",
            description: "See what documents are needed",
          },
          {
            id: "checklist_review",
            title: "Checklist Review",
            description: "Review your document checklist",
          },
          {
            id: "upload_guidance",
            title: "Upload Guidance",
            description: "Help with document submission",
          },
          {
            id: "processing_time",
            title: "Processing Time",
            description: "Check estimated timelines",
          },
        ],
      },
    ],
  },
  {
    name: "Job Pathway",
    description: "Support job-seeking and overseas work enquiries",
    buttonText: "View jobs",
    category: "jobs",
    sections: [
      {
        title: "Career Support",
        rows: [
          {
            id: "overseas_jobs",
            title: "Overseas Jobs",
            description: "Explore job opportunities",
          },
          {
            id: "cv_review",
            title: "CV Review",
            description: "Improve your CV",
          },
          {
            id: "interview_help",
            title: "Interview Help",
            description: "Prepare for interviews",
          },
          {
            id: "eligibility_check",
            title: "Eligibility Check",
            description: "Check if you qualify",
          },
        ],
      },
    ],
  },
];

const BASE_CONTENT = {
  headerText: "Choose an option",
  footerText: "Blue Whale Migration",
  isActive: true,
};

const logSummary = (records) => {
  console.log(
    JSON.stringify(
      records.map((record) => ({
        id: String(record._id),
        name: record.name,
        buttonText: record.buttonText,
        isActive: record.isActive,
      })),
      null,
      2
    )
  );
};

async function seedInteractiveLists() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    await WhatsAppInteractiveList.deleteMany({
      name: { $in: LEGACY_TEST_LIST_NAMES },
    });

    const legacyGetStarted = await WhatsAppInteractiveList.findOne({
      name: "Production Verification List",
    });

    if (legacyGetStarted) {
      legacyGetStarted.name = "Get Started";
      legacyGetStarted.description = LIST_DEFINITIONS[0].description;
      legacyGetStarted.buttonText = LIST_DEFINITIONS[0].buttonText;
      legacyGetStarted.category = LIST_DEFINITIONS[0].category;
      legacyGetStarted.headerText = BASE_CONTENT.headerText;
      legacyGetStarted.footerText = BASE_CONTENT.footerText;
      legacyGetStarted.isActive = true;
      legacyGetStarted.sections = LIST_DEFINITIONS[0].sections;
      await legacyGetStarted.save();
    }

    for (const listDefinition of LIST_DEFINITIONS) {
      await WhatsAppInteractiveList.findOneAndUpdate(
        { name: listDefinition.name },
        {
          $set: {
            ...BASE_CONTENT,
            ...listDefinition,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );
    }

    await WhatsAppInteractiveList.deleteMany({
      name: "Production Verification List",
    });

    const records = await WhatsAppInteractiveList.find({
      name: { $in: LIST_DEFINITIONS.map((item) => item.name) },
    })
      .sort({ name: 1 })
      .lean();

    console.log("WhatsApp interactive lists seeded successfully.");
    logSummary(records);
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed WhatsApp interactive lists:", error);
    process.exit(1);
  }
}

seedInteractiveLists();
