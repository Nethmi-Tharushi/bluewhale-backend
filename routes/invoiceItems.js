const express = require("express");
const router = express.Router();
const { protectAdmin, authorizeAdmin } = require("../middlewares/AdminAuth");
const {
  listInvoiceItems,
  getInvoiceItemById,
  createInvoiceItem,
  updateInvoiceItem,
  deleteInvoiceItem,
} = require("../controllers/invoiceItemController");

const readRoles = ["MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"];
const manageRoles = ["MainAdmin", "SalesAdmin", "SalesStaff", "Accountant"];

router.get("/", protectAdmin, authorizeAdmin(...readRoles), listInvoiceItems);
router.get("/:id", protectAdmin, authorizeAdmin(...readRoles), getInvoiceItemById);
router.post("/", protectAdmin, authorizeAdmin(...manageRoles), createInvoiceItem);
router.put("/:id", protectAdmin, authorizeAdmin(...manageRoles), updateInvoiceItem);
router.delete("/:id", protectAdmin, authorizeAdmin(...manageRoles), deleteInvoiceItem);

module.exports = router;
