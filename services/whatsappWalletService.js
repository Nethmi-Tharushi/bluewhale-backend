const { randomUUID } = require("crypto");
const WhatsAppWallet = require("../models/WhatsAppWallet");
const WhatsAppWalletTransaction = require("../models/WhatsAppWalletTransaction");

const WALLET_SINGLETON_KEY = "default";
const DEFAULT_TEMPLATE_CATEGORIES = ["AUTHENTICATION", "MARKETING", "UTILITY"];

const trimString = (value) => String(value || "").trim();

const toMinor = (amount) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric * 100));
};

const toMajor = (amountMinor = 0) => Number((Number(amountMinor || 0) / 100).toFixed(2));

const getDefaultTemplateChargeMinor = () => {
  const candidates = [
    process.env.WHATSAPP_WALLET_TEMPLATE_CHARGE,
    process.env.WHATSAPP_TEMPLATE_CREDIT_COST,
    process.env.WHATSAPP_TEMPLATE_SEND_COST,
  ];

  for (const candidate of candidates) {
    const minor = toMinor(candidate);
    if (minor > 0) return minor;
  }

  return 100;
};

const normalizeTemplateChargeByCategory = (value = {}) => {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, rawAmount]) => [trimString(key).toUpperCase(), toMinor(rawAmount)])
      .filter(([key, amountMinor]) => DEFAULT_TEMPLATE_CATEGORIES.includes(key) && amountMinor > 0)
  );
};

const sanitizeStoredTemplateChargeByCategory = (value = {}) => {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, rawAmount]) => [trimString(key).toUpperCase(), Number(rawAmount)])
      .filter(([key, amountMinor]) => DEFAULT_TEMPLATE_CATEGORIES.includes(key) && Number.isFinite(amountMinor) && amountMinor > 0)
  );
};

const formatTemplateChargeByCategory = (value = {}) => {
  const source = sanitizeStoredTemplateChargeByCategory(value);
  return Object.fromEntries(Object.entries(source).map(([key, amountMinor]) => [key, toMajor(amountMinor)]));
};

const resolveTemplateChargeMinor = (template = {}, wallet = {}) => {
  const category = trimString(template?.category || template?.templateCategory || template?.messageCategory || "").toUpperCase();
  const byCategory = sanitizeStoredTemplateChargeByCategory(wallet?.templateChargeByCategoryMinor || wallet?.templateChargeByCategory || {});
  if (category && Number(byCategory[category] || 0) > 0) {
    return Number(byCategory[category]);
  }
  return Number(wallet?.templateChargeMinor || getDefaultTemplateChargeMinor());
};

const getOrCreateWallet = async () => {
  const templateChargeMinor = getDefaultTemplateChargeMinor();
  let wallet = await WhatsAppWallet.findOne({ singletonKey: WALLET_SINGLETON_KEY });

  if (!wallet) {
    try {
      wallet = await WhatsAppWallet.create({
        singletonKey: WALLET_SINGLETON_KEY,
        currency: process.env.WHATSAPP_WALLET_CURRENCY || "USD",
        balanceMinor: 0,
        reservedMinor: 0,
        templateChargeMinor,
        templateChargeByCategory: {},
        lowBalanceThresholdMinor: 0,
        active: true,
      });
    } catch (error) {
      if (error?.code === 11000) {
        wallet = await WhatsAppWallet.findOne({ singletonKey: WALLET_SINGLETON_KEY });
      } else {
        throw error;
      }
    }
  }

  if (!wallet) {
    const error = new Error("Failed to initialize WhatsApp wallet");
    error.status = 500;
    throw error;
  }

  let touched = false;
  if (!wallet.currency) {
    wallet.currency = process.env.WHATSAPP_WALLET_CURRENCY || "USD";
    touched = true;
  }
  if (Number(wallet.templateChargeMinor || 0) !== templateChargeMinor) {
    wallet.templateChargeMinor = templateChargeMinor;
    touched = true;
  }
  if (!wallet.templateChargeByCategory || typeof wallet.templateChargeByCategory !== "object") {
    wallet.templateChargeByCategory = {};
    touched = true;
  }
  if (wallet.active === undefined) {
    wallet.active = true;
    touched = true;
  }

  if (touched) {
    await wallet.save();
  }

  return wallet;
};

const buildWalletSummary = (wallet) => {
  const normalized = wallet || {};
  const balanceMinor = Number(normalized.balanceMinor || 0);
  const reservedMinor = Number(normalized.reservedMinor || 0);
  const availableMinor = Math.max(0, balanceMinor - reservedMinor);

  return {
    id: normalized._id ? String(normalized._id) : "",
    currency: trimString(normalized.currency || "USD") || "USD",
    balanceMinor,
    reservedMinor,
    availableMinor,
    balance: toMajor(balanceMinor),
    reserved: toMajor(reservedMinor),
    available: toMajor(availableMinor),
    templateChargeMinor: Number(normalized.templateChargeMinor || getDefaultTemplateChargeMinor()),
    templateCharge: toMajor(normalized.templateChargeMinor || getDefaultTemplateChargeMinor()),
    templateChargeByCategory: formatTemplateChargeByCategory(normalized.templateChargeByCategory || {}),
    templateChargeByCategoryMinor: sanitizeStoredTemplateChargeByCategory(normalized.templateChargeByCategory || {}),
    lowBalanceThresholdMinor: Number(normalized.lowBalanceThresholdMinor || 0),
    active: normalized.active !== false,
    updatedAt: normalized.updatedAt || null,
    createdAt: normalized.createdAt || null,
  };
};

const getWalletSummary = async () => {
  const wallet = await getOrCreateWallet();
  return buildWalletSummary(wallet);
};

const listWalletTransactions = async ({ limit = 20 } = {}) => {
  const wallet = await getOrCreateWallet();
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);

  const transactions = await WhatsAppWalletTransaction.find({ walletId: wallet._id })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return transactions.map((transaction) => ({
    id: String(transaction._id),
    type: transaction.type,
    status: transaction.status,
    amountMinor: Number(transaction.amountMinor || 0),
    amount: toMajor(transaction.amountMinor || 0),
    balanceAfterMinor: Number(transaction.balanceAfterMinor || 0),
    balanceAfter: toMajor(transaction.balanceAfterMinor || 0),
    reservedAfterMinor: Number(transaction.reservedAfterMinor || 0),
    reservedAfter: toMajor(transaction.reservedAfterMinor || 0),
    reservationId: trimString(transaction.reservationId || ""),
    description: trimString(transaction.description || ""),
    note: trimString(transaction.note || ""),
    actorId: transaction.actorId ? String(transaction.actorId) : "",
    metadata: transaction.metadata || {},
    createdAt: transaction.createdAt,
  }));
};

const recordTransaction = async ({
  wallet,
  type,
  status = "completed",
  amountMinor = 0,
  description = "",
  note = "",
  actorId = null,
  reservationId = "",
  metadata = {},
}) => {
  const tx = await WhatsAppWalletTransaction.create({
    walletId: wallet._id,
    type,
    status,
    amountMinor: Number(amountMinor || 0),
    balanceAfterMinor: Number(wallet.balanceMinor || 0),
    reservedAfterMinor: Number(wallet.reservedMinor || 0),
    description,
    note,
    actorId,
    reservationId,
    metadata,
  });

  return tx;
};

const topUpWallet = async ({ amount, actorId = null, note = "", reference = "", metadata = {} } = {}) => {
  const amountMinor = toMinor(amount);
  if (amountMinor <= 0) {
    const error = new Error("Top up amount must be greater than 0");
    error.status = 400;
    throw error;
  }

  const wallet = await getOrCreateWallet();
  wallet.balanceMinor = Number(wallet.balanceMinor || 0) + amountMinor;
  wallet.updatedBy = actorId || wallet.updatedBy || null;
  await wallet.save();

  await recordTransaction({
    wallet,
    type: "topup",
    status: "completed",
    amountMinor,
    description: reference || "Manual wallet top up",
    note,
    actorId,
    metadata,
  });

  return buildWalletSummary(wallet);
};

const updateWalletConfig = async ({
  templateChargeMinor,
  templateChargeByCategory,
  lowBalanceThresholdMinor,
  currency,
  active,
  actorId = null,
} = {}) => {
  const wallet = await getOrCreateWallet();
  let touched = false;

  if (templateChargeMinor !== undefined) {
    const normalizedCharge = toMinor(templateChargeMinor);
    if (normalizedCharge >= 0) {
      wallet.templateChargeMinor = normalizedCharge;
      touched = true;
    }
  }

  if (templateChargeByCategory !== undefined) {
    wallet.templateChargeByCategory = normalizeTemplateChargeByCategory(templateChargeByCategory);
    touched = true;
  }

  if (lowBalanceThresholdMinor !== undefined) {
    const normalizedThreshold = toMinor(lowBalanceThresholdMinor);
    if (normalizedThreshold >= 0) {
      wallet.lowBalanceThresholdMinor = normalizedThreshold;
      touched = true;
    }
  }

  if (typeof currency === "string" && currency.trim()) {
    wallet.currency = trimString(currency).toUpperCase();
    touched = true;
  }

  if (typeof active === "boolean") {
    wallet.active = active;
    touched = true;
  }

  if (touched) {
    wallet.updatedBy = actorId || wallet.updatedBy || null;
    await wallet.save();
  }

  return buildWalletSummary(wallet);
};

const reserveWalletAmount = async ({
  amount,
  amountMinor,
  actorId = null,
  note = "",
  description = "",
  metadata = {},
} = {}) => {
  const normalizedAmountMinor =
    amountMinor !== undefined ? Math.max(0, Math.round(Number(amountMinor) || 0)) : toMinor(amount);
  if (normalizedAmountMinor <= 0) {
    const error = new Error("Reservation amount must be greater than 0");
    error.status = 400;
    throw error;
  }

  const wallet = await getOrCreateWallet();
  if (wallet.active === false) {
    const error = new Error("WhatsApp wallet is currently inactive");
    error.status = 403;
    throw error;
  }

  const updated = await WhatsAppWallet.findOneAndUpdate(
    {
      singletonKey: WALLET_SINGLETON_KEY,
      active: { $ne: false },
      $expr: {
        $gte: [
          { $subtract: [{ $ifNull: ["$balanceMinor", 0] }, { $ifNull: ["$reservedMinor", 0] }] },
          normalizedAmountMinor,
        ],
      },
    },
    {
      $inc: { reservedMinor: normalizedAmountMinor },
      $set: { updatedBy: actorId || wallet.updatedBy || null },
    },
    { new: true }
  );

  if (!updated) {
    const error = new Error("WhatsApp wallet balance is too low for template messages");
    error.status = 402;
    throw error;
  }

  const reservationId = randomUUID();
  const tx = await WhatsAppWalletTransaction.create({
    walletId: updated._id,
    reservationId,
    type: "reserve",
    status: "reserved",
    amountMinor: normalizedAmountMinor,
    balanceAfterMinor: Number(updated.balanceMinor || 0),
    reservedAfterMinor: Number(updated.reservedMinor || 0),
    description: description || "Reserved for WhatsApp template send",
    note,
    actorId,
    metadata,
  });

  return {
    reservationId,
    amountMinor: normalizedAmountMinor,
    amount: toMajor(normalizedAmountMinor),
    wallet: buildWalletSummary(updated),
    transactionId: String(tx._id),
  };
};

const commitWalletReservation = async ({ reservationId, note = "", metadata = {} } = {}) => {
  const normalizedReservationId = trimString(reservationId);
  if (!normalizedReservationId) {
    const error = new Error("reservationId is required");
    error.status = 400;
    throw error;
  }

  const reservation = await WhatsAppWalletTransaction.findOne({
    reservationId: normalizedReservationId,
    type: "reserve",
    status: "reserved",
  });

  if (!reservation) {
    const error = new Error("Wallet reservation not found or already processed");
    error.status = 404;
    throw error;
  }

  const wallet = await WhatsAppWallet.findById(reservation.walletId);
  if (!wallet) {
    const error = new Error("Wallet not found");
    error.status = 404;
    throw error;
  }

  const amountMinor = Number(reservation.amountMinor || 0);
  wallet.balanceMinor = Math.max(0, Number(wallet.balanceMinor || 0) - amountMinor);
  wallet.reservedMinor = Math.max(0, Number(wallet.reservedMinor || 0) - amountMinor);
  wallet.updatedBy = reservation.actorId || wallet.updatedBy || null;
  await wallet.save();

  reservation.status = "completed";
  reservation.note = note || reservation.note || "";
  reservation.metadata = {
    ...(reservation.metadata || {}),
    ...(metadata || {}),
  };
  reservation.balanceAfterMinor = Number(wallet.balanceMinor || 0);
  reservation.reservedAfterMinor = Number(wallet.reservedMinor || 0);
  await reservation.save();

  return {
    reservationId: normalizedReservationId,
    amountMinor,
    amount: toMajor(amountMinor),
    wallet: buildWalletSummary(wallet),
    transactionId: String(reservation._id),
  };
};

const releaseWalletReservation = async ({ reservationId, note = "", metadata = {} } = {}) => {
  const normalizedReservationId = trimString(reservationId);
  if (!normalizedReservationId) {
    const error = new Error("reservationId is required");
    error.status = 400;
    throw error;
  }

  const reservation = await WhatsAppWalletTransaction.findOne({
    reservationId: normalizedReservationId,
    type: "reserve",
    status: "reserved",
  });

  if (!reservation) {
    return null;
  }

  const wallet = await WhatsAppWallet.findById(reservation.walletId);
  if (!wallet) {
    return null;
  }

  const amountMinor = Number(reservation.amountMinor || 0);
  wallet.reservedMinor = Math.max(0, Number(wallet.reservedMinor || 0) - amountMinor);
  wallet.updatedBy = reservation.actorId || wallet.updatedBy || null;
  await wallet.save();

  reservation.status = "released";
  reservation.note = note || reservation.note || "";
  reservation.metadata = {
    ...(reservation.metadata || {}),
    ...(metadata || {}),
  };
  reservation.balanceAfterMinor = Number(wallet.balanceMinor || 0);
  reservation.reservedAfterMinor = Number(wallet.reservedMinor || 0);
  await reservation.save();

  return {
    reservationId: normalizedReservationId,
    amountMinor,
    amount: toMajor(amountMinor),
    wallet: buildWalletSummary(wallet),
    transactionId: String(reservation._id),
  };
};

module.exports = {
  getOrCreateWallet,
  getWalletSummary,
  listWalletTransactions,
  topUpWallet,
  reserveWalletAmount,
  commitWalletReservation,
  releaseWalletReservation,
  updateWalletConfig,
  resolveTemplateChargeMinor,
  normalizeTemplateChargeByCategory,
  toMinor,
  toMajor,
};
