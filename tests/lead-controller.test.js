const assert = require("node:assert/strict");
const path = require("path");

const { loadWithMocks } = require("./helpers/loadWithMocks");

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const buildControllerScenario = () => {
  const adminStore = new Map([
    [
      "507f1f77bcf86cd799439011",
      {
        _id: "507f1f77bcf86cd799439011",
        name: "Sales Admin",
        email: "salesadmin@example.com",
        role: "SalesAdmin",
        reportsTo: null,
        whatsappInbox: { allowAutoAssignment: true },
      },
    ],
    [
      "507f1f77bcf86cd799439010",
      {
        _id: "507f1f77bcf86cd799439010",
        name: "Main Admin",
        email: "mainadmin@example.com",
        role: "MainAdmin",
        reportsTo: null,
        whatsappInbox: { allowAutoAssignment: true },
      },
    ],
    [
      "507f1f77bcf86cd799439031",
      {
        _id: "507f1f77bcf86cd799439031",
        name: "Sales One",
        email: "sales1@example.com",
        role: "SalesStaff",
        reportsTo: "507f1f77bcf86cd799439011",
        whatsappInbox: { allowAutoAssignment: false },
      },
    ],
    [
      "507f1f77bcf86cd799439032",
      {
        _id: "507f1f77bcf86cd799439032",
        name: "Sales Two",
        email: "sales2@example.com",
        role: "SalesStaff",
        reportsTo: "507f1f77bcf86cd799439011",
        whatsappInbox: { allowAutoAssignment: true },
      },
    ],
  ]);

  const leadStore = new Map([
    [
      "507f1f77bcf86cd799439021",
      {
        _id: "507f1f77bcf86cd799439021",
        teamAdmin: "507f1f77bcf86cd799439011",
        ownerAdmin: "507f1f77bcf86cd799439011",
        assignedTo: "507f1f77bcf86cd799439031",
        assignedBy: "507f1f77bcf86cd799439011",
        assignedAt: "2026-04-16T10:00:00.000Z",
        assignmentHistory: [
          {
            action: "assigned",
            assignedTo: "507f1f77bcf86cd799439031",
            previousAssignedTo: null,
            assignedBy: "507f1f77bcf86cd799439011",
            assignedAt: "2026-04-16T10:00:00.000Z",
          },
        ],
        leadNumber: 2002,
        name: "Pipeline Lead",
        status: "Paid Client",
        source: "Campaign",
        sourceDetails: "",
        email: "pipeline@example.com",
        phone: "+971500000002",
        leadValue: 500,
        currency: "AED",
        tags: [],
        description: "",
        lastContactAt: "2026-04-16T10:00:00.000Z",
        createdAt: "2026-04-10T10:00:00.000Z",
        updatedAt: "2026-04-16T10:00:00.000Z",
      },
    ],
    [
      "507f1f77bcf86cd799439022",
      {
        _id: "507f1f77bcf86cd799439022",
        teamAdmin: "507f1f77bcf86cd799439011",
        ownerAdmin: "507f1f77bcf86cd799439011",
        assignedTo: "507f1f77bcf86cd799439031",
        assignedBy: "507f1f77bcf86cd799439011",
        assignedAt: "2026-03-30T10:00:00.000Z",
        assignmentHistory: [
          {
            action: "assigned",
            assignedTo: "507f1f77bcf86cd799439031",
            previousAssignedTo: null,
            assignedBy: "507f1f77bcf86cd799439011",
            assignedAt: "2026-03-30T10:00:00.000Z",
          },
        ],
        leadNumber: 2001,
        name: "Legacy Paid Client",
        email: "legacy@example.com",
        phone: "+971500000001",
        company: "Blue Whale",
        status: "Paid Clients",
        source: "",
        sourceDetails: "",
        leadValue: "1250",
        currency: "AED",
        tags: ["vip", "VIP", "uae"],
        description: "Existing lead",
        lastContactAt: "2026-04-01T10:00:00.000Z",
        createdAt: "2026-03-30T10:00:00.000Z",
      },
    ],
    [
      "507f1f77bcf86cd799439099",
      {
        _id: "507f1f77bcf86cd799439099",
        teamAdmin: "507f1f77bcf86cd799439011",
        ownerAdmin: "507f1f77bcf86cd799439011",
        assignedTo: null,
        assignedBy: null,
        assignedAt: null,
        assignmentHistory: [],
        leadNumber: 2003,
        name: "Meta Applicant",
        email: "meta@example.com",
        phone: "+971500000009",
        company: "",
        status: "Leads",
        source: "Meta Ads",
        sourceDetails: "Campaign Alpha | Hiring Form",
        integrationKey: "meta_lead_ads:meta-lead-99",
        sourceMetadata: {
          provider: "meta_lead_ads",
          integrationProvider: "meta_lead_ads",
          metaLeadId: "meta-lead-99",
          campaignName: "Campaign Alpha",
          formName: "Hiring Form",
          postName: "Senior Sales Executive",
          jobPosition: "Sales Executive",
          additionalNotes: "Night shift preferred",
          metaLeadTimestamp: "2026-05-07T03:00:00.000Z",
          fetchedAt: "2026-05-07T03:20:00.000Z",
          syncStatus: "synced",
          customFields: [{ name: "Portfolio", key: "portfolio", values: ["https://example.com"] }],
          customFieldValues: { portfolio: "https://example.com" },
          fieldValues: {
            additional_notes: "Night shift preferred",
            job_position: "Sales Executive",
          },
          metaLeadAds: {
            integrationProvider: "meta_lead_ads",
            metaLeadId: "meta-lead-99",
            campaignName: "Campaign Alpha",
            formName: "Hiring Form",
            postName: "Senior Sales Executive",
            jobPosition: "Sales Executive",
            additionalNotes: "Night shift preferred",
            metaLeadTimestamp: "2026-05-07T03:00:00.000Z",
            fetchedAt: "2026-05-07T03:20:00.000Z",
            syncStatus: "synced",
            customFields: [{ name: "Portfolio", key: "portfolio", values: ["https://example.com"] }],
            customFieldValues: { portfolio: "https://example.com" },
            fieldValues: {
              additional_notes: "Night shift preferred",
              job_position: "Sales Executive",
            },
          },
        },
        leadValue: "0",
        currency: "AED",
        tags: ["meta-lead-ads"],
        description: "Meta lead note",
        lastContactAt: "2026-05-07T03:20:00.000Z",
        createdAt: "2026-05-07T03:21:00.000Z",
      },
    ],
  ]);

  const materializeAdmin = (value) => {
    if (!value) return null;
    if (typeof value === "object" && value._id) return clone(value);
    return adminStore.has(String(value)) ? clone(adminStore.get(String(value))) : { _id: String(value), name: "" };
  };

  const materializeLead = (record) => {
    const item = clone(record);
    item.assignedTo = materializeAdmin(item.assignedTo);
    item.assignedBy = materializeAdmin(item.assignedBy);
    item.ownerAdmin = materializeAdmin(item.ownerAdmin);
    item.assignmentHistory = Array.isArray(item.assignmentHistory)
      ? item.assignmentHistory.map((entry) => ({
          ...clone(entry),
          assignedTo: materializeAdmin(entry.assignedTo),
          previousAssignedTo: materializeAdmin(entry.previousAssignedTo),
          assignedBy: materializeAdmin(entry.assignedBy),
        }))
      : [];
    return item;
  };

  const createDoc = (record) => ({
    ...record,
    select() {
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    async lean() {
      return materializeLead(this);
    },
    async save() {
      leadStore.set(String(this._id), clone(this));
      return this;
    },
  });

  const createListQuery = (items) => ({
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    async lean() {
      return items.map((item) => materializeLead(item));
    },
  });

  const filterAssignableAdmins = (query = {}) =>
    Array.from(adminStore.values()).filter((admin) => {
      if (query._id && String(query._id) !== String(admin._id)) return false;
      if (query.role?.$in && !query.role.$in.includes(admin.role)) return false;
      if (query.reportsTo && String(query.reportsTo) !== String(admin.reportsTo || "")) return false;
      if (Array.isArray(query.$or)) {
        return query.$or.some((branch) => {
          if (branch._id) return String(branch._id) === String(admin._id);
          if (branch.role && branch.reportsTo) {
            return admin.role === branch.role && String(admin.reportsTo || "") === String(branch.reportsTo);
          }
          return false;
        });
      }
      return true;
    });

  const getLeadAccessMatches = (query = {}) =>
    Array.from(leadStore.values()).filter((lead) => {
      if (query._id && String(query._id) !== String(lead._id)) return false;
      if (query.assignedTo && typeof query.assignedTo === "object" && "$ne" in query.assignedTo) {
        if (lead.assignedTo === null) return false;
      } else if (query.assignedTo === null && lead.assignedTo !== null) {
        return false;
      }
      if (Array.isArray(query.$or)) {
        const matchesBranch = query.$or.some((branch) => {
          if (branch.teamAdmin) return String(branch.teamAdmin) === String(lead.teamAdmin || "");
          if (branch.ownerAdmin) return String(branch.ownerAdmin) === String(lead.ownerAdmin || "");
          if (branch.assignedTo) return String(branch.assignedTo) === String(lead.assignedTo || "");
          return false;
        });
        if (!matchesBranch) return false;
      }
      return true;
    });

  const controller = loadWithMocks(path.resolve(__dirname, "../controllers/leadController.js"), {
    "express-async-handler": (fn) => fn,
    "../models/AdminUser": {
      find: (query = {}) => ({
        select() {
          return this;
        },
        sort() {
          return this;
        },
        async lean() {
          return filterAssignableAdmins(query).map((admin) => clone(admin));
        },
      }),
      findOne: (query = {}) => {
        const admin = filterAssignableAdmins(query)[0] || null;
        return admin
          ? {
              select() {
                return clone(admin);
              },
            }
          : {
              select() {
                return null;
              },
            };
      },
    },
    "../models/Campaign": {
      find: () => ({
        select() {
          return this;
        },
        sort() {
          return this;
        },
        async lean() {
          return [
            {
              _id: "507f1f77bcf86cd799439032",
              campaignName: "Spring Campaign",
              campaignCode: "CMP-1",
            },
          ];
        },
      }),
    },
    "../models/Lead": {
      find: (query = {}) => createListQuery(getLeadAccessMatches(query)),
      findOne: (query = {}) => {
        const lead = getLeadAccessMatches(query)[0] || null;
        return lead ? createDoc(clone(lead)) : null;
      },
      findById: (id) => {
        const lead = leadStore.get(String(id)) || null;
        return lead ? createDoc(clone(lead)) : null;
      },
      countDocuments: async () => leadStore.size,
      create: async (payload) => {
        const doc = {
          _id: `lead-${leadStore.size + 1}`,
          ...clone(payload),
        };
        leadStore.set(String(doc._id), doc);
        return createDoc(doc);
      },
      findOneAndDelete: async (query = {}) => {
        const lead = getLeadAccessMatches(query)[0] || null;
        if (!lead) return null;
        leadStore.delete(String(lead._id));
        return createDoc(clone(lead));
      },
    },
    "../services/adminNotificationService": {
      createAdminNotification: async () => null,
    },
    "../services/crmRealtimeService": {
      emitSalesCrmEvent: () => {},
    },
  });

  return {
    controller,
    leadStore,
  };
};

module.exports = async () => {
  const scenario = buildControllerScenario();
  const { controller, leadStore } = scenario;

  const metaRes = createResponse();
  await controller.getLeadMeta(
    {
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    metaRes
  );
  assert.equal(metaRes.statusCode, 200);
  assert.deepEqual(metaRes.body.data.statuses, [
    "Leads",
    "Prospects",
    "Follow-up Required",
    "Converted Leads",
    "Paid Client",
    "Not Interested",
  ]);
  assert.equal(metaRes.body.data.assignableAdmins[0].canAutoAssign, true);

  const listRes = createResponse();
  await controller.listLeads(
    {
      query: {},
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    listRes
  );
  assert.equal(listRes.statusCode, 200);
  const legacyLead = listRes.body.data.find((lead) => lead._id === "507f1f77bcf86cd799439022");
  const metaLead = listRes.body.data.find((lead) => lead._id === "507f1f77bcf86cd799439099");
  assert.equal(legacyLead.status, "Paid Client");
  assert.equal(legacyLead.assignedTo.name, "Sales One");
  assert.equal(metaLead.integrationProvider, "meta_lead_ads");
  assert.equal(metaLead.assignmentState, "unassigned");
  assert.equal(metaLead.metaLeadAds.additionalNotes, "Night shift preferred");

  const unassignedListRes = createResponse();
  await controller.listLeads(
    {
      query: { assigned: "unassigned" },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    unassignedListRes
  );
  assert.equal(unassignedListRes.statusCode, 200);
  assert.equal(unassignedListRes.body.data.length, 1);
  assert.equal(unassignedListRes.body.data[0]._id, "507f1f77bcf86cd799439099");

  const detailRes = createResponse();
  await controller.getLeadById(
    {
      params: { id: "507f1f77bcf86cd799439099" },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    detailRes
  );
  assert.equal(detailRes.statusCode, 200);
  assert.equal(detailRes.body.data.metaLeadAds.metaLeadId, "meta-lead-99");
  assert.equal(detailRes.body.data.metaLeadAds.customFieldValues.portfolio, "https://example.com");

  const assignMainAdminRes = createResponse();
  await controller.assignLead(
    {
      params: { id: "507f1f77bcf86cd799439099" },
      body: { assignedTo: "507f1f77bcf86cd799439032" },
      admin: {
        _id: "507f1f77bcf86cd799439010",
        role: "MainAdmin",
      },
    },
    assignMainAdminRes
  );
  assert.equal(assignMainAdminRes.statusCode, 200);
  assert.equal(assignMainAdminRes.body.data.assignedTo._id, "507f1f77bcf86cd799439032");
  assert.equal(assignMainAdminRes.body.data.assignedBy._id, "507f1f77bcf86cd799439010");
  assert.ok(assignMainAdminRes.body.data.assignedAt);
  assert.equal(assignMainAdminRes.body.data.assignmentHistory[0].action, "assigned");

  const reassignSalesAdminRes = createResponse();
  await controller.assignLead(
    {
      params: { id: "507f1f77bcf86cd799439099" },
      body: { assignedTo: "507f1f77bcf86cd799439031" },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    reassignSalesAdminRes
  );
  assert.equal(reassignSalesAdminRes.statusCode, 200);
  assert.equal(reassignSalesAdminRes.body.data.assignedTo._id, "507f1f77bcf86cd799439031");
  assert.equal(reassignSalesAdminRes.body.data.assignmentHistory[1].action, "reassigned");
  assert.equal(reassignSalesAdminRes.body.data.assignmentHistory[1].assignedBy._id, "507f1f77bcf86cd799439011");

  const unassignRes = createResponse();
  await controller.assignLead(
    {
      params: { id: "507f1f77bcf86cd799439099" },
      body: { assignedTo: "" },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    unassignRes
  );
  assert.equal(unassignRes.statusCode, 200);
  assert.equal(unassignRes.body.data.assignedTo, null);
  assert.equal(unassignRes.body.data.assignmentState, "unassigned");
  assert.equal(unassignRes.body.data.assignmentHistory[2].action, "unassigned");

  const salesStaffDeniedRes = createResponse();
  await controller.assignLead(
    {
      params: { id: "507f1f77bcf86cd799439099" },
      body: { assignedTo: "507f1f77bcf86cd799439031" },
      admin: {
        _id: "507f1f77bcf86cd799439031",
        role: "SalesStaff",
        reportsTo: "507f1f77bcf86cd799439011",
      },
    },
    salesStaffDeniedRes
  );
  assert.equal(salesStaffDeniedRes.statusCode, 403);

  const salesStaffUpdateDeniedRes = createResponse();
  await controller.updateLead(
    {
      params: { id: "507f1f77bcf86cd799439021" },
      body: { assignedTo: "507f1f77bcf86cd799439032" },
      admin: {
        _id: "507f1f77bcf86cd799439031",
        role: "SalesStaff",
        reportsTo: "507f1f77bcf86cd799439011",
      },
    },
    salesStaffUpdateDeniedRes
  );
  assert.equal(salesStaffUpdateDeniedRes.statusCode, 403);

  const bulkAssignRes = createResponse();
  await controller.bulkAssignLeads(
    {
      body: {
        leadIds: ["507f1f77bcf86cd799439099", "507f1f77bcf86cd799439021"],
        assignedTo: "507f1f77bcf86cd799439032",
      },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    bulkAssignRes
  );
  assert.equal(bulkAssignRes.statusCode, 200);
  assert.equal(bulkAssignRes.body.data.updatedCount, 2);
  assert.equal(bulkAssignRes.body.data.failureCount, 0);

  const statusRes = createResponse();
  await controller.updateLeadStatus(
    {
      params: { id: "507f1f77bcf86cd799439021" },
      body: { status: "Paid Clients" },
      admin: {
        _id: "507f1f77bcf86cd799439011",
        role: "SalesAdmin",
      },
    },
    statusRes
  );
  assert.equal(statusRes.statusCode, 200);
  assert.equal(statusRes.body.data.status, "Paid Client");

  const finalLead = leadStore.get("507f1f77bcf86cd799439099");
  assert.equal(finalLead.assignedTo, "507f1f77bcf86cd799439032");
  assert.equal(Array.isArray(finalLead.assignmentHistory), true);
  assert.equal(finalLead.assignmentHistory.length >= 3, true);
};
