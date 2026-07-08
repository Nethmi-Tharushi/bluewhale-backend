require("dotenv").config();
const mongoose = require("mongoose");
const InvoiceItem = require("../models/InvoiceItem");

const seedItems = [
  {
    itemName: "Croatia",
    packageCountry: "Croatia",
    packageName: "Croatia Work Visa Package",
    installmentType: "First Installment",
    price: 1000,
    currency: "USD",
    description: "Initial installment for Croatia work visa package.",
    isActive: true,
  },
  {
    itemName: "Croatia",
    packageCountry: "Croatia",
    packageName: "Croatia Work Visa Package",
    installmentType: "Second Installment",
    price: 1500,
    currency: "USD",
    description: "Second installment for Croatia work visa package.",
    isActive: true,
  },
  {
    itemName: "Croatia",
    packageCountry: "Croatia",
    packageName: "Croatia Work Visa Package",
    installmentType: "Third Installment",
    price: 2000,
    currency: "USD",
    description: "Final installment for Croatia work visa package.",
    isActive: true,
  },
  {
    itemName: "Czechia",
    packageCountry: "Czechia",
    packageName: "Czechia Work Visa Package",
    installmentType: "First Installment",
    price: 900,
    currency: "USD",
    description: "Initial installment for Czechia work visa package.",
    isActive: true,
  },
  {
    itemName: "Czechia",
    packageCountry: "Czechia",
    packageName: "Czechia Work Visa Package",
    installmentType: "Second Installment",
    price: 1400,
    currency: "USD",
    description: "Second installment for Czechia work visa package.",
    isActive: true,
  },
  {
    itemName: "Czechia",
    packageCountry: "Czechia",
    packageName: "Czechia Work Visa Package",
    installmentType: "Third Installment",
    price: 1800,
    currency: "USD",
    description: "Final installment for Czechia work visa package.",
    isActive: true,
  },
  {
    itemName: "Belarus",
    packageCountry: "Belarus",
    packageName: "Belarus Work Visa Package",
    installmentType: "First Installment",
    price: 800,
    currency: "USD",
    description: "Initial installment for Belarus work visa package.",
    isActive: true,
  },
  {
    itemName: "Belarus",
    packageCountry: "Belarus",
    packageName: "Belarus Work Visa Package",
    installmentType: "Second Installment",
    price: 1200,
    currency: "USD",
    description: "Second installment for Belarus work visa package.",
    isActive: true,
  },
  {
    itemName: "Belarus",
    packageCountry: "Belarus",
    packageName: "Belarus Work Visa Package",
    installmentType: "Third Installment",
    price: 1600,
    currency: "USD",
    description: "Final installment for Belarus work visa package.",
    isActive: true,
  },
  {
    itemName: "Croatia",
    packageCountry: "Croatia",
    packageName: "Croatia Work Visa Package",
    installmentType: "Full Payment",
    price: 4300,
    currency: "USD",
    description: "Full payment for Croatia work visa package.",
    isActive: true,
  },
  {
    itemName: "Processing Fee - General Item",
    packageCountry: "",
    packageName: "General Fees",
    installmentType: "No Installment / General Item",
    price: 250,
    currency: "USD",
    description: "General processing fee.",
    isActive: true,
  },
  {
    itemName: "Documentation Fee - General Item",
    packageCountry: "",
    packageName: "General Fees",
    installmentType: "No Installment / General Item",
    price: 150,
    currency: "USD",
    description: "Visa documentation and file preparation fee.",
    isActive: true,
  },
];

const run = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is required to seed invoice items");
  }

  await mongoose.connect(mongoUri);

  for (const item of seedItems) {
    await InvoiceItem.findOneAndUpdate(
      {
        itemName: item.itemName,
        packageCountry: item.packageCountry,
        packageName: item.packageName,
        installmentType: item.installmentType,
      },
      { $set: item },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  console.log(`Seeded ${seedItems.length} invoice items`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
