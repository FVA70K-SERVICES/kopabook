// CSV parsing, header mapping and row validation for marketplace imports.

export const TARGET_FIELDS = [
  "productName",
  "quantity",
  "unitPrice",
  "total",
  "date",
  "customerName",
  "sku",
];

export const FIELD_LABELS = {
  productName: "Product name",
  quantity: "Quantity",
  unitPrice: "Unit price",
  total: "Total",
  date: "Date",
  customerName: "Customer name",
  sku: "SKU (optional)",
};

// Parse CSV text: handles quoted fields, commas inside quotes, doubled
// quotes ("" -> "), and CRLF/LF line endings. Returns {headers, rows}
// where rows are arrays of strings, and headers are the trimmed first row.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const t = String(text || "").replace(/^\uFEFF/, ""); // strip BOM

  while (i < t.length) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field.trim()); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") {
      row.push(field.trim()); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = []; i++; continue;
    }
    field += ch; i++;
  }
  // last line without trailing newline
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);

  if (rows.length === 0) return { headers: [], rows: [] };
  const [headers, ...data] = rows;
  return { headers, rows: data };
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Suggest a header -> target field mapping using header-name heuristics.
// Returns {targetField: headerIndex or -1}.
export function detectMapping(headers) {
  const patterns = {
    productName: ["productname", "itemname", "product", "item", "producttitle", "title", "description", "sku", "sellerSKU", "sku", "sellernumber", "productid"],
    quantity: ["qty", "quantity", "orderedqty", "quantityordered", "qtysold", "units"],
    unitPrice: ["unitprice", "price", "itemprice", "saleprice", "sellingprice", "unitamount", "unitcost"],
    total: ["total", "grandtotal", "amount", "subtotal", "totalamount", "ordertotal", "netamount", "totalprice"],
    date: ["date", "orderdate", "saledate", "transactiondate", "created", "purchasedate", "settlementdate"],
    customerName: ["customer", "customername", "buyer", "buyername", "customeremail", "recipient"],
    sku: ["sku", "sellersku", "sku"],
  };

  const mapping = {};
  const used = new Set();

  for (const field of TARGET_FIELDS) {
    let found = -1;
    // pass 1: exact normalized match
    for (let i = 0; i < headers.length; i++) {
      const h = norm(headers[i]);
      if (patterns[field].includes(h) && !used.has(i)) { found = i; break; }
    }
    // pass 2: contains match (patterns[field] containing header or header containing pattern)
    if (found === -1) {
      for (let i = 0; i < headers.length; i++) {
        if (used.has(i)) continue;
        const h = norm(headers[i]);
        if (!h) continue;
        if (patterns[field].some((p) => p === h || h.includes(p) || p.includes(h))) {
          found = i; break;
        }
      }
    }
    mapping[field] = found;
    if (found !== -1) used.add(found);
  }

  // productName prefers an SKU-only match only when no better name column exists.
  // If "sku" matched productName AND a separate sku column was also picked,
  // keep both as-is; validateRows still passes with the name taken from the SKU column.
  return mapping;
}

// Resolve one cell value from a data row using the mapping.
export function cell(row, mapping, field) {
  const idx = mapping[field];
  if (idx == null || idx < 0 || idx >= row.length) return "";
  return row[idx];
}

// Check the rows against the mapping. Returns {valid, errors}.
// valid is an array of {index, name, quantity, unitPrice, total, date, customerName, sku}.
export function validateRows(rows, mapping) {
  const valid = [];
  const errors = [];

  const nameIdx = mapping.productName;
  if (nameIdx == null || nameIdx < 0) {
    return { valid: [], errors: [{ index: -1, message: "No product name column selected. Map one column to Product name." }] };
  }

  rows.forEach((row, i) => {
    const line = i + 2; // 1-based line in the file (header is line 1)
    const name = (row[nameIdx] || "").trim();
    if (!name) {
      errors.push({ index: i, line, message: `Row ${line}: product name is empty.` });
      return;
    }
    const rawQty = cell(row, mapping, "quantity");
    const qty = rawQty === "" ? 1 : Number(rawQty);
    if (rawQty !== "" && (!Number.isFinite(qty) || qty <= 0)) {
      errors.push({ index: i, line, message: `Row ${line}: quantity "${rawQty}" is not a valid number.` });
      return;
    }
    const rawPrice = cell(row, mapping, "unitPrice");
    const unitPrice = rawPrice === "" ? null : Number(rawPrice);
    if (rawPrice !== "" && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      errors.push({ index: i, line, message: `Row ${line}: unit price "${rawPrice}" is not a valid number.` });
      return;
    }
    const rawTotal = cell(row, mapping, "total");
    const total = rawTotal === "" ? null : Number(rawTotal);
    if (rawTotal !== "" && (!Number.isFinite(total) || total < 0)) {
      errors.push({ index: i, line, message: `Row ${line}: total "${rawTotal}" is not a valid number.` });
      return;
    }
    valid.push({
      index: i,
      name,
      quantity: qty,
      unitPrice,
      total,
      date: cell(row, mapping, "date"),
      customerName: (cell(row, mapping, "customerName") || "").trim(),
      sku: (cell(row, mapping, "sku") || "").trim(),
    });
  });

  return { valid, errors };
}
