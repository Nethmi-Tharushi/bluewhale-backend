const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const matchValue = (actual, expected) => String(actual || "") === String(expected || "");

const matchesFilter = (record, filter = {}) => {
  if (!filter || Object.keys(filter).length === 0) return true;

  if (Array.isArray(filter.$or) && filter.$or.length > 0) {
    const orMatches = filter.$or.some((condition) => matchesFilter(record, condition));
    if (!orMatches) return false;
  }

  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return true;

    const actual = record[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (Object.prototype.hasOwnProperty.call(expected, "$ne")) {
        return !matchValue(actual, expected.$ne);
      }

      if (Object.prototype.hasOwnProperty.call(expected, "$in")) {
        return expected.$in.some((item) => matchValue(actual, item));
      }
    }

    return matchValue(actual, expected);
  });
};

const sortRecords = (records, sortSpec = {}) => {
  const entries = Object.entries(sortSpec || {});
  if (!entries.length) return [...records];

  return [...records].sort((left, right) => {
    for (const [field, rawDirection] of entries) {
      const direction = Number(rawDirection) < 0 ? -1 : 1;
      const leftValue = left[field];
      const rightValue = right[field];

      if (leftValue === rightValue) continue;
      if (leftValue === undefined || leftValue === null) return 1 * direction;
      if (rightValue === undefined || rightValue === null) return -1 * direction;
      if (leftValue > rightValue) return 1 * direction;
      if (leftValue < rightValue) return -1 * direction;
    }

    return 0;
  });
};

const createAdminModelMock = (seedAdmins = []) => {
  const store = seedAdmins.map((record) => deepClone(record));
  let counter = store.length;

  class FakeAdminDocument {
    constructor(record) {
      Object.assign(this, deepClone(record));
    }

    toObject() {
      return deepClone(this);
    }

    async save() {
      const index = store.findIndex((item) => matchValue(item._id, this._id));
      if (index >= 0) {
        store[index] = this.toObject();
      } else {
        store.push(this.toObject());
      }
      return this;
    }
  }

  const populateAdmin = (record, populateFields = []) => {
    if (!record) return null;
    const plain = deepClone(record);

    if (populateFields.includes("createdBy") && plain.createdBy) {
      const creator = store.find((item) => matchValue(item._id, plain.createdBy));
      plain.createdBy = creator
        ? { _id: creator._id, name: creator.name, email: creator.email, role: creator.role }
        : null;
    }

    return plain;
  };

  const createListQuery = (resolver) => ({
    _sortSpec: {},
    _populateFields: [],
    select() {
      return this;
    },
    sort(sortSpec) {
      this._sortSpec = sortSpec || {};
      return this;
    },
    populate(field) {
      this._populateFields.push(field);
      return this;
    },
    async lean() {
      return deepClone(resolver(this._sortSpec, this._populateFields));
    },
  });

  const createSingleQuery = (resolver) => ({
    _populateFields: [],
    select() {
      return this;
    },
    populate(field) {
      this._populateFields.push(field);
      return this;
    },
    async lean() {
      return deepClone(resolver(this._populateFields));
    },
    then(resolve, reject) {
      return Promise.resolve(resolver(this._populateFields)).then(resolve, reject);
    },
  });

  return {
    __store: store,
    find(filter = {}) {
      return createListQuery((sortSpec, populateFields) =>
        sortRecords(
          store
            .filter((record) => matchesFilter(record, filter))
            .map((record) => populateAdmin(record, populateFields)),
          sortSpec
        )
      );
    },
    findOne(filter = {}) {
      return createSingleQuery(() => {
        const record = store.find((item) => matchesFilter(item, filter));
        return record ? new FakeAdminDocument(record) : null;
      });
    },
    findById(id) {
      return createSingleQuery((populateFields) => {
        const record = store.find((item) => matchValue(item._id, id));
        return record ? populateAdmin(record, populateFields) : null;
      });
    },
    async create(payload = {}) {
      const record = {
        _id: payload._id || `507f1f77bcf86cd7994390${String(++counter).padStart(2, "0")}`,
        createdAt: payload.createdAt || "2026-04-08T10:00:00.000Z",
        ...deepClone(payload),
      };
      store.push(record);
      return new FakeAdminDocument(record);
    },
    async countDocuments(filter = {}) {
      return store.filter((record) => matchesFilter(record, filter)).length;
    },
    async deleteOne(filter = {}) {
      const index = store.findIndex((record) => matchesFilter(record, filter));
      if (index < 0) return { deletedCount: 0 };
      store.splice(index, 1);
      return { deletedCount: 1 };
    },
  };
};

const createTeamModelMock = (seedTeams = [], adminStore = []) => {
  const store = seedTeams.map((record) => deepClone(record));

  const populateTeam = (record, populateFields = []) => {
    if (!record) return null;
    const plain = deepClone(record);

    if (populateFields.includes("ownerAdmin")) {
      const owner = adminStore.find((item) => matchValue(item._id, plain.ownerAdmin));
      plain.ownerAdmin = owner
        ? { _id: owner._id, name: owner.name, email: owner.email, role: owner.role }
        : plain.ownerAdmin;
    }

    if (populateFields.includes("members")) {
      plain.members = (Array.isArray(plain.members) ? plain.members : [])
        .map((memberId) => adminStore.find((item) => matchValue(item._id, memberId)))
        .filter(Boolean)
        .map((member) => ({
          _id: member._id,
          name: member.name,
          email: member.email,
          role: member.role,
        }));
    }

    return plain;
  };

  return {
    find(filter = {}) {
      return {
        _sortSpec: {},
        _populateFields: [],
        populate(field) {
          this._populateFields.push(field);
          return this;
        },
        sort(sortSpec) {
          this._sortSpec = sortSpec || {};
          return this;
        },
        async lean() {
          return deepClone(
            sortRecords(
              store
                .filter((record) => matchesFilter(record, filter))
                .map((record) => populateTeam(record, this._populateFields)),
              this._sortSpec
            )
          );
        },
      };
    },
  };
};

const loadService = ({ admins, teams }) => {
  const adminModel = createAdminModelMock(admins);
  const teamModel = createTeamModelMock(teams, adminModel.__store);

  return {
    service: loadWithMocks(path.resolve(__dirname, "../services/adminManagementService.js"), {
      bcryptjs: {
        hash: async (value) => `hashed:${value}`,
      },
      mongoose: {
        Types: {
          ObjectId: {
            isValid: (value) => typeof value === "string" && value.length === 24,
          },
        },
      },
      "../models/AdminUser": adminModel,
      "../models/SalesTeam": teamModel,
    }),
    adminStore: adminModel.__store,
  };
};

module.exports = async () => {
  const admins = [
    {
      _id: "507f1f77bcf86cd799439011",
      name: "Main One",
      email: "main1@bluewhale.test",
      phone: "+94770000001",
      role: "MainAdmin",
      reportsTo: null,
      createdBy: null,
      lastLogin: "2026-04-08T09:00:00.000Z",
      createdAt: "2026-04-01T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439012",
      name: "Main Two",
      email: "main2@bluewhale.test",
      phone: "+94770000002",
      role: "MainAdmin",
      reportsTo: null,
      createdBy: null,
      lastLogin: null,
      createdAt: "2026-04-01T11:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439013",
      name: "Sarah Sales",
      email: "sarah@bluewhale.test",
      phone: "+94770000003",
      role: "SalesAdmin",
      reportsTo: null,
      createdBy: "507f1f77bcf86cd799439011",
      lastLogin: "2026-04-07T08:30:00.000Z",
      createdAt: "2026-04-02T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439014",
      name: "Ajo Philip",
      email: "ajo@bluewhale.test",
      phone: "+94770000004",
      role: "SalesStaff",
      reportsTo: "507f1f77bcf86cd799439013",
      createdBy: "507f1f77bcf86cd799439013",
      lastLogin: "2026-04-08T08:30:00.000Z",
      createdAt: "2026-04-03T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439015",
      name: "Nora Staff",
      email: "nora@bluewhale.test",
      phone: "+94770000005",
      role: "SalesStaff",
      reportsTo: "507f1f77bcf86cd799439013",
      createdBy: "507f1f77bcf86cd799439013",
      lastLogin: null,
      createdAt: "2026-04-04T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439016",
      name: "Agent Alex",
      email: "alex@bluewhale.test",
      phone: "+94770000006",
      role: "AgentAdmin",
      reportsTo: null,
      createdBy: "507f1f77bcf86cd799439011",
      lastLogin: null,
      createdAt: "2026-04-05T10:00:00.000Z",
    },
    {
      _id: "507f1f77bcf86cd799439017",
      name: "B2C Lead",
      email: "b2c@bluewhale.test",
      phone: "+94770000007",
      role: "SalesAdmin",
      reportsTo: null,
      createdBy: "507f1f77bcf86cd799439011",
      lastLogin: null,
      createdAt: "2026-04-06T10:00:00.000Z",
    },
  ];

  const teams = [
    {
      _id: "607f1f77bcf86cd799439011",
      name: "B2B",
      ownerAdmin: "507f1f77bcf86cd799439013",
      members: ["507f1f77bcf86cd799439014", "507f1f77bcf86cd799439015"],
    },
    {
      _id: "607f1f77bcf86cd799439012",
      name: "Retail",
      ownerAdmin: "507f1f77bcf86cd799439017",
      members: [],
    },
  ];

  const { service } = loadService({ admins, teams });
  const mainAdmin = { _id: "507f1f77bcf86cd799439011", role: "MainAdmin" };
  const salesAdmin = { _id: "507f1f77bcf86cd799439013", role: "SalesAdmin" };

  const list = await service.listAgentSettings(
    {
      tab: "sales",
      search: "b2b",
      page: 1,
      limit: 20,
    },
    salesAdmin
  );

  assert.equal(list.items.length, 3);
  assert.equal(list.items[0].teamName, "B2B");
  assert.equal(list.items[0].roleLabel, "Sales Agent");
  assert.equal(list.items[0].createdBy, "Sarah Sales");
  assert.equal(list.summary.totalAgents, 3);
  assert.equal(list.summary.salesCrmAgents, 3);
  assert.equal(list.summary.superAdmins, 0);
  assert.equal(list.summary.totalTeams, 1);

  const meta = await service.getAgentSettingsMeta();
  assert.deepEqual(meta.roles, [
    { value: "MainAdmin", label: "Super Admin" },
    { value: "SalesAdmin", label: "Sales Admin" },
    { value: "SalesStaff", label: "Sales Agent" },
    { value: "AgentAdmin", label: "Agent" },
  ]);

  const legacyAdmins = await service.listAdminsForLegacyEndpoint({ _id: "507f1f77bcf86cd799439014", role: "SalesStaff", reportsTo: "507f1f77bcf86cd799439013" });
  assert.equal(legacyAdmins.length, 2);
  assert.ok(legacyAdmins.every((item) => ["507f1f77bcf86cd799439013", "507f1f77bcf86cd799439014"].includes(String(item._id))));

  const created = await service.createAdminRecord(
    {
      name: "New Sales Staff",
      email: "newstaff@bluewhale.test",
      password: "secret123",
      role: "SalesStaff",
      reportsTo: "507f1f77bcf86cd799439013",
      phone: "+94770000008",
    },
    mainAdmin
  );
  assert.equal(created.role, "SalesStaff");
  assert.equal(String(created.createdBy), "507f1f77bcf86cd799439011");

  await assert.rejects(
    () =>
      service.createAdminRecord(
        {
          name: "Bad Sales Staff",
          email: "badstaff@bluewhale.test",
          password: "secret123",
          role: "SalesStaff",
        },
        mainAdmin
      ),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /SalesStaff requires a valid reportsTo SalesAdmin/i);
      return true;
    }
  );

  await assert.rejects(
    () =>
      service.createAdminRecord(
        {
          name: "Bad Role",
          email: "badrole@bluewhale.test",
          password: "secret123",
          role: "AgentAdmin",
        },
        salesAdmin
      ),
    (error) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /SalesAdmin can only create SalesStaff users/i);
      return true;
    }
  );

  const updated = await service.updateAdminRecord(
    "507f1f77bcf86cd799439014",
    {
      name: "Ajo Updated",
      email: "ajo.updated@bluewhale.test",
      phone: "+94770000999",
      password: "newpass123",
    },
    salesAdmin
  );
  assert.equal(updated.name, "Ajo Updated");
  assert.equal(updated.email, "ajo.updated@bluewhale.test");

  await assert.rejects(
    () =>
      service.updateAdminRecord(
        "507f1f77bcf86cd799439014",
        {
          role: "AgentAdmin",
        },
        salesAdmin
      ),
    (error) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /SalesAdmin can only manage SalesStaff users/i);
      return true;
    }
  );

  const deleted = await service.deleteAdminRecord("507f1f77bcf86cd799439015", salesAdmin);
  assert.equal(deleted.success, true);

  await assert.rejects(
    () => service.deleteAdminRecord("507f1f77bcf86cd799439013", salesAdmin),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "SELF_DELETE_BLOCKED");
      return true;
    }
  );

  const { service: singleMainService } = loadService({
    admins: admins.filter((item) => item.role !== "MainAdmin" || item._id === "507f1f77bcf86cd799439011"),
    teams,
  });

  await assert.rejects(
    () => singleMainService.deleteAdminRecord("507f1f77bcf86cd799439011", { _id: "507f1f77bcf86cd799439017", role: "MainAdmin" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "LAST_MAIN_ADMIN_PROTECTED");
      return true;
    }
  );
};
