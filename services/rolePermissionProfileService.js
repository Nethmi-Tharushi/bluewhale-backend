const RolePermissionProfile = require("../models/RolePermissionProfile");
const {
  ROLE_PERMISSION_KEYS,
  ROLE_PERMISSION_PROFILE_KEYS,
  getRolePermissionLabel,
  getDefaultPermissionsForProfile,
  fillPermissionDefaults,
  isSupportedPermissionKey,
  isSupportedProfileKey,
} = require("../utils/rolePermissionProfiles");

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

const ensureProfileKey = (profileKey) => {
  const normalized = trimString(profileKey);
  if (!isSupportedProfileKey(normalized)) {
    throw createHttpError(
      `profileKey must be one of: ${ROLE_PERMISSION_PROFILE_KEYS.join(", ")}`,
      400,
      { code: "INVALID_PROFILE_KEY" }
    );
  }
  return normalized;
};

const normalizePermissionPatch = (permissions, profileKey) => {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    throw createHttpError("permissions must be a JSON object", 400, {
      code: "INVALID_PERMISSIONS",
    });
  }

  const unknownKey = Object.keys(permissions).find((key) => !isSupportedPermissionKey(key));
  if (unknownKey) {
    throw createHttpError(`Unknown permission key: ${unknownKey}`, 400, {
      code: "UNKNOWN_PERMISSION_KEY",
    });
  }

  const invalidKey = Object.entries(permissions).find(([, value]) => typeof value !== "boolean");
  if (invalidKey) {
    throw createHttpError(`Permission ${invalidKey[0]} must be a boolean`, 400, {
      code: "INVALID_PERMISSION_VALUE",
    });
  }

  return fillPermissionDefaults(profileKey, permissions);
};

const normalizeProfileDocument = (profile) => {
  const plain = toObject(profile);
  const updatedBy = plain.updatedBy && typeof plain.updatedBy === "object" ? plain.updatedBy : null;
  const profileKey = ensureProfileKey(plain.profileKey);

  return {
    profileKey,
    label: trimString(plain.label) || getRolePermissionLabel(profileKey),
    permissions: fillPermissionDefaults(profileKey, plain.permissions),
    updatedBy: updatedBy
      ? {
          id: trimString(updatedBy._id || updatedBy.id),
          name: trimString(updatedBy.name || updatedBy.email),
        }
      : null,
    updatedAt: toIsoStringOrNull(plain.updatedAt),
    createdAt: toIsoStringOrNull(plain.createdAt),
  };
};

const createDefaultProfilePayload = (profileKey, updatedBy = null) => ({
  profileKey,
  label: getRolePermissionLabel(profileKey),
  permissions: getDefaultPermissionsForProfile(profileKey),
  updatedBy: updatedBy || null,
});

const ensureRolePermissionProfilesSeeded = async () => {
  const existingProfiles = await RolePermissionProfile.find({})
    .populate("updatedBy", "_id name email")
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  const existingMap = new Map(
    existingProfiles.map((profile) => [trimString(profile.profileKey), profile])
  );
  const missingKeys = ROLE_PERMISSION_PROFILE_KEYS.filter((profileKey) => !existingMap.has(profileKey));

  if (missingKeys.length > 0) {
    await Promise.all(
      missingKeys.map((profileKey) =>
        RolePermissionProfile.create(createDefaultProfilePayload(profileKey))
      )
    );
  }

  return RolePermissionProfile.find({})
    .populate("updatedBy", "_id name email")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
};

const listRolePermissionProfiles = async () => {
  const profiles = await ensureRolePermissionProfilesSeeded();
  return {
    profiles: ROLE_PERMISSION_PROFILE_KEYS.map((profileKey) => {
      const existing = profiles.find((profile) => trimString(profile.profileKey) === profileKey);
      return normalizeProfileDocument(existing || createDefaultProfilePayload(profileKey));
    }),
  };
};

const getRolePermissionProfile = async (profileKey, options = {}) => {
  const normalizedProfileKey = ensureProfileKey(profileKey);
  await ensureRolePermissionProfilesSeeded();

  const profile = await RolePermissionProfile.findOne({ profileKey: normalizedProfileKey })
    .populate("updatedBy", "_id name email");

  if (!profile) {
    return normalizeProfileDocument(createDefaultProfilePayload(normalizedProfileKey));
  }

  return normalizeProfileDocument(profile);
};

const updateRolePermissionProfile = async (profileKey, permissions, actor) => {
  const normalizedProfileKey = ensureProfileKey(profileKey);
  const normalizedPermissions = normalizePermissionPatch(permissions, normalizedProfileKey);

  const profile = await RolePermissionProfile.findOneAndUpdate(
    { profileKey: normalizedProfileKey },
    {
      $set: {
        label: getRolePermissionLabel(normalizedProfileKey),
        permissions: normalizedPermissions,
        updatedBy: actor?._id || null,
      },
      $setOnInsert: {
        profileKey: normalizedProfileKey,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).populate("updatedBy", "_id name email");

  return normalizeProfileDocument(profile);
};

const resetRolePermissionProfiles = async ({ profileKey = null, all = false, actor }) => {
  if (!all && !profileKey) {
    throw createHttpError("profileKey is required unless all=true", 400, {
      code: "RESET_TARGET_REQUIRED",
    });
  }

  const keysToReset = all ? ROLE_PERMISSION_PROFILE_KEYS : [ensureProfileKey(profileKey)];

  await Promise.all(
    keysToReset.map((key) =>
      RolePermissionProfile.findOneAndUpdate(
        { profileKey: key },
        {
          $set: {
            label: getRolePermissionLabel(key),
            permissions: getDefaultPermissionsForProfile(key),
            updatedBy: actor?._id || null,
          },
          $setOnInsert: {
            profileKey: key,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      )
    )
  );

  if (all) {
    return listRolePermissionProfiles();
  }

  return {
    profiles: [await getRolePermissionProfile(profileKey)],
  };
};

const getEffectivePermissionsForRole = async (profileKey, options = {}) => {
  const profile = await getRolePermissionProfile(profileKey, options);
  return profile.permissions;
};

const hasPermission = async (profileKey, permissionKey, options = {}) => {
  if (!isSupportedPermissionKey(permissionKey)) {
    throw createHttpError(`permissionKey must be one of: ${ROLE_PERMISSION_KEYS.join(", ")}`, 400, {
      code: "INVALID_PERMISSION_KEY",
    });
  }

  const permissions = await getEffectivePermissionsForRole(profileKey, options);
  return Boolean(permissions[permissionKey]);
};

module.exports = {
  listRolePermissionProfiles,
  getRolePermissionProfile,
  updateRolePermissionProfile,
  resetRolePermissionProfiles,
  ensureRolePermissionProfilesSeeded,
  getEffectivePermissionsForRole,
  hasPermission,
  __private: {
    normalizePermissionPatch,
    normalizeProfileDocument,
  },
};
