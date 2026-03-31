import React, { useMemo } from "react";
import { TrendingUp, Wallet, ExternalLink, AlertCircle } from "lucide-react";
import { formatEther } from "ethers";
import { GeneratedWallet } from "../models";

type SummaryCardProps = {
  label: string;
  value: string;
  unit: string;
  scanned: boolean;
  color?: "default" | "emerald" | "blue";
};

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, unit, scanned, color = "default" }) => {
  const valueColor =
    color === "emerald" ? "text-emerald-400" :
    color === "blue"    ? "text-blue-400"    :
                          "text-white";

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 p-6 rounded-2xl flex flex-col gap-2 relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <TrendingUp size={60} />
      </div>
      <div className="flex items-center justify-between z-10">
        <span className="text-slate-400 text-sm font-medium">{label}</span>
        {scanned ? (
          <span className="text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            Live
          </span>
        ) : (
          <span className="text-[10px] text-slate-600 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
            Not scanned
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold tabular-nums z-10 ${valueColor}`}>
        {value}
        <span className="text-sm font-normal ml-1.5 text-slate-500">{unit}</span>
      </div>
    </div>
  );
};

type OverviewDashboardProps = {
  wallets: GeneratedWallet[];
};

export const ClientDashboard: React.FC<OverviewDashboardProps> = ({ wallets }) => {
  const ethWallets = useMemo(() => wallets.filter((w) => w.asset === "ETH"), [wallets]);

  const scannedCount = useMemo(
    () => ethWallets.filter((w) => w.balanceWei !== undefined).length,
    [ethWallets]
  );
  const hasScanned = scannedCount > 0;

  const totals = useMemo(() => {
    let ethWei = 0n, usdtRaw = 0n, usdcRaw = 0n;
    for (const w of ethWallets) {
      try { if (w.balanceWei     && w.balanceWei     !== "0") ethWei  += BigInt(w.balanceWei);     } catch { /**/ }
      try { if (w.usdtBalanceRaw && w.usdtBalanceRaw !== "0") usdtRaw += BigInt(w.usdtBalanceRaw); } catch { /**/ }
      try { if (w.usdcBalanceRaw && w.usdcBalanceRaw !== "0") usdcRaw += BigInt(w.usdcBalanceRaw); } catch { /**/ }
    }
    return {
      eth:  parseFloat(formatEther(ethWei)),
      usdt: Number(usdtRaw) / 1e6,
      usdc: Number(usdcRaw) / 1e6,
    };
  }, [ethWallets]);

  // Wallets with at least one non-zero balance
  const activeWallets = useMemo(
    () =>
      ethWallets
        .filter((w) =>
          (w.balanceWei     && w.balanceWei     !== "0") ||
          (w.usdtBalanceRaw && w.usdtBalanceRaw !== "0") ||
          (w.usdcBalanceRaw && w.usdcBalanceRaw !== "0")
        )
        .sort((a, b) => a.derivationIndex - b.derivationIndex),
    [ethWallets]
  );

  const fmtEth = (wei?: string) => {
    if (!wei || wei === "0") return "—";
    try { const v = parseFloat(formatEther(BigInt(wei))); return v === 0 ? "—" : v.toFixed(6); }
    catch { return "—"; }
  };

  const fmtToken = (raw?: string) => {
    if (!raw || raw === "0") return "—";
    try {
      const v = parseFloat(raw) / 1e6;
      return v === 0 ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch { return "—"; }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 relative z-10 animate-fade-in">

      {/* ── Aggregate balance cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard
          label="Total ETH"
          value={totals.eth.toFixed(6)}
          unit="ETH"
          scanned={hasScanned}
        />
        <SummaryCard
          label="Total USDT (ERC-20)"
          value={totals.usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          unit="USDT"
          scanned={hasScanned}
          color="emerald"
        />
        <SummaryCard
          label="Total USDC (ERC-20)"
          value={totals.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          unit="USDC"
          scanned={hasScanned}
          color="blue"
        />
      </div>

      {/* ── State banners ─────────────────────────────────────────────── */}
      {ethWallets.length === 0 && (
        <div className="flex items-center gap-3 text-sm text-slate-400 bg-slate-900/50 border border-slate-800 rounded-xl px-5 py-4">
          <AlertCircle size={16} className="text-slate-500 flex-shrink-0" />
          <span>
            No Ethereum wallets generated yet. Go to{" "}
            <strong className="text-slate-200">Admin</strong> to connect your Trezor or paste an XPUB,
            then open <strong className="text-slate-200">Wallets</strong> to generate and scan addresses.
          </span>
        </div>
      )}

      {ethWallets.length > 0 && !hasScanned && (
        <div className="flex items-center gap-3 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-5 py-4">
          <AlertCircle size={16} className="flex-shrink-0" />
          <span>
            {ethWallets.length} wallet{ethWallets.length !== 1 ? "s" : ""} generated but not yet scanned.
            Open the <strong>Wallets</strong> tab and click <strong>Scan balances</strong>.
          </span>
        </div>
      )}

      {hasScanned && (
        <div className="flex items-center gap-3 text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-4">
          <Wallet size={16} className="flex-shrink-0" />
          <span>
            {scannedCount} of {ethWallets.length} ETH wallet{ethWallets.length !== 1 ? "s" : ""} scanned.
            {activeWallets.length > 0
              ? ` ${activeWallets.length} have a non-zero balance.`
              : " All wallets are empty."}
          </span>
        </div>
      )}

      {/* ── Wallets with balance ──────────────────────────────────────── */}
      {activeWallets.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
            <h3 className="font-semibold text-white">Wallets with Balance</h3>
            <span className="text-[11px] text-slate-500">{activeWallets.length} active</span>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900/95 text-xs uppercase font-semibold text-slate-500 sticky top-0">
                <tr>
                  <th className="px-5 py-3 w-14">#</th>
                  <th className="px-5 py-3">Address</th>
                  <th className="px-5 py-3 text-right">ETH</th>
                  <th className="px-5 py-3 text-right">USDT</th>
                  <th className="px-5 py-3 text-right">USDC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeWallets.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 text-xs text-slate-500">{w.derivationIndex}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <span>{w.address.slice(0, 10)}…{w.address.slice(-8)}</span>
                        <a
                          href={`https://etherscan.io/address/${w.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-600 hover:text-blue-400 transition-colors"
                        >
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </td>
                    <td className={`px-5 py-3 text-xs text-right tabular-nums ${w.balanceWei && w.balanceWei !== "0" ? "text-white font-medium" : "text-slate-600"}`}>
                      {fmtEth(w.balanceWei)}
                    </td>
                    <td className={`px-5 py-3 text-xs text-right tabular-nums ${w.usdtBalanceRaw && w.usdtBalanceRaw !== "0" ? "text-emerald-400 font-medium" : "text-slate-600"}`}>
                      {fmtToken(w.usdtBalanceRaw)}
                    </td>
                    <td className={`px-5 py-3 text-xs text-right tabular-nums ${w.usdcBalanceRaw && w.usdcBalanceRaw !== "0" ? "text-blue-400 font-medium" : "text-slate-600"}`}>
                      {fmtToken(w.usdcBalanceRaw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
