// Server-side crypto payment verification. Never trust a transaction hash
// at face value: we check the public blockchain before any admin approval
// can activate a subscription.
//
// USDT: TronGrid (free, no key) — checks the tx exists, succeeded, is a
//   TRC20 transfer of the real USDT contract, paid to OUR wallet, for the
//   right amount, with enough confirmations.
// BTC: mempool.space (free, no key) — checks the tx exists, is confirmed,
//   paid to OUR wallet, for the right amount, with enough confirmations.

const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;
const USDT_TRC20_BASE58 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // official USDT contract
const USDT_DECIMALS = 6;
const MIN_USDT_CONFIRMATIONS = 12; // ~36 seconds on Tron
const MIN_BTC_CONFIRMATIONS = 2;   // ~20 minutes on Bitcoin
const FETCH_TIMEOUT_MS = 10000;

export function isValidTxHash(hash) {
  return TX_HASH_RE.test(String(hash || "").trim());
}

export function explorerUrl(currency, txHash) {
  if (String(currency).toUpperCase() === "BTC") return `https://mempool.space/tx/${txHash}`;
  return `https://tronscan.org/#/transaction/${txHash}`;
}

async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(t);
  }
}

// ---- Tron address helpers (base58check -> hex) ----
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s) {
  const bytes = [];
  for (const ch of s) {
    const val = B58_ALPHABET.indexOf(ch);
    if (val === -1) throw new Error("Invalid base58 character");
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  let leadingZeros = 0;
  for (const ch of s) { if (ch === "1") leadingZeros++; else break; }
  const out = new Array(leadingZeros).fill(0);
  for (let i = bytes.length - 1; i >= 0; i--) out.push(bytes[i]);
  return out;
}

// "TXYZ..." -> "41..." hex (drops the 4-byte checksum)
export function tronBase58ToHex(addr) {
  const bytes = base58Decode(String(addr || "").trim());
  if (bytes.length < 25) throw new Error("Bad Tron address length");
  const payload = bytes.slice(0, -4);
  return payload.map((b) => b.toString(16).padStart(2, "0")).join("").toLowerCase();
}

function usdtContractHex() {
  return tronBase58ToHex(USDT_TRC20_BASE58);
}

async function tronNowBlock() {
  try {
    const data = await fetchJson("https://api.trongrid.io/wallet/getnowblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return Number(data?.block_header?.raw_data?.number) || 0;
  } catch {
    return 0;
  }
}

async function verifyUsdtTrc20({ txHash, walletAddress, expectedUsdCents }) {
  let data;
  try {
    data = await fetchJson(`https://api.trongrid.io/v1/transactions/${txHash}`);
  } catch {
    return { ok: false, error: "Could not reach the Tron network. Try again in a minute." };
  }
  const tx = data?.data?.[0];
  if (!tx) {
    return { ok: false, error: "Transaction not found on the Tron network. Check the hash and network (must be Tron TRC20)." };
  }
  const contractRet = tx?.ret?.[0]?.contractRet;
  if (contractRet !== "SUCCESS") {
    return { ok: false, error: `Transaction exists but did not succeed (status: ${contractRet || "unknown"}).` };
  }
  const contract = tx?.raw_data?.contract?.[0];
  if (!contract || contract.type !== "TriggerSmartContract") {
    return { ok: false, error: "Not a token transfer transaction." };
  }
  let ours;
  try { ours = tronBase58ToHex(walletAddress); }
  catch { return { ok: false, error: "Our USDT wallet address is misconfigured. Contact support." }; }
  let usdtHex;
  try { usdtHex = usdtContractHex(); }
  catch { return { ok: false, error: "USDT contract check failed. Contact support." }; }
  if (String(contract.contract_address || "").toLowerCase() !== usdtHex) {
    return { ok: false, error: "This transaction is not a USDT (TRC20) transfer. Only USDT on Tron is accepted." };
  }
  const value = contract?.parameter?.value || {};
  const toHex = String(value.to_address || "").toLowerCase();
  if (toHex !== ours) {
    return { ok: false, error: "This transaction was not sent to our wallet address." };
  }
  const receivedMicro = Number(value.amount || 0);
  const expectedMicro = Math.round(Number(expectedUsdCents || 0) * 10000); // cents -> 6-decimal USDT
  const receivedUsd = receivedMicro / 10 ** USDT_DECIMALS;
  if (receivedMicro < expectedMicro * 0.99) {
    const shortBy = ((expectedMicro - receivedMicro) / 10 ** USDT_DECIMALS).toFixed(2);
    return { ok: false, error: `Underpaid by $${shortBy}. The full amount must arrive before approval.` };
  }
  // Confirmations
  const nowBlock = await tronNowBlock();
  const txBlock = Number(tx.blockNumber || 0);
  const confirmations = nowBlock && txBlock ? nowBlock - txBlock + 1 : 0;
  if (nowBlock && confirmations < MIN_USDT_CONFIRMATIONS) {
    return {
      ok: false, waiting: true, confirmations,
      error: `Transaction is valid but only has ${confirmations} of ${MIN_USDT_CONFIRMATIONS} confirmations. Wait a minute and retry approval.`,
    };
  }
  return {
    ok: true,
    confirmations,
    received: receivedUsd,
    receivedDisplay: `$${receivedUsd.toFixed(2)} USDT`,
    detail: `USDT TRC20 transfer of $${receivedUsd.toFixed(2)} to our wallet, block ${txBlock}.`,
  };
}

async function verifyBtc({ txHash, walletAddress, expectedBtc }) {
  let tx;
  try {
    tx = await fetchJson(`https://mempool.space/api/tx/${txHash}`);
  } catch {
    return { ok: false, error: "Could not reach the Bitcoin network. Try again in a minute." };
  }
  if (!tx || !tx.txid) {
    return { ok: false, error: "Transaction not found on the Bitcoin network. Check the hash." };
  }
  const status = tx.status || {};
  if (!status.confirmed) {
    return { ok: false, waiting: true, error: "Transaction is in the mempool but not confirmed yet. Wait for confirmations and retry." };
  }
  let tip = 0;
  try { tip = Number(await fetchJson("https://mempool.space/api/blocks/tip/height")) || 0; } catch {}
  const confirmations = tip && status.block_height ? tip - status.block_height + 1 : 0;
  if (tip && confirmations < MIN_BTC_CONFIRMATIONS) {
    return {
      ok: false, waiting: true, confirmations,
      error: `Transaction is valid but only has ${confirmations} of ${MIN_BTC_CONFIRMATIONS} confirmations. Wait and retry approval.`,
    };
  }
  const ours = String(walletAddress || "").trim();
  let receivedSats = 0;
  for (const out of tx.vout || []) {
    if (String(out.scriptpubkey_address || "") === ours) receivedSats += Number(out.value || 0);
  }
  if (receivedSats <= 0) {
    return { ok: false, error: "This transaction paid nothing to our wallet address." };
  }
  const expectedSats = Math.round(Number(expectedBtc || 0) * 1e8);
  const receivedBtc = receivedSats / 1e8;
  if (expectedSats > 0 && receivedSats < expectedSats * 0.98) {
    return { ok: false, error: `Underpaid: received ${receivedBtc.toFixed(8)} BTC, expected ${(expectedSats / 1e8).toFixed(8)} BTC.` };
  }
  return {
    ok: true,
    confirmations,
    received: receivedBtc,
    receivedDisplay: `${receivedBtc.toFixed(8)} BTC`,
    detail: `Bitcoin transfer of ${receivedBtc.toFixed(8)} BTC to our wallet, block ${status.block_height}.`,
  };
}

// Live BTC price in USD (CoinGecko free tier). Used to quote BTC amounts.
export async function getBtcPriceUsd() {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  );
  const price = Number(data?.bitcoin?.usd);
  if (!price || price <= 0) throw new Error("bad price");
  return price;
}

export function isValidCryptoAddress(currency, address) {
  const a = String(address || "").trim();
  if (String(currency).toUpperCase() === "BTC") {
    return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a);
  }
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a); // Tron base58
}

// Main entry: verify a stored crypto payment on-chain.
export async function verifyCryptoPayment({ cryptoCurrency, txHash, walletAddress, amountUsdCents, cryptoAmount }) {
  const currency = String(cryptoCurrency || "").toUpperCase();
  if (!isValidTxHash(txHash)) {
    return { ok: false, error: "Invalid transaction hash format." };
  }
  if (currency === "BTC") {
    const expectedBtc = Number(cryptoAmount || 0);
    return verifyBtc({ txHash, walletAddress, expectedBtc });
  }
  return verifyUsdtTrc20({ txHash, walletAddress, expectedUsdCents: amountUsdCents });
}
