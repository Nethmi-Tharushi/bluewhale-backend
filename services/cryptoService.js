const crypto = require("crypto");

const ENCRYPTED_PREFIX = "enc::";
const DEFAULT_ALGORITHM = "aes-256-gcm";

const trimString = (value) => String(value || "").trim();

const getEncryptionSecret = () =>
  trimString(
    process.env.META_TOKENS_ENCRYPTION_KEY ||
      process.env.APP_ENCRYPTION_KEY ||
      process.env.JWT_SECRET
  );

const getEncryptionKey = () => {
  const secret = getEncryptionSecret();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
};

const isEncryptedValue = (value) => trimString(value).startsWith(ENCRYPTED_PREFIX);

const encryptSecret = (value) => {
  const normalized = trimString(value);
  if (!normalized) return "";
  if (isEncryptedValue(normalized)) return normalized;

  const key = getEncryptionKey();
  if (!key) return normalized;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(DEFAULT_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptSecret = (value) => {
  const normalized = trimString(value);
  if (!normalized) return "";
  if (!isEncryptedValue(normalized)) return normalized;

  const key = getEncryptionKey();
  if (!key) return "";

  const payload = normalized.slice(ENCRYPTED_PREFIX.length);
  const [ivB64, authTagB64, dataB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) return "";

  try {
    const decipher = crypto.createDecipheriv(
      DEFAULT_ALGORITHM,
      key,
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return trimString(decrypted.toString("utf8"));
  } catch {
    return "";
  }
};

const encryptStringMap = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc, [key, item]) => {
    const normalizedKey = trimString(key);
    const normalizedValue = trimString(item);
    if (normalizedKey && normalizedValue) {
      acc[normalizedKey] = encryptSecret(normalizedValue);
    }
    return acc;
  }, {});
};

const decryptStringMap = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc, [key, item]) => {
    const normalizedKey = trimString(key);
    const decryptedValue = decryptSecret(item);
    if (normalizedKey && decryptedValue) {
      acc[normalizedKey] = decryptedValue;
    }
    return acc;
  }, {});
};

module.exports = {
  encryptSecret,
  decryptSecret,
  encryptStringMap,
  decryptStringMap,
  getEncryptionSecret,
  isEncryptedValue,
};
