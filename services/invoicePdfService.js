const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const escapePdfText = (text) =>
  String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const splitText = (text, maxChars = 90) => {
  const safe = String(text || "").trim();
  if (!safe) return [""];
  if (safe.length <= maxChars) return [safe];

  const words = safe.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const buildPdfFromSingleStream = (stream) => {
  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontRegularObjNum = 3;
  const fontBoldObjNum = 4;
  const contentObjNum = 5;
  const pageObjNum = 6;

  const objects = [
    `${catalogObjNum} 0 obj\n<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\nendobj`,
    `${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${pageObjNum} 0 R] /Count 1 >>\nendobj`,
    `${fontRegularObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
    `${fontBoldObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`,
    `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj`,
    `${pageObjNum} 0 obj\n<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${fontRegularObjNum} 0 R /F2 ${fontBoldObjNum} 0 R >> >> >>\nendobj`,
  ];

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
};

const formatDate = (v) => {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
};

const formatMoney = (amount, currency = "USD") => {
  const n = Number(amount || 0);
  return n.toLocaleString(undefined, { style: "currency", currency, maximumFractionDigits: 2 });
};

const buildInvoicePdfBuffer = (invoice) => {
  const cmds = [];
  let y = 790;

  const text = (value, { bold = false, size = 10, x = 42, yy = y, color = "0.10 0.15 0.25" } = {}) => {
    cmds.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${x} ${yy} Td (${escapePdfText(value)}) Tj ET`);
  };

  const writeLines = (value, opts = {}) => {
    const lines = splitText(value, opts.maxChars || 80);
    for (const line of lines) {
      text(line, { ...opts, yy: y });
      y -= opts.step || 14;
    }
  };

  cmds.push("0.06 0.20 0.47 rg 0 760 595 82 re f");
  cmds.push("0.10 0.34 0.72 rg 0 744 595 16 re f");
  text("BLUE WHALE MIGRATION", { bold: true, size: 22, x: 42, yy: 792, color: "1 1 1" });
  text("INVOICE", { bold: true, size: 18, x: 470, yy: 774, color: "1 1 1" });
  text(`Generated: ${new Date().toLocaleString()}`, { size: 9, x: 42, yy: 748, color: "0.92 0.95 1" });

  y = 710;

  cmds.push("0.96 0.97 1 rg 42 612 246 94 re f");
  cmds.push("0.86 0.89 0.96 RG 1 w 42 612 246 94 re S");
  text("Invoice Details", { bold: true, size: 12, x: 52, yy: 690, color: "0.09 0.20 0.45" });
  text(`Invoice #: ${invoice.invoiceNumber || "-"}`, { bold: true, x: 52, yy: 672 });
  text(`Status: ${invoice.status || "-"}`, { x: 52, yy: 656 });
  text(`Issue Date: ${formatDate(invoice.issueDate)}`, { x: 52, yy: 640 });
  text(`Due Date: ${formatDate(invoice.dueDate)}`, { x: 52, yy: 624 });

  cmds.push("0.96 0.97 1 rg 307 612 246 94 re f");
  cmds.push("0.86 0.89 0.96 RG 1 w 307 612 246 94 re S");
  text("Bill To", { bold: true, size: 12, x: 317, yy: 690, color: "0.09 0.20 0.45" });
  text(`${invoice.customer?.name || "-"}`, { bold: true, x: 317, yy: 672 });
  text(`${invoice.customer?.email || "-"}`, { x: 317, yy: 656 });
  if (invoice.customer?.phone) text(`${invoice.customer.phone}`, { x: 317, yy: 640 });
  if (invoice.customer?.address) {
    const addressLines = splitText(invoice.customer.address, 38);
    let addrY = 624;
    for (const line of addressLines.slice(0, 2)) {
      text(line, { x: 317, yy: addrY });
      addrY -= 14;
    }
  }

  y = 548;
  cmds.push("0.11 0.28 0.62 rg 42 566 510 24 re f");
  text("Description", { bold: true, size: 10, x: 50, yy: 574, color: "1 1 1" });
  text("Qty", { bold: true, size: 10, x: 300, yy: 574, color: "1 1 1" });
  text("Unit Price", { bold: true, size: 10, x: 338, yy: 574, color: "1 1 1" });
  text("Tax %", { bold: true, size: 10, x: 414, yy: 574, color: "1 1 1" });
  text("Discount", { bold: true, size: 10, x: 456, yy: 574, color: "1 1 1" });
  text("Line Total", { bold: true, size: 10, x: 510, yy: 574, color: "1 1 1" });

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  if (items.length === 0) {
    text("No items", { x: 50, yy: 536, color: "0.45 0.49 0.57" });
    y = 526;
  } else {
    for (const item of items.slice(0, 12)) {
      y -= 22;
      cmds.push(`0.93 0.95 0.98 RG 1 w 42 ${y - 6} 510 22 re S`);
      text(splitText(item.description || "-", 36)[0], { x: 50, yy: y, color: "0.15 0.18 0.24" });
      text(String(item.quantity ?? 0), { x: 304, yy: y, color: "0.15 0.18 0.24" });
      text(formatMoney(item.unitPrice, invoice.currency), { x: 338, yy: y, color: "0.15 0.18 0.24" });
      text(Number(item.taxRate || 0).toFixed(2), { x: 418, yy: y, color: "0.15 0.18 0.24" });
      text(formatMoney(item.discount || 0, invoice.currency), { x: 456, yy: y, color: "0.15 0.18 0.24" });
      text(formatMoney(item.lineTotal || 0, invoice.currency), { x: 510, yy: y, color: "0.15 0.18 0.24" });
    }
  }

  const summaryTop = Math.max(y - 26, 280);
  cmds.push(`0.97 0.98 1 rg 330 ${summaryTop - 100} 222 100 re f`);
  cmds.push(`0.86 0.89 0.96 RG 1 w 330 ${summaryTop - 100} 222 100 re S`);
  text(`Subtotal:`, { bold: true, x: 340, yy: summaryTop - 22 });
  text(`${formatMoney(invoice.subtotal, invoice.currency)}`, { x: 470, yy: summaryTop - 22 });
  text(`Discount:`, { x: 340, yy: summaryTop - 38 });
  text(`${formatMoney(invoice.discountTotal, invoice.currency)}`, { x: 470, yy: summaryTop - 38 });
  text(`Tax:`, { x: 340, yy: summaryTop - 54 });
  text(`${formatMoney(invoice.taxTotal, invoice.currency)}`, { x: 470, yy: summaryTop - 54 });
  text(`Grand Total:`, { bold: true, x: 340, yy: summaryTop - 72, color: "0.06 0.20 0.47" });
  text(`${formatMoney(invoice.grandTotal, invoice.currency)}`, { bold: true, x: 470, yy: summaryTop - 72, color: "0.06 0.20 0.47" });
  text(`Balance Due:`, { bold: true, x: 340, yy: summaryTop - 90, color: "0.70 0.11 0.11" });
  text(`${formatMoney(invoice.balanceDue, invoice.currency)}`, { bold: true, x: 470, yy: summaryTop - 90, color: "0.70 0.11 0.11" });

  let notesY = summaryTop - 130;
  if (invoice.notes) {
    text("Notes", { bold: true, size: 12, x: 42, yy: notesY, color: "0.09 0.20 0.45" });
    notesY -= 16;
    y = notesY;
    writeLines(invoice.notes, { x: 42, step: 13, maxChars: 95 });
    notesY = y;
  }

  text("Blue Whale Migration CRM Billing", { size: 9, x: 42, yy: Math.max(52, notesY - 10), color: "0.40 0.45 0.53" });
  text(`Currency: ${invoice.currency || "USD"}`, {
    size: 9,
    x: 470,
    yy: Math.max(52, notesY - 10),
    color: "0.40 0.45 0.53",
  });

  return buildPdfFromSingleStream(cmds.join("\n"));
};

module.exports = { buildInvoicePdfBuffer };
