import { useEffect, useMemo, useState } from "react";
import { api, fmt, nav } from "../lib/api";
import { parseCSV, detectMapping, validateRows, cell, TARGET_FIELDS, FIELD_LABELS } from "../lib/csv";

const REVIEW_KEY = "kopabook_import_review";

function loadReviewQueue() {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveReviewQueue(q) {
  try { localStorage.setItem(REVIEW_KEY, JSON.stringify(q)); } catch {}
}

export default function ImportPage() {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null); // {headers, rows}
  const [mapping, setMapping] = useState(null);
  const [validRows, setValidRows] = useState([]);
  const [rowErrors, setRowErrors] = useState([]);
  const [products, setProducts] = useState([]);
  const [prodError, setProdError] = useState("");
  const [importState, setImportState] = useState(null); // {done, ok, fail, results:[{name, ok, message}]}
  const [importing, setImporting] = useState(false);
  const [reviewQueue, setReviewQueue] = useState(loadReviewQueue);
  const [parseError, setParseError] = useState("");

  useEffect(() => {
    api.get("/api/products")
      .then((d) => setProducts(d.products || []))
      .catch((e) => setProdError(e.message));
  }, []);

  const productIndex = useMemo(() => {
    const byName = new Map();
    const bySku = new Map();
    for (const p of products) {
      const n = String(p.name || "").toLowerCase().trim();
      if (n && !byName.has(n)) byName.set(n, p);
      const s = String(p.sku || p.SKU || "").toLowerCase().trim();
      if (s && !bySku.has(s)) bySku.set(s, p);
    }
    return { byName, bySku };
  }, [products]);

  function matchRow(r) {
    const nameKey = r.name.toLowerCase().trim();
    let p = productIndex.byName.get(nameKey);
    if (!p && r.sku) p = productIndex.bySku.get(r.sku.toLowerCase().trim());
    if (!p && r.sku) p = productIndex.byName.get(r.sku.toLowerCase().trim());
    return p || null;
  }

  async function handleFile(f) {
    setParseError(""); setParsed(null); setMapping(null); setImportState(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const text = await f.text();
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0 || rows.length === 0) {
        setParseError("Could not read any rows from this file. Check it is a valid CSV.");
        return;
      }
      setParsed({ headers, rows });
      setMapping(detectMapping(headers));
      setStep(2);
    } catch (e) {
      setParseError("Could not read this file: " + e.message);
    }
  }

  function applyMapping() {
    const { valid, errors } = validateRows(parsed.rows, mapping);
    if (valid.length === 0 && errors.length > 0) {
      setRowErrors(errors);
      setValidRows([]);
      return;
    }
    setValidRows(valid);
    setRowErrors(errors);
    setStep(3);
  }

  function recheckMatching() {
    api.get("/api/products")
      .then((d) => {
        const prods = d.products || [];
        setProducts(prods);
        setProdError("");
        // drop queue entries that now match a product
        const byName = new Set(prods.map((p) => String(p.name || "").toLowerCase().trim()));
        setReviewQueue((q) => {
          const kept = q.filter((e) => !byName.has(String(e.name).toLowerCase().trim()));
          saveReviewQueue(kept);
          return kept;
        });
      })
      .catch((e) => setProdError(e.message));
  }

  const matched = useMemo(() => validRows.map((r) => ({ row: r, product: matchRow(r) })), [validRows, productIndex]);
  const unmatchedNames = useMemo(() => {
    const m = new Map();
    for (const { row, product } of matched) {
      if (!product) {
        const k = row.name.toLowerCase().trim();
        if (!m.has(k)) m.set(k, { name: row.name, rowsCount: 0 });
        m.get(k).rowsCount++;
      }
    }
    return [...m.values()];
  }, [matched]);

  function addToReviewQueue() {
    setReviewQueue((q) => {
      const existing = new Map(q.map((e) => [String(e.name).toLowerCase().trim(), e]));
      for (const u of unmatchedNames) {
        const k = u.name.toLowerCase().trim();
        if (existing.has(k)) {
          existing.get(k).rowsCount += u.rowsCount;
        } else {
          existing.set(k, { name: u.name, rowsCount: u.rowsCount, firstSeen: new Date().toISOString().slice(0, 10) });
        }
      }
      const next = [...existing.values()];
      saveReviewQueue(next);
      return next;
    });
  }

  async function runImport() {
    setImporting(true);
    setImportState({ done: 0, ok: 0, fail: 0, results: [] });
    const results = [];
    let ok = 0, fail = 0;
    for (const { row, product } of matched) {
      if (!product) { continue; } // unmatched rows are not imported; they stay in the review queue
      const qty = row.quantity;
      let unitPrice = row.unitPrice;
      if (unitPrice == null && row.total != null && qty > 0) unitPrice = row.total / qty;
      let total = row.total;
      if (total == null && unitPrice != null) total = unitPrice * qty;
      if (unitPrice == null || total == null) {
        fail++;
        results.push({ name: row.name, ok: false, message: "No price found (need unit price or total column)." });
        setImportState({ done: ok + fail, ok, fail, results: [...results] });
        continue;
      }
      try {
        const d = await api.post("/api/sales", {
          items: [{ productId: product.id, quantity: qty, unitPrice }],
          customerName: row.customerName || "Marketplace",
          amountPaid: total,
          paymentMethod: "transfer",
        });
        ok++;
        results.push({ name: row.name, ok: true, message: `Imported as sale ${d.saleNumber || d.saleId} (${fmt(total)}).` });
      } catch (e) {
        fail++;
        results.push({ name: row.name, ok: false, message: e.message });
      }
      setImportState({ done: ok + fail, ok, fail, results: [...results] });
    }
    if (unmatchedNames.length > 0) addToReviewQueue();
    setImporting(false);
    setStep(4);
  }

  const importableCount = matched.filter((m) => m.product).length;

  return (
    <>
      <div className="page-head">
        <h1>Import marketplace sales</h1>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row2" style={{ display: "flex", gap: 8 }}>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className={step === n ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
              onClick={() => { if (n === 1 || (n === 2 && parsed) || (n === 3 && validRows.length) || (n === 4 && importState)) setStep(n); }}
            >
              {n}. {["Upload", "Map columns", "Match", "Import"][n - 1]}
            </button>
          ))}
        </div>
      </div>

      {prodError && <div className="alert alert-error">{prodError}</div>}

      {step === 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 1: Upload a seller report</h3>
          <p>
            Export your sales report from your marketplace seller dashboard as a CSV file, then upload it here.
            Jumia and Konga seller reports both work, as long as each row has a product name, quantity and price.
          </p>
          <div className="field">
            <label>CSV file</label>
            <input type="file" accept=".csv,text/csv" onChange={(e) => handleFile(e.target.files[0])} />
          </div>
          {fileName && <p className="money">{fileName}</p>}
          {parseError && <div className="alert alert-error">{parseError}</div>}
        </div>
      )}

      {step === 2 && parsed && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 2: Map your columns</h3>
          <p>Tell KopaBook which column means what. Guesses are pre-selected, change any that are wrong.</p>
          {TARGET_FIELDS.map((f) => (
            <div className="field" key={f}>
              <label>{FIELD_LABELS[f]}</label>
              <select
                value={mapping[f] == null ? -1 : mapping[f]}
                onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}
              >
                <option value={-1}>Not in file</option>
                {parsed.headers.map((h, i) => (
                  <option key={i} value={i}>{h || `(column ${i + 1})`}</option>
                ))}
              </select>
            </div>
          ))}
          <h4>Preview (first 3 rows)</h4>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>{parsed.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {parsed.rows.slice(0, 3).map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary btn-block" onClick={applyMapping}>Continue to matching</button>
          <button className="btn btn-secondary btn-block" onClick={() => setStep(1)}>Back</button>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 3: Preview and match products</h3>
          {rowErrors.length > 0 && (
            <div className="alert alert-error">
              {rowErrors.length} row{rowErrors.length === 1 ? "" : "s"} skipped: invalid numbers or empty product names.
              <ul>{rowErrors.slice(0, 5).map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            </div>
          )}
          <p>{validRows.length} valid rows. {importableCount} matched to your products, {validRows.length - importableCount} unmatched.</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>CSV product</th><th>Qty</th><th>Price</th><th>KopaBook product</th></tr>
              </thead>
              <tbody>
                {matched.slice(0, 10).map(({ row, product }, i) => (
                  <tr key={i}>
                    <td>{row.name}</td>
                    <td>{row.quantity}</td>
                    <td>{row.total != null ? fmt(row.total) : (row.unitPrice != null ? fmt(row.unitPrice * row.quantity) : "-")}</td>
                    <td>{product ? product.name : "No match"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {validRows.length > 10 && <p className="money">Showing 10 of {validRows.length} rows.</p>}
          {unmatchedNames.length > 0 && (
            <div className="alert">
              <strong>{unmatchedNames.length} product{unmatchedNames.length === 1 ? "" : "s"} not found</strong> in your product list:
              {" "}{unmatchedNames.map((u) => u.name).join(", ")}.
              These rows will be skipped and kept in the review queue below.
            </div>
          )}
          <button className="btn btn-primary btn-block" onClick={runImport} disabled={importableCount === 0}>
            Import {importableCount} matched row{importableCount === 1 ? "" : "s"} as paid sales
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => setStep(2)}>Back</button>
        </div>
      )}

      {step === 4 && importState && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 4: Import results</h3>
          {importing && (
            <p>Importing... {importState.done} of {importableCount} rows done.</p>
          )}
          {!importing && (
            <div className={importState.fail === 0 ? "alert" : "alert alert-error"}>
              Import finished: <strong>{importState.ok} imported</strong>, <strong>{importState.fail} failed</strong>.
              {unmatchedNames.length > 0 && ` ${unmatchedNames.length} product${unmatchedNames.length === 1 ? "" : "s"} were unmatched and skipped to the review queue.`}
            </div>
          )}
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Product</th><th>Status</th></tr></thead>
              <tbody>
                {importState.results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.ok ? "Imported" : `Failed: ${r.message}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-secondary btn-block" onClick={() => setStep(1)}>Import another file</button>
        </div>
      )}

      {reviewQueue.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Review queue</h3>
          <p>Product names from your imports that are not in your product list yet. Create them, then recheck.</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Product name</th><th>Rows</th><th></th></tr></thead>
              <tbody>
                {reviewQueue.map((e, i) => (
                  <tr key={i}>
                    <td>{e.name}</td>
                    <td>{e.rowsCount}</td>
                    <td><button className="btn btn-sm btn-secondary" onClick={() => nav("/app/products")}>Create product</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-secondary btn-block" onClick={recheckMatching}>Recheck matching</button>
        </div>
      )}
    </>
  );
}
