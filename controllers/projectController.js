const asyncHandler = require("express-async-handler");
const Project = require("../models/Project");
const { getSalesScope, buildOwnedFilter } = require("../utils/salesScope");

const toNum = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

const normalizeTags = (tags) => {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag || "").trim()).filter(Boolean);
  if (typeof tags === "string") return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
};

const normalizeVisibleTabs = (tabs) => {
  if (Array.isArray(tabs)) return tabs.map((tab) => String(tab || "").trim()).filter(Boolean);
  if (typeof tabs === "string") return tabs.split(",").map((tab) => tab.trim()).filter(Boolean);
  return undefined;
};

const listProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find(buildOwnedFilter(req, "ownerAdmin", "teamAdmin"))
    .populate("ownerAdmin", "name email role")
    .populate("members", "name email role")
    .sort({ createdAt: -1 })
    .lean();

  return res.json({ success: true, data: projects });
});

const createProject = asyncHandler(async (req, res) => {
  const scope = getSalesScope(req);
  const body = req.body || {};
  const customer = body.customer || {};

  if (!body.projectName || !customer.name || !body.startDate) {
    return res.status(400).json({ message: "Project name, customer, and start date are required" });
  }

  const project = await Project.create({
    teamAdmin: scope.managerId,
    ownerAdmin: scope.actorId,
    projectName: body.projectName,
    customer: {
      sourceId: customer.sourceId || null,
      name: customer.name,
      email: customer.email || "",
      phone: customer.phone || "",
      type: customer.type || "Other",
    },
    billingType: body.billingType || "Fixed Rate",
    status: body.status || "In Progress",
    progressMode: body.progressMode === "tasks" ? "tasks" : "manual",
    progress: Math.max(0, Math.min(100, toNum(body.progress))),
    totalRate: toNum(body.totalRate),
    estimatedHours: toNum(body.estimatedHours),
    members: Array.isArray(body.members) ? body.members : [],
    startDate: body.startDate,
    deadline: body.deadline || null,
    tags: normalizeTags(body.tags),
    description: body.description || "",
    sendCreatedEmail: Boolean(body.sendCreatedEmail),
    settings: {
      sendContactsNotifications: body.settings?.sendContactsNotifications || "enabled-contacts",
      visibleTabs: normalizeVisibleTabs(body.settings?.visibleTabs),
      permissions: {
        ...(body.settings?.permissions || {}),
      },
    },
  });

  const populated = await Project.findById(project._id)
    .populate("ownerAdmin", "name email role")
    .populate("members", "name email role")
    .lean();

  return res.status(201).json({ success: true, data: populated });
});

const updateProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
  if (!project) return res.status(404).json({ message: "Project not found" });

  const body = req.body || {};
  const customer = body.customer || {};

  if (body.projectName !== undefined) project.projectName = body.projectName;
  if (customer.name !== undefined) project.customer.name = customer.name;
  if (customer.email !== undefined) project.customer.email = customer.email;
  if (customer.phone !== undefined) project.customer.phone = customer.phone;
  if (customer.type !== undefined) project.customer.type = customer.type;
  if (customer.sourceId !== undefined) project.customer.sourceId = customer.sourceId || null;
  if (body.billingType !== undefined) project.billingType = body.billingType;
  if (body.status !== undefined) project.status = body.status;
  if (body.progressMode !== undefined) project.progressMode = body.progressMode === "tasks" ? "tasks" : "manual";
  if (body.progress !== undefined) project.progress = Math.max(0, Math.min(100, toNum(body.progress)));
  if (body.totalRate !== undefined) project.totalRate = toNum(body.totalRate);
  if (body.estimatedHours !== undefined) project.estimatedHours = toNum(body.estimatedHours);
  if (body.members !== undefined) project.members = Array.isArray(body.members) ? body.members : [];
  if (body.startDate !== undefined) project.startDate = body.startDate;
  if (body.deadline !== undefined) project.deadline = body.deadline || null;
  if (body.tags !== undefined) project.tags = normalizeTags(body.tags);
  if (body.description !== undefined) project.description = body.description;
  if (body.sendCreatedEmail !== undefined) project.sendCreatedEmail = Boolean(body.sendCreatedEmail);
  if (body.settings?.sendContactsNotifications !== undefined) {
    project.settings.sendContactsNotifications = body.settings.sendContactsNotifications;
  }
  if (body.settings?.visibleTabs !== undefined) {
    project.settings.visibleTabs = normalizeVisibleTabs(body.settings.visibleTabs);
  }
  if (body.settings?.permissions && typeof body.settings.permissions === "object") {
    project.settings.permissions = {
      ...(project.settings?.permissions?.toObject ? project.settings.permissions.toObject() : project.settings?.permissions || {}),
      ...body.settings.permissions,
    };
  }

  await project.save();

  const populated = await Project.findById(project._id)
    .populate("ownerAdmin", "name email role")
    .populate("members", "name email role")
    .lean();

  return res.json({ success: true, data: populated });
});

const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findOneAndDelete({ _id: req.params.id, ...buildOwnedFilter(req, "ownerAdmin", "teamAdmin") });
  if (!project) return res.status(404).json({ message: "Project not found" });
  return res.json({ success: true, message: "Project deleted successfully" });
});

module.exports = {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
};
