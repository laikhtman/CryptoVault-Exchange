// E2E test suite — run with: node scripts/e2e-test.cjs
"use strict";

const { ethers } = require("ethers");
const btc        = require("@scure/btc-signer");

let passed = 0, failed = 0;
const ok   = (name) => { console.log("  \x1b[32m✓\x1b[0m " + name); passed++; };
const fail = (name, detail) => { console.error("  \x1b[31m✗\x1b[0m " + name + ": " + detail); failed++; };

// Standard BIP39 test mnemonic — widely verified against MetaMask, Trezor, Ledger
const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const root = ethers.HDNodeWallet.fromSeed(
  ethers.Mnemonic.fromPhrase(MNEMONIC).computeSeed()
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const BASE58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = BASE58_ALPHA.indexOf(c);
    if (i < 0) throw new Error("bad char: " + c);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
  bytes.reverse();
  let z = 0;
  for (const c of s) { if (c === "1") z++; else break; }
  return new Uint8Array([...new Array(z).fill(0), ...bytes]);
}

function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { const r = Number(n % 58n); n /= 58n; s = BASE58_ALPHA[r] + s; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s || "1";
}

function sha256sha256(payload) {
  const h1 = ethers.getBytes(ethers.sha256(payload));
  return ethers.getBytes(ethers.sha256(h1));
}

// Build fake zpub from an xpub (for round-trip testing)
function xpubToZpub(xpub) {
  const dec = b58decode(xpub);
  const pl  = dec.slice(0, 78);
  const np  = new Uint8Array(78);
  np.set(new Uint8Array([0x04, 0xb2, 0x47, 0x46]), 0);
  np.set(pl.slice(4), 4);
  const cs = sha256sha256(np).slice(0, 4);
  const out = new Uint8Array(82); out.set(np, 0); out.set(cs, 78);
  return b58encode(out);
}

// Inline normalization (mirrors crypto.ts)
function normalizeZpub(key) {
  if (key.startsWith("xpub")) return key;
  const dec = b58decode(key);
  if (dec.length !== 82) throw new Error("bad length: " + dec.length);
  const pl = dec.slice(0, 78);
  const ZPUB = [0x04, 0xb2, 0x47, 0x46];
  if (!ZPUB.every((b, i) => pl[i] === b)) return key;
  const np = new Uint8Array(78);
  np.set(new Uint8Array([0x04, 0x88, 0xb2, 0x1e]), 0);
  np.set(pl.slice(4), 4);
  const cs = sha256sha256(np).slice(0, 4);
  const out = new Uint8Array(82); out.set(np, 0); out.set(cs, 78);
  return b58encode(out);
}

function deriveBtcAddr(xpub, idx) {
  const node  = ethers.HDNodeWallet.fromExtendedKey(xpub);
  const child = node.derivePath("0/" + idx);
  const comp  = ethers.SigningKey.computePublicKey(child.publicKey, true);
  return btc.p2wpkh(ethers.getBytes(comp)).address;
}

const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
function validateEthXpub(xpub) {
  if (!xpub.trim()) return null;
  if (!xpub.startsWith("xpub")) return 'ETH key must start with "xpub"';
  if (xpub.length < 100 || xpub.length > 120) return "length unusual";
  if (!BASE58_RE.test(xpub)) return "invalid base58";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: ETH derivation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] ETH address derivation");
const ethXpub = root.derivePath("m/44'/60'/0'").neuter().extendedKey;
const ethNode  = ethers.HDNodeWallet.fromExtendedKey(ethXpub);
const ethAddr0 = ethNode.derivePath("0/0").address;
const ethAddr1 = ethNode.derivePath("0/1").address;
const ethAddr9 = ethNode.derivePath("0/9").address;

// Verified against MetaMask + Trezor Suite with this exact mnemonic
const KNOWN_ETH_0 = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
ethAddr0.toLowerCase() === KNOWN_ETH_0.toLowerCase()
  ? ok("addr[0] = " + ethAddr0)
  : fail("addr[0] known-good", "got " + ethAddr0 + " expected " + KNOWN_ETH_0);

ethAddr0 === ethers.getAddress(ethAddr0)
  ? ok("EIP-55 checksummed")
  : fail("EIP-55 checksum", ethAddr0);

ethAddr0 !== ethAddr1 && ethAddr1 !== ethAddr9
  ? ok("indices 0, 1, 9 all distinct")
  : fail("distinctness", "collision detected");

ethAddr0.startsWith("0x") && ethAddr0.length === 42
  ? ok("format: 0x + 40 hex chars")
  : fail("format", ethAddr0);

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: zpub → xpub normalization (checksum recalculation fix)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] zpub → xpub normalization (checksum recalculation)");
const btcXpubOrig = root.derivePath("m/84'/0'/0'").neuter().extendedKey;
const fakeZpub    = xpubToZpub(btcXpubOrig);

fakeZpub.startsWith("zpub")
  ? ok("constructed zpub: " + fakeZpub.slice(0, 14) + "...")
  : fail("zpub construction", fakeZpub.slice(0, 8));

const normalizedXpub = normalizeZpub(fakeZpub);
normalizedXpub.startsWith("xpub")
  ? ok("normalized: " + normalizedXpub.slice(0, 14) + "...")
  : fail("normalization result", "got " + normalizedXpub.slice(0, 8));

// Critical: ethers must accept the normalized key (validates checksum internally)
let normalizeOk = false;
try {
  const testNode = ethers.HDNodeWallet.fromExtendedKey(normalizedXpub);
  normalizeOk = true;
  ok("ethers.fromExtendedKey() accepts normalized key without error");
} catch (e) {
  fail("ethers.fromExtendedKey() checksum validation", e.message);
}

if (normalizeOk) {
  const pkOrig  = ethers.HDNodeWallet.fromExtendedKey(btcXpubOrig).derivePath("0/0").publicKey;
  const pkNorm  = ethers.HDNodeWallet.fromExtendedKey(normalizedXpub).derivePath("0/0").publicKey;
  pkOrig === pkNorm
    ? ok("round-trip: public key at index 0 matches original xpub")
    : fail("round-trip key match", "mismatch after normalize");
}

// Verify that our normalized key produces spec-valid base58check output.
// Note: ethers v6 is lenient (accepts stale checksums), but other BIP32 tools
// (hardware wallets, other libraries) require a valid checksum. We confirm the
// fixed normalization outputs a key whose checksum is actually correct.
const normalizedDec     = b58decode(normalizedXpub);
const normalizedPayload = normalizedDec.slice(0, 78);
const storedChecksum    = normalizedDec.slice(78, 82);
const expectedChecksum  = sha256sha256(normalizedPayload).slice(0, 4);
const checksumMatch     = storedChecksum.every((b, i) => b === expectedChecksum[i]);
checksumMatch
  ? ok("normalized key has correct base58check checksum (valid for all BIP32 tools)")
  : fail("normalized key checksum", "recalculated checksum does not match stored");

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: BTC P2WPKH address generation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] BTC P2WPKH (bc1q) address generation");
const btcAddr0 = deriveBtcAddr(btcXpubOrig, 0);
const btcAddr1 = deriveBtcAddr(btcXpubOrig, 1);
const btcAddr9 = deriveBtcAddr(btcXpubOrig, 9);

// Known-good: "abandon×11 about" BIP84/m/84'/0'/0'/0/0
// Verified against Trezor Suite and Ian Coleman's BIP39 tool
const KNOWN_BTC_0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
btcAddr0 === KNOWN_BTC_0
  ? ok("addr[0] matches Trezor Suite known-good: " + btcAddr0)
  : fail("BTC known-good vector", "got " + btcAddr0 + " expected " + KNOWN_BTC_0);

btcAddr0.startsWith("bc1q")
  ? ok("bc1q prefix (P2WPKH mainnet)")
  : fail("bc1q prefix", btcAddr0);

btcAddr0.length >= 42 && btcAddr0.length <= 62
  ? ok("bech32 length valid (" + btcAddr0.length + " chars)")
  : fail("bech32 length", btcAddr0.length + " chars");

btcAddr0 !== btcAddr1 && btcAddr1 !== btcAddr9
  ? ok("indices 0, 1, 9 all distinct")
  : fail("BTC distinctness", "collision detected");

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: ETH XPUB validation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] ETH XPUB field validation");

validateEthXpub("") === null
  ? ok("empty: no error (field is optional)")
  : fail("empty string", validateEthXpub(""));

validateEthXpub(fakeZpub) !== null
  ? ok("zpub in ETH field: rejected — \"" + validateEthXpub(fakeZpub) + "\"")
  : fail("zpub should be rejected in ETH field", "accepted instead");

validateEthXpub(ethXpub) === null
  ? ok("valid ETH xpub: accepted")
  : fail("valid ETH xpub rejected", validateEthXpub(ethXpub));

validateEthXpub("xpub1234") !== null
  ? ok("short xpub: rejected (length check)")
  : fail("short xpub not rejected", "should fail length check");

validateEthXpub("zpubABC" + "x".repeat(100)) !== null
  ? ok("zpub (any length): rejected in ETH field")
  : fail("long zpub in ETH field", "should be rejected");

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Large-batch derivation — 400 addresses, uniqueness, performance
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] Large batch — 400 ETH + 10 BTC addresses");
const t0 = Date.now();
const ethSet = new Set();
for (let i = 0; i < 400; i++) {
  ethSet.add(ethers.HDNodeWallet.fromExtendedKey(ethXpub).derivePath("0/" + i).address.toLowerCase());
}
const ethMs = Date.now() - t0;

ethSet.size === 400
  ? ok("400 unique ETH addresses (" + ethMs + "ms)")
  : fail("ETH uniqueness", "only " + ethSet.size + " unique out of 400");

ethMs < 20000
  ? ok("performance < 20s for 400 derivations")
  : fail("performance", ethMs + "ms — too slow");

const t1 = Date.now();
const btcSet = new Set();
for (let i = 0; i < 10; i++) {
  btcSet.add(deriveBtcAddr(btcXpubOrig, i));
}
const btcMs = Date.now() - t1;

btcSet.size === 10
  ? ok("10 unique BTC addresses (" + btcMs + "ms)")
  : fail("BTC uniqueness", "collision in first 10");

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Etherscan balance parsing (simulated)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] Balance parsing (Etherscan response format)");

function fmtEth(wei) {
  if (!wei || wei === "0") return "—";
  try {
    const v = parseFloat(ethers.formatEther(BigInt(wei)));
    return v === 0 ? "—" : v.toFixed(6);
  } catch { return "—"; }
}

function fmtToken(raw) {
  if (!raw || raw === "0") return "—";
  try {
    const v = parseFloat(raw) / 1e6;
    return v === 0 ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch { return "—"; }
}

fmtEth("1000000000000000000") === "1.000000"
  ? ok("1 ETH wei → 1.000000")
  : fail("ETH format", fmtEth("1000000000000000000"));

fmtEth("0")  === "—"
  ? ok("0 wei → —")
  : fail("zero ETH", fmtEth("0"));

fmtEth(undefined) === "—"
  ? ok("undefined wei → —")
  : fail("undefined ETH", fmtEth(undefined));

fmtEth("notanumber") === "—"
  ? ok("invalid wei → — (no crash)")
  : fail("invalid wei", fmtEth("notanumber"));

fmtToken("1000000") === "1.00"
  ? ok("1 USDT (1000000 raw) → 1.00")
  : fail("USDT format", fmtToken("1000000"));

fmtToken("500500000") === "500.50"
  ? ok("500.50 USDT → 500.50")
  : fail("USDT 500.50", fmtToken("500500000"));

fmtToken("0")  === "—"
  ? ok("0 token → —")
  : fail("zero token", fmtToken("0"));

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(55));
const status = failed === 0
  ? "\x1b[32mALL " + passed + " TESTS PASSED\x1b[0m"
  : "\x1b[32m" + passed + " passed\x1b[0m  \x1b[31m" + failed + " FAILED\x1b[0m";
console.log("  " + status);
if (failed > 0) process.exit(1);
