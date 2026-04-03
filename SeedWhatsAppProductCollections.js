require("dotenv").config();
const mongoose = require("mongoose");
const WhatsAppProductCollection = require("./models/WhatsAppProductCollection");
const { slugify } = require("./services/whatsappProductCollectionService");

const COLLECTION_DEFINITIONS = [
  {
    name: "Catalog Ready Services",
    description: "Use the services already available in the connected Meta catalog for live WhatsApp product collection delivery.",
    buttonText: "View services",
    category: "Featured",
    items: [
      {
        id: "book_consultation",
        title: "Book Consultation",
        description: "Schedule a one-to-one migration consultation.",
      },
      {
        id: "free_assessment",
        title: "Free Assessment",
        description: "Start with an eligibility and profile review.",
      },
      {
        id: "student_visa_support",
        title: "Student Visa Support",
        description: "Study pathway guidance and application support.",
      },
      {
        id: "overseas_jobs",
        title: "Overseas Jobs",
        description: "Explore current international job opportunities.",
      },
    ],
  },
  {
    name: "Consultations & Assessments",
    description: "Guide new leads into consultation, eligibility, and first-step assessment offers.",
    buttonText: "View options",
    category: "Lead Intake",
    items: [
      {
        id: "book_consultation",
        title: "Book Consultation",
        description: "Schedule a one-to-one migration consultation.",
      },
      {
        id: "free_assessment",
        title: "Free Assessment",
        description: "Start with an eligibility and profile review.",
      },
      {
        id: "case_review",
        title: "Case Review",
        description: "Get tailored guidance on your current case.",
      },
    ],
  },
  {
    name: "Visa & Migration Services",
    description: "Present the core visa pathways and migration support packages offered by Blue Whale.",
    buttonText: "View visas",
    category: "Migration",
    items: [
      {
        id: "student_visa_support",
        title: "Student Visa Support",
        description: "Study pathway guidance and application support.",
      },
      {
        id: "skilled_migration_pathway",
        title: "Skilled Migration",
        description: "Eligibility review and pathway planning.",
      },
      {
        id: "visit_visa_help",
        title: "Visit Visa Help",
        description: "Tourist and short-stay visa support.",
      },
      {
        id: "partner_family_visa",
        title: "Partner & Family Visa",
        description: "Family and partner migration assistance.",
      },
    ],
  },
  {
    name: "Document Support Pack",
    description: "Help customers choose the document and application-preparation support they need.",
    buttonText: "View docs",
    category: "Document Support",
    items: [
      {
        id: "document_checklist",
        title: "Document Checklist",
        description: "See what paperwork is required for your case.",
      },
      {
        id: "document_review",
        title: "Document Review",
        description: "Have your files checked before submission.",
      },
      {
        id: "upload_guidance",
        title: "Upload Guidance",
        description: "Get help preparing and uploading documents.",
      },
    ],
  },
  {
    name: "Career & Job Pathways",
    description: "Offer recruitment-oriented options for candidates exploring overseas job routes.",
    buttonText: "View jobs",
    category: "Recruitment",
    items: [
      {
        id: "overseas_jobs",
        title: "Overseas Jobs",
        description: "Explore current international job opportunities.",
      },
      {
        id: "cv_review",
        title: "CV Review",
        description: "Improve your CV before applying abroad.",
      },
      {
        id: "interview_prep",
        title: "Interview Prep",
        description: "Prepare for employer and visa interviews.",
      },
    ],
  },
];

async function seedProductCollections() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const records = [];

    for (const item of COLLECTION_DEFINITIONS) {
      const record = await WhatsAppProductCollection.findOneAndUpdate(
        { slug: slugify(item.name) },
        {
          $set: {
            ...item,
            slug: slugify(item.name),
            isActive: true,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );
      records.push(record);
    }

    console.log("WhatsApp product collections seeded successfully.");
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
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed WhatsApp product collections:", error);
    process.exit(1);
  }
}

seedProductCollections();
