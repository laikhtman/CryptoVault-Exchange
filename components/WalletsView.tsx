import React, { useMemo, useState } from "react";
import { AlertCircle, ArrowRightLeft, ShieldCheck, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { formatEther } from "ethers";
import { AppConfig, GeneratedWallet } from "../models";
import { deriveBtcAddress, deriveUsdtAddress } from "../crypto";

const USDT_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDC_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETH_BATCH_SIZE = 20; // Etherscan balancemulti supports up to 20 addresses

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

    setWallets((prev) => {
      const existingIndices = new Set(
        prev.filter((w) => w.asset === asset).map((w) => w.derivationIndex)
      );
      const fresh = newWallets.filter((w) => !existingIndices.has(w.derivationIndex));
      return [...prev, ...fresh];
    });

    // Functional update avoids stale closure if user clicks Generate rapidly
    const endIndex = startIndex + count - 1;
    setStartIndex((prev) => prev + count);
    setMessage(`Generated ${count} ${asset} wallets (indices ${startIndex}–${endIndex}).`);
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
        const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY as string | undefined;
        if (!apiKey) {
          setMessage(
            "VITE_ETHERSCAN_API_KEY is not set. Create a .env.local file with: VITE_ETHERSCAN_API_KEY=your_key"
          );
          return;
        }

        const total = filteredWallets.length;
        const ethBalances: Record<string, string> = {};

        // ── Phase 1: Batch ETH balances (20 addresses per call) ──────────────
        const batches = Math.ceil(total / ETH_BATCH_SIZE);
        for (let b = 0; b < batches; b++) {
          const slice = filteredWallets.slice(b * ETH_BATCH_SIZE, (b + 1) * ETH_BATCH_SIZE);
          const addrs = slice.map((w) => w.address).join(",");
          setSyncStatus(`Fetching ETH balances — batch ${b + 1}/${batches}`);

          const res = await fetch(
            `https://api.etherscan.io/api?module=account&action=balancemulti&address=${addrs}&tag=latest&apikey=${apiKey}`
          );
          const json = await res.json();
          if (json.status === "1" && Array.isArray(json.result)) {
            for (const item of json.result) {
              ethBalances[item.account.toLowerCase()] = item.balance;
            }
          }
          setSyncProgress(Math.round(((b + 1) / batches) * 25));
          if (b < batches - 1) await delay(250);
        }

        // ── Phase 2: USDT + USDC token balances (concurrent per wallet) ──────
        // Rate: 2 concurrent calls per 450ms ≈ 4.4 calls/sec (under free-tier limit)
        const usdtBalances: Record<string, string> = {};
        const usdcBalances: Record<string, string> = {};

        for (let i = 0; i < total; i++) {
          const w = filteredWallets[i];
          const addr = w.address;
          const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
          setSyncStatus(`Scanning wallet ${i + 1}/${total} (${shortAddr}) — USDT + USDC`);
          setSyncProgress(25 + Math.round((i / total) * 75));

          // Per-wallet try/catch: a single API failure must NOT abort the entire scan
          try {
            const [usdtRes, usdcRes] = await Promise.all([
              fetch(
                `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${USDT_CONTRACT}&address=${addr}&tag=latest&apikey=${apiKey}`
              ),
              fetch(
                `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${USDC_CONTRACT}&address=${addr}&tag=latest&apikey=${apiKey}`
              ),
            ]);

            const [usdtJson, usdcJson] = await Promise.all([usdtRes.json(), usdcRes.json()]);

            usdtBalances[addr.toLowerCase()] =
              usdtJson.status === "1" && usdtJson.result ? usdtJson.result : "0";
            usdcBalances[addr.toLowerCase()] =
              usdcJson.status === "1" && usdcJson.result ? usdcJson.result : "0";
          } catch (walletErr) {
            console.warn(`Token balance fetch failed for ${addr} — defaulting to 0`, walletErr);
            usdtBalances[addr.toLowerCase()] = "0";
            usdcBalances[addr.toLowerCase()] = "0";
          }

          if (i < total - 1) await delay(450);
        }

        setSyncProgress(100);
        setSyncStatus("Done!");

        setWallets((prev) =>
          prev.map((w) => {
            if (w.asset !== "ETH") return w;
            const lower = w.address.toLowerCase();
            return {
              ...w,
              balanceWei: ethBalances[lower] ?? w.balanceWei ?? "0",
              usdtBalanceRaw: usdtBalances[lower] ?? w.usdtBalanceRaw ?? "0",
              usdcBalanceRaw: usdcBalances[lower] ?? w.usdcBalanceRaw ?? "0",
            };
          })
        );

        // Count using the same merge logic as setWallets so we include previously-scanned balances
        const withBalance = filteredWallets.filter((w) => {
          const lower = w.address.toLowerCase();
          const eth = ethBalances[lower] ?? w.balanceWei ?? "0";
          const usdt = usdtBalances[lower] ?? w.usdtBalanceRaw ?? "0";
          const usdc = usdcBalances[lower] ?? w.usdcBalanceRaw ?? "0";
          return eth !== "0" || usdt !== "0" || usdc !== "0";
        });
        setMessage(
          `Synced ${total} wallets. ${withBalance.length} have a non-zero balance.`
        );
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
    const secs = Math.ceil(filteredWallets.length * 0.5);
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
              Derive addresses from your XPUB and scan ETH + USDT + USDC balances via Etherscan.
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
          amounts from Etherscan. Requires <code className="text-slate-400">VITE_ETHERSCAN_API_KEY</code> in{" "}
          <code className="text-slate-400">.env.local</code>.
        </p>
      )}
    </div>
  );
};
