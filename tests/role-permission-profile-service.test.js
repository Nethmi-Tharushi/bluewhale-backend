const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");
const {
  ROLE_PERMISSION_KEYS,
} = require("../utils/rolePermissionProfiles");

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const matchValue = (actual, expected) => String(actual || "") === String(expected || "");

const createRolePermissionModelMock = (seedProfiles = [], admins = []) => {
  const store = seedProfiles.map((item) => deepClone(item));

  const populateUpdatedBy = (record) => {
    if (!record) return null;
    const plain = deepClone(record);
    if (plain.updatedBy) {
      const admin = admins.find((item) => matchValue(item._id, plain.updatedBy));
      plain.updatedBy = admin
        ? { _id: admin._id, name: admin.name, email: admin.email }
        : null;
    } else {
      plain.updatedBy = null;
    }
    return plain;
  };

  const createSingleQuery = (resolver) => ({
    populate() {
      this._populate = true;
      return this;
    },
    async lean() {
      return deepClone(resolver(Boolean(this._populate)));
    },
    then(resolve, reject) {
      return Promise.resolve(resolver(Boolean(this._populate))).then(resolve, reject);
    },
  });

  return {
    __store: store,
    find() {
      return {
        populate() {
          this._populate = true;
          return this;
        },
        sort() {
          return this;
        },
        async lean() {
          const rows = this._populate ? store.map((item) => populateUpdatedBy(item)) : store.map((item) => deepClone(item));
          return deepClone(rows);
        },
      };
    },
    async create(payload = {}) {
      const record = {
        createdAt: payload.createdAt || "2026-04-08T10:00:00.000Z",
        updatedAt: payload.updatedAt || "2026-04-08T10:00:00.000Z",
        ...deepClone(payload),
      };
      store.push(record);
      return deepClone(record);
    },
    findOne(filter = {}) {
      return createSingleQuery((populate) => {
        const record = store.find((item) => matchValue(item.profileKey, filter.profileKey));
        if (!record) return null;
        return populate ? populateUpdatedBy(record) : deepClone(record);
      });
    },
    findOneAndUpdate(filter = {}, update = {}) {
      return createSingleQuery((populate) => {
        let record = store.find((item) => matchValue(item.profileKey, filter.profileKey));

        if (!record) {
          record = {
            profileKey: update.$setOnInsert?.profileKey || filter.profileKey,
            createdAt: "2026-04-08T10:00:00.000Z",
            updatedAt: "2026-04-08T10:00:00.000Z",
          };
          store.push(record);
        }

        Object.assign(record, deepClone(update.$set || {}), deepClone(update.$setOnInsert || {}));
        record.updatedAt = "2026-04-08T11:00:00.000Z";

        return populate ? populateUpdatedBy(record) : deepClone(record);
      });
    },
  };
};

const loadService = ({ profiles = [], admins = [] } = {}) => {
  const rolePermissionModel = createRolePermissionModelMock(profiles, admins);

  return {
    service: loadWithMocks(path.resolve(__dirname, "../services/rolePermissionProfileService.js"), {
      "../models/RolePermissionProfile": rolePermissionModel,
    }),
    store: rolePermissionModel.__store,
  };
};

module.exports = async () => {
  const admins = [
    {
      _id: "507f1f77bcf86cd799439011",
      name: "Admin User",
      email: "admin@bluewhale.test",
    },
  ];

  const { service, store } = loadService({ profiles: [], admins });

  const seeded = await service.listRolePermissionProfiles({
    actorId: "507f1f77bcf86cd799439011",
  });
  assert.equal(seeded.profiles.length, 6);
  assert.equal(store.length, 6);
  assert.ok(seeded.profiles.every((profile) => Object.keys(profile.permissions).length === ROLE_PERMISSION_KEYS.length));
  assert.equal(seeded.profiles.find((profile) => profile.profileKey === "SalesAdmin").label, "Sales Lead");

  const updated = await service.updateRolePermissionProfile(
    "SalesAdmin",
    {
      contactHubAccess: false,
      exportContacts: false,
    },
    { _id: "507f1f77bcf86cd799439011" }
  );
  assert.equal(updated.profileKey, "SalesAdmin");
  assert.equal(updated.permissions.contactHubAccess, false);
  assert.equal(updated.permissions.exportContacts, false);
  assert.equal(updated.permissions.addContacts, true);
  assert.equal(updated.updatedBy.name, "Admin User");

  const single = await service.getRolePermissionProfile("SalesAdmin", {
    actorId: "507f1f77bcf86cd799439011",
  });
  assert.equal(single.profileKey, "SalesAdmin");
  assert.equal(single.permissions.contactHubAccess, false);

  await assert.rejects(
    () =>
      service.updateRolePermissionProfile(
        "SalesAdmin",
        { badKey: true },
        { _id: "507f1f77bcf86cd799439011" }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "UNKNOWN_PERMISSION_KEY");
      return true;
    }
  );

  await assert.rejects(
    () =>
      service.updateRolePermissionProfile(
        "SalesAdmin",
        { contactHubAccess: "yes" },
        { _id: "507f1f77bcf86cd799439011" }
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "INVALID_PERMISSION_VALUE");
      return true;
    }
  );

  await service.updateRolePermissionProfile(
    "Teammate",
    {
      exportContacts: true,
    },
    { _id: "507f1f77bcf86cd799439011" }
  );
  const resetOne = await service.resetRolePermissionProfiles({
    profileKey: "Teammate",
    actor: { _id: "507f1f77bcf86cd799439011" },
  });
  assert.equal(resetOne.profiles.length, 1);
  assert.equal(resetOne.profiles[0].profileKey, "Teammate");
  assert.equal(resetOne.profiles[0].permissions.exportContacts, false);
  assert.equal(resetOne.profiles[0].permissions.hidePhone, true);

  const resetAll = await service.resetRolePermissionProfiles({
    all: true,
    actor: { _id: "507f1f77bcf86cd799439011" },
  });
  assert.equal(resetAll.profiles.length, 6);
  assert.equal(resetAll.profiles.find((profile) => profile.profileKey === "MainAdmin").permissions.ctwaAdsPage, true);

  const effective = await service.getEffectivePermissionsForRole("Admin", {
    actorId: "507f1f77bcf86cd799439011",
  });
  assert.equal(effective.workflowReportExport, true);

  const canHidePhone = await service.hasPermission("Teammate", "hidePhone", {
    actorId: "507f1f77bcf86cd799439011",
  });
  assert.equal(canHidePhone, true);
};
