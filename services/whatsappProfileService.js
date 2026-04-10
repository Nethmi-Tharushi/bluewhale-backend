const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const WhatsAppBusinessProfile = require("../models/WhatsAppBusinessProfile");

const DEFAULT_SINGLETON_KEY = "default";
const DEFAULT_PROFILE = Object.freeze({
  businessName: "Blue Whale CRM",
  businessType: "Professional Services",
  businessDescription: "",
  address: "",
  email: "",
  website: "",
  phone: "",
  logoUrl: "",
  logoStorageKey: "",
});
const MUTABLE_FIELDS = new Set([
  "businessName",
  "businessType",
  "businessDescription",
  "address",
  "email",
  "website",
  "phone",
  "logoUrl",
]);

const trimString = (value) => String(value || "").trim();
const toObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};
const toIsoStringOrNull = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const createHttpError = (message, status = 400, extras = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extras);
  return error;
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidUrl = (value) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
};

const serializeProfile = (doc) => {
  const plain = toObject(doc);
  const updatedBy = plain.updatedBy && typeof plain.updatedBy === "object" ? plain.updatedBy : null;

  return {
    businessName: trimString(plain.businessName) || DEFAULT_PROFILE.businessName,
    businessType: trimString(plain.businessType) || DEFAULT_PROFILE.businessType,
    businessDescription: trimString(plain.businessDescription),
    address: trimString(plain.address),
    email: trimString(plain.email),
    website: trimString(plain.website),
    phone: trimString(plain.phone),
    logoUrl: trimString(plain.logoUrl),
    updatedAt: toIsoStringOrNull(plain.updatedAt),
    updatedBy: updatedBy
      ? {
          id: trimString(updatedBy._id || updatedBy.id),
          name: trimString(updatedBy.name || updatedBy.email),
        }
      : null,
  };
};

const withProfilePopulation = (query) => query.populate("updatedBy", "_id name email");

const getStoredProfileDocument = () =>
  withProfilePopulation(
    WhatsAppBusinessProfile.findOne({ singletonKey: DEFAULT_SINGLETON_KEY })
  );

const ensureProfileDocument = async () => {
  let profile = await WhatsAppBusinessProfile.findOne({ singletonKey: DEFAULT_SINGLETON_KEY });
  if (!profile) {
    profile = await WhatsAppBusinessProfile.create({
      singletonKey: DEFAULT_SINGLETON_KEY,
      ...DEFAULT_PROFILE,
    });
  }

  return profile;
};

const normalizePayload = (payload = {}, options = {}) => {
  const partial = Boolean(options.partial);
  const current = options.current || DEFAULT_PROFILE;
  const incoming = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const keys = Object.keys(incoming);

  const invalidField = keys.find((key) => !MUTABLE_FIELDS.has(key));
  if (invalidField) {
    throw createHttpError(`Unsupported field: ${invalidField}`);
  }

  if (!partial && !keys.length) {
    throw createHttpError("At least one field is required");
  }

  const normalized = { ...current };

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "businessName")) {
    const businessName = trimString(incoming.businessName);
    if (!businessName) {
      throw createHttpError("businessName is required");
    }
    if (businessName.length > 120) {
      throw createHttpError("businessName must be 120 characters or fewer");
    }
    normalized.businessName = businessName;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "businessType")) {
    const businessType = trimString(incoming.businessType);
    if (businessType.length > 120) {
      throw createHttpError("businessType must be 120 characters or fewer");
    }
    normalized.businessType = businessType;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "businessDescription")) {
    const businessDescription = trimString(incoming.businessDescription);
    if (businessDescription.length > 500) {
      throw createHttpError("businessDescription must be 500 characters or fewer");
    }
    normalized.businessDescription = businessDescription;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "address")) {
    const address = trimString(incoming.address);
    if (address.length > 240) {
      throw createHttpError("address must be 240 characters or fewer");
    }
    normalized.address = address;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "email")) {
    const email = trimString(incoming.email).toLowerCase();
    if (email && !isValidEmail(email)) {
      throw createHttpError("email must be a valid email address");
    }
    normalized.email = email;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "website")) {
    const website = trimString(incoming.website);
    if (website && !isValidUrl(website)) {
      throw createHttpError("website must be a valid URL");
    }
    normalized.website = website;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "phone")) {
    const phone = trimString(incoming.phone);
    if (phone.length > 60) {
      throw createHttpError("phone must be 60 characters or fewer");
    }
    normalized.phone = phone;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(incoming, "logoUrl")) {
    const logoUrl = trimString(incoming.logoUrl);
    if (logoUrl && !isValidUrl(logoUrl)) {
      throw createHttpError("logoUrl must be a valid URL");
    }
    normalized.logoUrl = logoUrl;
  }

  return normalized;
};

const uploadBufferToCloudinary = ({ buffer, filename = "", mimeType = "", publicId = "" } = {}) =>
  new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: "bluewhale/whatsapp/profile",
        resource_type: "image",
        public_id: publicId || undefined,
        use_filename: !publicId,
        filename_override: filename || undefined,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          url: trimString(result?.secure_url),
          storageKey: trimString(result?.public_id),
          fileName: trimString(result?.original_filename || filename),
          mimeType: trimString(mimeType),
          bytes: Number(result?.bytes || 0),
        });
      }
    );

    streamifier.createReadStream(buffer).pipe(upload);
  });

const getWhatsAppBusinessProfile = async () => {
  const profile = await ensureProfileDocument();
  const populated = await getStoredProfileDocument();
  return serializeProfile(populated || profile);
};

const updateWhatsAppBusinessProfile = async (payload = {}, actor) => {
  const profile = await ensureProfileDocument();
  const current = {
    ...DEFAULT_PROFILE,
    ...toObject(profile),
  };
  const normalized = normalizePayload(payload, { partial: true, current });

  Object.assign(profile, normalized);
  if (Object.prototype.hasOwnProperty.call(payload || {}, "logoUrl")) {
    profile.logoStorageKey = normalized.logoUrl === trimString(current.logoUrl)
      ? trimString(current.logoStorageKey)
      : "";
  }
  profile.updatedBy = actor?._id || null;
  await profile.save();

  const populated = await getStoredProfileDocument();
  return serializeProfile(populated || profile);
};

const uploadWhatsAppBusinessProfileLogo = async ({ file, actor }) => {
  if (!file?.buffer?.length) {
    throw createHttpError("Please choose a logo image to upload");
  }

  const uploaded = await uploadBufferToCloudinary({
    buffer: file.buffer,
    filename: file.originalname,
    mimeType: file.mimetype,
    publicId: `wa_business_profile_logo_${Date.now()}`,
  });

  const profile = await ensureProfileDocument();

  if (trimString(profile.logoStorageKey)) {
    try {
      await cloudinary.uploader.destroy(profile.logoStorageKey, {
        resource_type: "image",
      });
    } catch (_) {}
  }

  profile.logoUrl = uploaded.url;
  profile.logoStorageKey = uploaded.storageKey;
  profile.updatedBy = actor?._id || null;
  await profile.save();

  return {
    logoUrl: uploaded.url,
    logoStorageKey: uploaded.storageKey,
  };
};

const deleteWhatsAppBusinessProfileLogo = async ({ actor }) => {
  const profile = await ensureProfileDocument();

  if (trimString(profile.logoStorageKey)) {
    try {
      await cloudinary.uploader.destroy(profile.logoStorageKey, {
        resource_type: "image",
      });
    } catch (_) {}
  }

  profile.logoUrl = "";
  profile.logoStorageKey = "";
  profile.updatedBy = actor?._id || null;
  await profile.save();

  const populated = await getStoredProfileDocument();
  return serializeProfile(populated || profile);
};

module.exports = {
  DEFAULT_PROFILE,
  getWhatsAppBusinessProfile,
  updateWhatsAppBusinessProfile,
  uploadWhatsAppBusinessProfileLogo,
  deleteWhatsAppBusinessProfileLogo,
  __private: {
    normalizePayload,
    serializeProfile,
    ensureProfileDocument,
  },
};
