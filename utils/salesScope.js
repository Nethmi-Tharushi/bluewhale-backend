const mongoose = require("mongoose");

const SALES_ROLES = ["SalesAdmin", "SalesStaff"];

const normalizeObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(value);
  return null;
};

const ensureSalesActor = (req) => {
  const role = req?.admin?.role;
  if (!req?.admin || !SALES_ROLES.includes(role)) {
    const err = new Error("Access denied");
    err.statusCode = 403;
    throw err;
  }
};

const getSalesScope = (req) => {
  ensureSalesActor(req);

  const actorId = normalizeObjectId(req.admin._id);
  const managerId =
    req.admin.role === "SalesStaff"
      ? normalizeObjectId(req.admin.reportsTo) || actorId
      : actorId;

  return {
    actorId,
    managerId,
    role: req.admin.role,
    isSalesAdmin: req.admin.role === "SalesAdmin",
    isSalesStaff: req.admin.role === "SalesStaff",
  };
};

const buildOwnedFilter = (req, ownerField = "salesAdmin", managerField = "teamAdmin") => {
  const scope = getSalesScope(req);
  if (scope.isSalesStaff) {
    return {
      [ownerField]: scope.actorId,
    };
  }

  return {
    $or: [
      { [managerField]: scope.managerId },
      { [ownerField]: scope.actorId },
    ],
  };
};

module.exports = {
  SALES_ROLES,
  ensureSalesActor,
  getSalesScope,
  buildOwnedFilter,
};
