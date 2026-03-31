import React, { useMemo, useState } from "react";
import { AlertCircle, ArrowRightLeft, ShieldCheck, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { formatEther } from "ethers";
import { AppConfig, GeneratedWallet } from "../models";
import { deriveBtcAddress, deriveUsdtAddress } from "../crypto";

const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDC_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SCAN_BATCH = 20; // wallets per JSON-RPC batch call
const RPC_BATCH_DELAY_MS = 300; // ms between batches (~100 batches/min, well under limits)

// Public Ethereum JSON-RPC endpoints — no API key required
const ETH_RPC_PRIMARY   = "https://ethereum.publicnode.com";
const ETH_RPC_FALLBACK  = "https://1rpc.io/eth";

// ABI-encode balanceOf(address) — selector = keccak256("balanceOf(address)")[0:4]
const encodeBalanceOf = (addr: string): string =>
  "0x70a08231" + addr.slice(2).toLowerCase().padStart(64, "0");

// Convert hex RPC result (or null) to a decimal string
const hexToDecStr = (hex: string | null | undefined): string => {
  if (!hex || hex === "0x" || hex === "0x0") return "0";
  try { return BigInt(hex).toString(); } catch { return "0"; }
};

// Execute a JSON-RPC batch. Falls back to the secondary RPC on network failure.
type RpcReq = { method: string; params: unknown[] };
const batchRpc = async (requests: RpcReq[]): Promise<(string | null)[]> => {
  const body = JSON.stringify(
    requests.map((r, i) => ({ jsonrpc: "2.0", id: i + 1, method: r.method, params: r.params }))
  );
  const headers = { "Content-Type": "application/json" };

  let raw: Response;
  try {
    raw = await fetch(ETH_RPC_PRIMARY, { method: "POST", headers, body });
    if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
  } catch {
    raw = await fetch(ETH_RPC_FALLBACK, { method: "POST", headers, body });
    if (!raw.ok) throw new Error(`RPC fallback HTTP ${raw.status}`);
  }

  const results = await raw.json();
  // Batch responses may arrive out of order — index by id
  const byId: Record<number, string | null> = {};
  for (const r of (Array.isArray(results) ? results : [results])) {
    byId[r.id] = r.result ?? null;
  }
  return requests.map((_, i) => byId[i + 1] ?? null);
};

type WalletsViewProps = {
  config: AppConfig;
  wallets: GeneratedWallet[];
  setWallets: React.Dispatch<React.SetStateAction<GeneratedWallet[]>>;
};

export const WalletsView: React.FC<WalletsViewProps> = ({ config, wallets, setWallets }) => {
  const [asset, setAsset] = useState<"BTC" | "ETH">("ETH");
  const [count, setCount] = useState(10);
  const [startIndex, setStartIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState("");

  const hasBtcXpub = !!config.btcMasterXpub;
  const hasEthXpub = !!config.ethMasterXpub;

  const filteredWallets = useMemo(
    () =>
      wallets
        .filter((w) => w.asset === asset)
        .sort((a, b) => a.derivationIndex - b.derivationIndex),
    [wallets, asset]
  );

  const generateWallets = () => {
    setMessage(null);

    if (count <= 0) {
      setMessage("Number of wallets must be greater than 0.");
      return;
    }
    if (count > 500) {
      setMessage("Limited to 500 wallets per generation batch.");
      return;
    }

    const now = new Date().toISOString();
    const newWallets: GeneratedWallet[] = [];

    for (let i = 0; i < count; i++) {
      const derivationIndex = startIndex + i;
      let address = "";

      if (asset === "BTC") {
        if (!hasBtcXpub) {
          setMessage("BTC XPUB not configured. Set it in Admin first.");
          return;
        }
        address = deriveBtcAddress(config.btcMasterXpub, derivationIndex);
      } else {
        if (!hasEthXpub) {
          setMessage("ETH XPUB not configured. Set it in Admin first.");
          return;
        }
        address = deriveUsdtAddress(config.ethMasterXpub, derivationIndex);
      }

      if (!address || address.startsWith("Error")) {
        setMessage("Address derivation failed. Check your XPUB in Admin.");
        return;
      }

      newWallets.push({
        id: `${asset}-${derivationIndex}-${now}-${Math.random().toString(36).slice(2)}`,
        asset,
        derivationIndex,
        address,
        createdAt: now,
      });
    }

    // Deduplicate using the current snapshot — generation is synchronous so no race possible
    const existingIndices = new Set(
      wallets.filter((w) => w.asset === asset).map((w) => w.derivationIndex)
    );
    const fresh = newWallets.filter((w) => !existingIndices.has(w.derivationIndex));

    if (fresh.length === 0) {
      setMessage(`All ${count} requested indices already exist — no wallets added.`);
      return;
    }

    setWallets((prev) => [...prev, ...fresh]);

    const endIndex = startIndex + fresh.length - 1;
    setStartIndex((prev) => prev + fresh.length);
    setMessage(
      `Generated ${fresh.length} ${asset} wallet${fresh.length !== 1 ? "s" : ""} (indices ${startIndex}–${endIndex}).`
        + (fresh.length < count ? ` ${count - fresh.length} skipped (already exist).` : "")
    );
  };

  const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

  const syncFromExplorers = async () => {
    setMessage(null);
    setSyncProgress(0);
    setSyncStatus("");

    if (filteredWallets.length === 0) {
      setMessage(`No ${asset} wallets to sync. Generate some first.`);
      return;
    }

    setSyncing(true);
    try {
      if (asset === "ETH") {
        const total = filteredWallets.length;
        const numBatches = Math.ceil(total / SCAN_BATCH);
        const ethBalances: Record<string, string>  = {};
        const usdtBalances: Record<string, string> = {};
        const usdcBalances: Record<string, string> = {};

        // One batch request = ETH + USDT + USDC for up to 20 wallets (60 RPC calls bundled)
        for (let b = 0; b < numBatches; b++) {
          const slice = filteredWallets.slice(b * SCAN_BATCH, (b + 1) * SCAN_BATCH);
          const addrs = slice.map((w) => w.address);

          setSyncStatus(`Batch ${b + 1}/${numBatches} — scanning ${addrs.length} wallets`);
          setSyncProgress(Math.round(((b + 1) / numBatches) * 100));

          try {
            // Fire all 60 sub-calls as a single HTTP request
            const [ethRes, usdtRes, usdcRes] = await Promise.all([
              batchRpc(addrs.map((a) => ({ method: "eth_getBalance",  params: [a, "latest"] }))),
              batchRpc(addrs.map((a) => ({ method: "eth_call", params: [{ to: USDT_CONTRACT, data: encodeBalanceOf(a) }, "latest"] }))),
              batchRpc(addrs.map((a) => ({ method: "eth_call", params: [{ to: USDC_CONTRACT, data: encodeBalanceOf(a) }, "latest"] }))),
            ]);

            for (let i = 0; i < addrs.length; i++) {
              const lower = addrs[i].toLowerCase();
              ethBalances[lower]  = hexToDecStr(ethRes[i]);
              usdtBalances[lower] = hexToDecStr(usdtRes[i]);
              usdcBalances[lower] = hexToDecStr(usdcRes[i]);
            }
          } catch (batchErr) {
            console.warn(`Batch ${b + 1} failed — wallets in this batch will show 0`, batchErr);
            for (const a of addrs) {
              const lower = a.toLowerCase();
              ethBalances[lower]  = ethBalances[lower]  ?? "0";
              usdtBalances[lower] = usdtBalances[lower] ?? "0";
              usdcBalances[lower] = usdcBalances[lower] ?? "0";
            }
          }

          if (b < numBatches - 1) await delay(RPC_BATCH_DELAY_MS);
        }

        setSyncProgress(100);
        setSyncStatus("Done!");

        // Only update wallets that were actually in this scan batch.
        // Wallets added by the user DURING the scan are left untouched (balanceWei stays
        // undefined → shown as "—" / not-scanned, rather than incorrectly showing "0").
        const scannedSet = new Set(filteredWallets.map((w) => w.address.toLowerCase()));

        setWallets((prev) =>
          prev.map((w) => {
            if (w.asset !== "ETH") return w;
            const lower = w.address.toLowerCase();
            if (!scannedSet.has(lower)) return w; // not part of this scan — preserve as-is
            return {
              ...w,
              balanceWei:     ethBalances[lower]  ?? "0",
              usdtBalanceRaw: usdtBalances[lower] ?? "0",
              usdcBalanceRaw: usdcBalances[lower] ?? "0",
            };
          })
        );

        const withBalance = filteredWallets.filter((w) => {
          const lower = w.address.toLowerCase();
          return (ethBalances[lower]  ?? w.balanceWei     ?? "0") !== "0"
              || (usdtBalances[lower] ?? w.usdtBalanceRaw ?? "0") !== "0"
              || (usdcBalances[lower] ?? w.usdcBalanceRaw ?? "0") !== "0";
        });
        setMessage(`Synced ${total} wallets. ${withBalance.length} have a non-zero balance.`);
      } else {
        // ── BTC via mempool.space ─────────────────────────────────────────────
        const total = filteredWallets.length;
        const updates: Record<string, { txCount: number; balanceSats: number }> = {};

        for (let i = 0; i < total; i++) {
          const w = filteredWallets[i];
          setSyncStatus(`Scanning BTC wallet ${i + 1}/${total}`);
          setSyncProgress(Math.round((i / total) * 100));

          try {
            const res = await fetch(`https://mempool.space/api/address/${w.address}`);
            const json = await res.json();
            const chain = json?.chain_stats ?? {};
            const funded = typeof chain.funded_txo_sum === "number" ? chain.funded_txo_sum : 0;
            const spent = typeof chain.spent_txo_sum === "number" ? chain.spent_txo_sum : 0;
            updates[w.address] = {
              txCount: chain.tx_count ?? 0,
              balanceSats: funded - spent,
            };
          } catch {
            updates[w.address] = { txCount: 0, balanceSats: 0 };
          }

          if (i < total - 1) await delay(100);
        }

        setSyncProgress(100);
        setSyncStatus("Done!");

        setWallets((prev) =>
          prev.map((w) => {
            if (w.asset !== "BTC") return w;
            const u = updates[w.address];
            if (!u) return w;
            return { ...w, txCount: u.txCount, balanceSats: u.balanceSats };
          })
        );
        setMessage(`Synced ${total} BTC wallets.`);
      }
    } catch (e) {
      console.error(e);
      setMessage("Sync failed. Check your network connection and API key.");
    } finally {
      setSyncing(false);
      setTimeout(() => {
        setSyncProgress(0);
        setSyncStatus("");
      }, 3000);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const fmtEth = (wei: string | undefined): string => {
    if (!wei || wei === "0") return "—";
    try {
      const v = parseFloat(formatEther(BigInt(wei)));
      return v === 0 ? "—" : v.toFixed(6);
    } catch {
      return "—";
    }
  };

  const fmtToken = (raw: string | undefined): string => {
    if (!raw || raw === "0") return "—";
    try {
      const v = parseFloat(raw) / 1e6;
      return v === 0 ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      return "—";
    }
  };

  const fmtBtc = (sats: number | undefined): string => {
    if (typeof sats !== "number" || sats === 0) return "—";
    return (sats / 1e8).toFixed(8);
  };

  // ── Aggregate totals (ETH view) ───────────────────────────────────────────
  const totals = useMemo(() => {
    const ethWallets = wallets.filter((w) => w.asset === "ETH");
    let ethWei = 0n;
    let usdtRaw = 0n;
    let usdcRaw = 0n;
    for (const w of ethWallets) {
      try { if (w.balanceWei && w.balanceWei !== "0") ethWei += BigInt(w.balanceWei); } catch { /* */ }
      try { if (w.usdtBalanceRaw && w.usdtBalanceRaw !== "0") usdtRaw += BigInt(w.usdtBalanceRaw); } catch { /* */ }
      try { if (w.usdcBalanceRaw && w.usdcBalanceRaw !== "0") usdcRaw += BigInt(w.usdcBalanceRaw); } catch { /* */ }
    }
    return {
      eth: parseFloat(formatEther(ethWei)),
      usdt: Number(usdtRaw) / 1e6,
      usdc: Number(usdcRaw) / 1e6,
    };
  }, [wallets]);

  const ethWalletCount = wallets.filter((w) => w.asset === "ETH").length;
  const synced = filteredWallets.filter((w) => w.balanceWei !== undefined || w.balanceSats !== undefined);

  const estimatedMinutes = useMemo(() => {
    if (asset !== "ETH") return null;
    // Batch of 20 wallets per RPC call + 300ms delay → ~(batches * 0.8)s
    const batches = Math.ceil(filteredWallets.length / SCAN_BATCH);
    const secs = Math.ceil(batches * 0.8) + 3; // +3s for network latency
    if (secs < 60) return `~${secs}s`;
    return `~${Math.ceil(secs / 60)} min`;
  }, [asset, filteredWallets.length]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 relative z-10 animate-fade-in">
      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <ArrowRightLeft size={18} className="text-blue-400" />
              HD Wallet Generator & Scanner
            </h2>
            <p className="text-xs text-slate-500">
              Derive addresses from your XPUB and scan ETH + USDT + USDC balances via Ethereum JSON-RPC. No API key required.
            </p>
          </div>

          {/* Aggregate totals */}
          {asset === "ETH" && ethWalletCount > 0 && (
            <div className="flex gap-5 text-right flex-shrink-0">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total ETH</div>
                <div className="text-sm font-bold text-white">{totals.eth.toFixed(6)}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total USDT</div>
                <div className="text-sm font-bold text-emerald-400">
                  {totals.usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Total USDC</div>
                <div className="text-sm font-bold text-blue-400">
                  {totals.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Wallets</div>
                <div className="text-sm font-bold text-slate-300">
                  {ethWalletCount} ({synced.length} scanned)
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Blockchain</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAsset("BTC")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  asset === "BTC"
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600"
                }`}
              >
                Bitcoin
              </button>
              <button
                type="button"
                onClick={() => setAsset("ETH")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  asset === "ETH"
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : "bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600"
                }`}
              >
                Ethereum
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Number of wallets (max 500)
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(500, parseInt(e.target.value || "1", 10))))}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 px-3 py-1.5 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Starting index
            </label>
            <input
              type="number"
              min={0}
              value={startIndex}
              onChange={(e) => setStartIndex(Math.max(0, parseInt(e.target.value || "0", 10)))}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 px-3 py-1.5 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={generateWallets}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            Generate wallets
          </button>

          <button
            type="button"
            onClick={syncFromExplorers}
            disabled={syncing || filteredWallets.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-emerald-500 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors"
          >
            {syncing ? <RefreshCw size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
            Scan balances
            {!syncing && filteredWallets.length > 0 && asset === "ETH" && (
              <span className="text-slate-500">(est. {estimatedMinutes})</span>
            )}
          </button>

          {filteredWallets.length > 0 && !syncing && (
            <button
              type="button"
              onClick={() => {
                setWallets((prev) => prev.filter((w) => w.asset !== asset));
                setMessage(`Cleared all ${asset} wallets.`);
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={12} />
              Clear {asset}
            </button>
          )}
        </div>

        {/* Progress bar */}
        {syncing && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>{syncStatus}</span>
              <span>{syncProgress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5">
              <div
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${syncProgress}%` }}
              />
            </div>
          </div>
        )}

        {message && (
          <div className="flex items-center gap-2 text-[11px] text-slate-300 bg-slate-800/50 rounded-lg px-3 py-2">
            <AlertCircle size={12} className="text-amber-400 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}
      </div>

      {/* ── Wallet Table ─────────────────────────────────────────────────── */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
          <h3 className="font-semibold text-white">
            Generated {asset} Wallets
          </h3>
          <span className="text-[11px] text-slate-500">
            {filteredWallets.length} total &nbsp;·&nbsp; {synced.length} scanned
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-900/95 text-xs uppercase font-semibold text-slate-500 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 w-16">#</th>
                  <th className="px-4 py-3">Address</th>
                  {asset === "ETH" && (
                    <>
                      <th className="px-4 py-3 text-right">ETH</th>
                      <th className="px-4 py-3 text-right">USDT</th>
                      <th className="px-4 py-3 text-right">USDC</th>
                    </>
                  )}
                  {asset === "BTC" && (
                    <>
                      <th className="px-4 py-3 text-right">Txs</th>
                      <th className="px-4 py-3 text-right">BTC</th>
                    </>
                  )}
                  <th className="px-4 py-3 text-right w-24">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredWallets.map((w) => {
                  const hasBalance =
                    w.asset === "ETH"
                      ? (w.balanceWei && w.balanceWei !== "0") ||
                        (w.usdtBalanceRaw && w.usdtBalanceRaw !== "0") ||
                        (w.usdcBalanceRaw && w.usdcBalanceRaw !== "0")
                      : w.balanceSats && w.balanceSats > 0;

                  return (
                    <tr
                      key={w.id}
                      className={`transition-colors ${
                        hasBalance
                          ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="px-4 py-2 text-xs text-slate-500">{w.derivationIndex}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <span>{w.address}</span>
                          <a
                            href={
                              w.asset === "ETH"
                                ? `https://etherscan.io/address/${w.address}`
                                : `https://mempool.space/address/${w.address}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-600 hover:text-blue-400 transition-colors flex-shrink-0"
                            title="View on explorer"
                          >
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      </td>
                      {w.asset === "ETH" && (
                        <>
                          <td className={`px-4 py-2 text-xs text-right tabular-nums ${w.balanceWei && w.balanceWei !== "0" ? "text-white font-medium" : "text-slate-600"}`}>
                            {fmtEth(w.balanceWei)}
                          </td>
                          <td className={`px-4 py-2 text-xs text-right tabular-nums ${w.usdtBalanceRaw && w.usdtBalanceRaw !== "0" ? "text-emerald-400 font-medium" : "text-slate-600"}`}>
                            {fmtToken(w.usdtBalanceRaw)}
                          </td>
                          <td className={`px-4 py-2 text-xs text-right tabular-nums ${w.usdcBalanceRaw && w.usdcBalanceRaw !== "0" ? "text-blue-400 font-medium" : "text-slate-600"}`}>
                            {fmtToken(w.usdcBalanceRaw)}
                          </td>
                        </>
                      )}
                      {w.asset === "BTC" && (
                        <>
                          <td className="px-4 py-2 text-xs text-right text-slate-400">
                            {w.txCount ?? "—"}
                          </td>
                          <td className={`px-4 py-2 text-xs text-right tabular-nums ${w.balanceSats ? "text-orange-400 font-medium" : "text-slate-600"}`}>
                            {fmtBtc(w.balanceSats)}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-2 text-xs text-right text-slate-600">
                        {new Date(w.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}

                {filteredWallets.length === 0 && (
                  <tr>
                    <td className="px-6 py-6 text-xs text-slate-500" colSpan={7}>
                      No {asset} wallets yet. Configure your{" "}
                      {asset === "ETH" ? "ETH" : "BTC"} XPUB in Admin (or connect Trezor), then
                      generate wallets above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {asset === "ETH" && filteredWallets.length > 0 && synced.length === 0 && (
        <p className="text-[11px] text-slate-500 text-center">
          Click <strong className="text-slate-300">Scan balances</strong> to fetch ETH, USDT, and USDC
          amounts directly from the Ethereum network. No API key or configuration needed.
        </p>
      )}
    </div>
  );
};
