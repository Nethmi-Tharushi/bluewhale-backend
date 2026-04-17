const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const WhatsAppBusinessProfile = require("../models/WhatsAppBusinessProfile");
const { loadWhatsAppMetaConnection } = require("./whatsappMetaConnectionService");

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

const META_VERTICAL_TO_LABEL = {
  AUTO: "Automotive",
  BEAUTY: "Beauty, Spa and Salon",
  APPAREL: "Clothing and Apparel",
  EDUCATION: "Education",
  ENTERTAIN: "Entertainment",
  EVENT_PLAN: "Event Planning and Service",
  FINANCE: "Finance and Banking",
  GROCERY: "Grocery",
  GOVT: "Public Service",
  HOTEL: "Hotel and Lodging",
  HEALTH: "Medical and Health",
  NONPROFIT: "Non-profit",
  PROF_SERVICES: "Professional Services",
  RETAIL: "Retail",
  TRAVEL: "Travel and Transportation",
  RESTAURANT: "Restaurant",
  OTHER: "Other",
};

const LABEL_TO_META_VERTICAL = Object.entries(META_VERTICAL_TO_LABEL).reduce((acc, [code, label]) => {
  acc[String(label || "").trim().toLowerCase()] = code;
  return acc;
}, {});

const normalizeMetaErrorMessage = (data, fallback = "Meta WhatsApp profile request failed") =>
  trimString(
    data?.error?.error_user_msg ||
      data?.error?.error_user_title ||
      data?.error?.error_data?.details ||
      data?.error?.message ||
      fallback
  ) || fallback;

const mapBusinessTypeToMetaVertical = (value = "") => {
  const normalized = trimString(value).toLowerCase();
  if (!normalized) return "OTHER";
  if (LABEL_TO_META_VERTICAL[normalized]) return LABEL_TO_META_VERTICAL[normalized];

  const compact = normalized.replace(/[^a-z]/g, "");
  if (compact.includes("professional")) return "PROF_SERVICES";
  if (compact.includes("education")) return "EDUCATION";
  if (compact.includes("health")) return "HEALTH";
  if (compact.includes("travel")) return "TRAVEL";
  if (compact.includes("retail")) return "RETAIL";
  if (compact.includes("technology") || compact.includes("software") || compact.includes("it")) return "PROF_SERVICES";
  return "OTHER";
};

const mapMetaVerticalToBusinessType = (vertical = "") => {
  const code = trimString(vertical).toUpperCase();
  return META_VERTICAL_TO_LABEL[code] || "Professional Services";
};

const hasLiveMetaConnection = (connection = {}) =>
  Boolean(trimString(connection?.accessToken) && trimString(connection?.phoneNumberId));

const buildMetaProfileUrl = ({ graphApiVersion = "v21.0", phoneNumberId = "", fields = "" } = {}) => {
  const version = trimString(graphApiVersion || "v21.0") || "v21.0";
  const id = trimString(phoneNumberId);
  const query = fields ? `?fields=${encodeURIComponent(fields)}` : "";
  return `https://graph.facebook.com/${version}/${id}/whatsapp_business_profile${query}`;
};

const buildMetaUploadSessionUrl = ({ graphApiVersion = "v21.0", appId = "", fileName = "", fileLength = 0, fileType = "" } = {}) => {
  const version = trimString(graphApiVersion || "v21.0") || "v21.0";
  const normalizedAppId = trimString(appId);
  const url = new URL(`https://graph.facebook.com/${version}/${normalizedAppId}/uploads`);
  url.searchParams.set("file_name", trimString(fileName || "wa-profile-logo"));
  url.searchParams.set("file_length", String(Math.max(0, Number(fileLength || 0))));
  url.searchParams.set("file_type", trimString(fileType || "application/octet-stream"));
  return url.toString();
};

const buildMetaUploadChunkUrl = ({ graphApiVersion = "v21.0", uploadSessionId = "" } = {}) => {
  const version = trimString(graphApiVersion || "v21.0") || "v21.0";
  return `https://graph.facebook.com/${version}/${trimString(uploadSessionId)}`;
};

const fetchMetaProfileSnapshot = async (connection = {}) => {
  const url = buildMetaProfileUrl({
    graphApiVersion: connection.graphApiVersion,
    phoneNumberId: connection.phoneNumberId,
    fields: "about,address,description,email,profile_picture_url,websites,vertical",
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw createHttpError(normalizeMetaErrorMessage(data), response.status || 502, {
      code: "META_PROFILE_FETCH_FAILED",
      details: data?.error || data,
    });
  }

  const profile = Array.isArray(data?.data) ? data.data[0] : data?.data || data;
  const websiteList = Array.isArray(profile?.websites) ? profile.websites : [];

  return {
    businessDescription: trimString(profile?.description || profile?.about),
    address: trimString(profile?.address),
    email: trimString(profile?.email).toLowerCase(),
    website: trimString(websiteList[0] || ""),
    logoUrl: trimString(profile?.profile_picture_url),
    businessType: mapMetaVerticalToBusinessType(profile?.vertical),
  };
};

const pushMetaProfileUpdate = async ({ connection = {}, profile = {} } = {}) => {
  const url = buildMetaProfileUrl({
    graphApiVersion: connection.graphApiVersion,
    phoneNumberId: connection.phoneNumberId,
  });
  const description = trimString(profile.businessDescription);
  const website = trimString(profile.website);
  const payload = {
    messaging_product: "whatsapp",
    address: trimString(profile.address),
    description,
    about: description.slice(0, 139),
    email: trimString(profile.email).toLowerCase(),
    websites: website ? [website] : [],
    vertical: mapBusinessTypeToMetaVertical(profile.businessType),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw createHttpError(normalizeMetaErrorMessage(data), response.status || 502, {
      code: "META_PROFILE_UPDATE_FAILED",
      details: data?.error || data,
    });
  }

  return data;
};

const uploadMetaProfilePhotoAndSet = async ({ connection = {}, file } = {}) => {
  const accessToken = trimString(connection?.accessToken);
  const appId = trimString(connection?.appId);
  const phoneNumberId = trimString(connection?.phoneNumberId);
  const graphApiVersion = trimString(connection?.graphApiVersion || "v21.0") || "v21.0";
  const fileBuffer = file?.buffer;

  if (!accessToken || !appId || !phoneNumberId || !fileBuffer?.length) {
    throw createHttpError("Missing Meta credentials or image file for profile photo sync", 400, {
      code: "META_PROFILE_PHOTO_MISSING_INPUT",
    });
  }

  const sessionResponse = await fetch(
    buildMetaUploadSessionUrl({
      graphApiVersion,
      appId,
      fileName: file?.originalname,
      fileLength: fileBuffer.length,
      fileType: file?.mimetype,
    }),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  const sessionData = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || sessionData?.error) {
    throw createHttpError(normalizeMetaErrorMessage(sessionData, "Failed to start Meta profile image upload"), sessionResponse.status || 502, {
      code: "META_PROFILE_PHOTO_UPLOAD_SESSION_FAILED",
      details: sessionData?.error || sessionData,
    });
  }

  const uploadSessionId = trimString(sessionData?.id);
  if (!uploadSessionId) {
    throw createHttpError("Meta did not return upload session id", 502, {
      code: "META_PROFILE_PHOTO_UPLOAD_SESSION_MISSING_ID",
    });
  }

  const uploadResponse = await fetch(
    buildMetaUploadChunkUrl({ graphApiVersion, uploadSessionId }),
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": trimString(file?.mimetype || "application/octet-stream"),
      },
      body: fileBuffer,
    }
  );
  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || uploadData?.error) {
    throw createHttpError(normalizeMetaErrorMessage(uploadData, "Failed to upload Meta profile image"), uploadResponse.status || 502, {
      code: "META_PROFILE_PHOTO_UPLOAD_FAILED",
      details: uploadData?.error || uploadData,
    });
  }

  const mediaHandle = trimString(uploadData?.h || uploadData?.handle);
  if (!mediaHandle) {
    throw createHttpError("Meta did not return profile image handle", 502, {
      code: "META_PROFILE_PHOTO_HANDLE_MISSING",
      details: uploadData,
    });
  }

  const setPhotoResponse = await fetch(
    buildMetaProfileUrl({ graphApiVersion, phoneNumberId }),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        profile_picture_handle: mediaHandle,
      }),
    }
  );
  const setPhotoData = await setPhotoResponse.json().catch(() => ({}));
  if (!setPhotoResponse.ok || setPhotoData?.error) {
    throw createHttpError(normalizeMetaErrorMessage(setPhotoData, "Failed to set Meta profile image"), setPhotoResponse.status || 502, {
      code: "META_PROFILE_PHOTO_SET_FAILED",
      details: setPhotoData?.error || setPhotoData,
    });
  }

  return { mediaHandle };
};

const serializeProfile = (doc, extras = {}) => {
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
    metaSync: extras.metaSync || null,
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
  let metaSync = {
    status: "not_connected",
    message: "Meta connection is not configured",
  };

  try {
    const connection = await loadWhatsAppMetaConnection();
    if (hasLiveMetaConnection(connection)) {
      const snapshot = await fetchMetaProfileSnapshot(connection);
      const nextLogo = trimString(snapshot.logoUrl);
      profile.businessDescription = snapshot.businessDescription;
      profile.address = snapshot.address;
      profile.email = snapshot.email;
      profile.website = snapshot.website;
      profile.businessType = snapshot.businessType;
      if (nextLogo) {
        profile.logoUrl = nextLogo;
      }
      await profile.save();

      metaSync = {
        status: "synced",
        message: "Profile loaded from live Meta WhatsApp profile",
      };
    }
  } catch (error) {
    metaSync = {
      status: "failed",
      message: error?.message || "Failed to load live Meta WhatsApp profile",
      code: error?.code || "",
    };
  }

  const populated = await getStoredProfileDocument();
  return serializeProfile(populated || profile, { metaSync });
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

  let metaSync = {
    status: "not_connected",
    message: "Meta connection is not configured",
  };
  try {
    const connection = await loadWhatsAppMetaConnection({ refresh: true });
    if (hasLiveMetaConnection(connection)) {
      await pushMetaProfileUpdate({ connection, profile: normalized });
      metaSync = {
        status: "synced",
        message: "Profile pushed to Meta WhatsApp successfully",
      };
    }
  } catch (error) {
    metaSync = {
      status: "failed",
      message: error?.message || "Failed to push profile to Meta WhatsApp",
      code: error?.code || "",
    };
  }

  const populated = await getStoredProfileDocument();
  return serializeProfile(populated || profile, { metaSync });
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

  let metaSync = {
    status: "not_connected",
    message: "Meta connection is not configured",
  };
  try {
    const connection = await loadWhatsAppMetaConnection({ refresh: true });
    if (hasLiveMetaConnection(connection)) {
      if (!trimString(connection.appId)) {
        metaSync = {
          status: "failed",
          message: "Meta app id is required for live profile photo sync",
          code: "META_PROFILE_PHOTO_MISSING_APP_ID",
        };
      } else {
        await uploadMetaProfilePhotoAndSet({ connection, file });
        metaSync = {
          status: "synced",
          message: "Profile photo synced to Meta WhatsApp successfully",
        };
      }
    }
  } catch (error) {
    metaSync = {
      status: "failed",
      message: error?.message || "Failed to sync profile photo to Meta WhatsApp",
      code: error?.code || "",
    };
  }

  return {
    logoUrl: uploaded.url,
    logoStorageKey: uploaded.storageKey,
    metaSync,
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
