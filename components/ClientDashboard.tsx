import React, { useMemo } from "react";
import { TrendingUp, Wallet, AlertCircle } from "lucide-react";
import { formatEther } from "ethers";
import { UserProfile, DepositEvent, GeneratedWallet } from "../models";

type SummaryCardProps = {
  label: string;
  value: string;
  unit: string;
  live: boolean;
  color?: "emerald" | "blue" | "slate";
};

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, unit, live, color = "slate" }) => {
  const accent =
    color === "emerald"
      ? "text-emerald-400"
      : color === "blue"
        ? "text-blue-400"
        : "text-white";

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 p-6 rounded-2xl flex flex-col gap-2 relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
        <TrendingUp size={60} />
      </div>
      <div className="flex items-center justify-between z-10">
        <span className="text-slate-400 text-sm font-medium">{label}</span>
        {live ? (
          <span className="text-[10px] text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            Live
          </span>
        ) : (
          <span className="text-[10px] text-slate-600 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
            Not scanned
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold z-10 ${accent}`}>
        {value}
        <span className="text-sm font-normal ml-1.5 text-slate-500">{unit}</span>
      </div>
    </div>
  );
};

type ClientDashboardProps = {
  client: UserProfile | undefined;
  deposits: DepositEvent[];
  wallets: GeneratedWallet[];
};

export const ClientDashboard: React.FC<ClientDashboardProps> = ({ deposits, wallets }) => {
  const ethWallets = useMemo(() => wallets.filter((w) => w.asset === "ETH"), [wallets]);
  const scannedCount = useMemo(
    () => ethWallets.filter((w) => w.balanceWei !== undefined).length,
    [ethWallets]
  );

  const totals = useMemo(() => {
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
  }, [ethWallets]);

  const live = scannedCount > 0;

  // Wallets with non-zero balance for the "active wallets" list
  const activeWallets = useMemo(
    () =>
      ethWallets
        .filter(
          (w) =>
            (w.balanceWei && w.balanceWei !== "0") ||
            (w.usdtBalanceRaw && w.usdtBalanceRaw !== "0") ||
            (w.usdcBalanceRaw && w.usdcBalanceRaw !== "0")
        )
        .sort((a, b) => a.derivationIndex - b.derivationIndex),
    [ethWallets]
  );

  const fmtToken = (raw: string | undefined) => {
    if (!raw || raw === "0") return "—";
    const v = parseFloat(raw) / 1e6;
    return v === 0 ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtEth = (wei: string | undefined) => {
    if (!wei || wei === "0") return "—";
    try {
      const v = parseFloat(formatEther(BigInt(wei)));
      return v === 0 ? "—" : v.toFixed(6);
    } catch { return "—"; }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 relative z-10 animate-fade-in">

      {/* ── Summary Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard
          label="Total ETH"
          value={totals.eth.toFixed(6)}
          unit="ETH"
          live={live}
        />
        <SummaryCard
          label="Total USDT (ERC-20)"
          value={totals.usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          unit="USDT"
          live={live}
          color="emerald"
        />
        <SummaryCard
          label="Total USDC (ERC-20)"
          value={totals.usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          unit="USDC"
          live={live}
          color="blue"
        />
      </div>

      {!live && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
          <AlertCircle size={14} />
          <span>
            No balance data yet. Go to the <strong>Wallets</strong> tab → generate ETH wallets →
            click <strong>Scan balances</strong> to populate totals here.
          </span>
        </div>
      )}

      {live && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <Wallet size={14} />
          <span>
            {scannedCount} of {ethWallets.length} ETH wallets scanned.
            {activeWallets.length > 0 && (
              <> &nbsp;{activeWallets.length} have a non-zero balance.</>
            )}
          </span>
        </div>
      )}

      {/* ── Active wallets (non-zero balance) ─────────────────────────── */}
      {activeWallets.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
            <h3 className="font-semibold text-white">Wallets with Balance</h3>
            <span className="text-[10px] text-slate-500">{activeWallets.length} active</span>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-900 text-xs uppercase font-semibold text-slate-500 sticky top-0">
                <tr>
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Address</th>
                  <th className="px-5 py-3 text-right">ETH</th>
                  <th className="px-5 py-3 text-right">USDT</th>
                  <th className="px-5 py-3 text-right">USDC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {activeWallets.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-900/60 transition-colors">
                    <td className="px-5 py-3 text-xs text-slate-500">{w.derivationIndex}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-200">
                      <a
                        href={`https://etherscan.io/address/${w.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-blue-400 transition-colors"
                      >
                        {w.address.slice(0, 10)}…{w.address.slice(-8)}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-xs text-right text-white tabular-nums">
                      {fmtEth(w.balanceWei)}
                    </td>
                    <td className="px-5 py-3 text-xs text-right text-emerald-400 tabular-nums">
                      {fmtToken(w.usdtBalanceRaw)}
                    </td>
                    <td className="px-5 py-3 text-xs text-right text-blue-400 tabular-nums">
                      {fmtToken(w.usdcBalanceRaw)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Deposit Activity Log ───────────────────────────────────────── */}
      {deposits.length > 0 && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
            <h3 className="font-semibold text-white">Deposit Address Log</h3>
            <span className="text-[10px] text-slate-500">{deposits.length} entries</span>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="bg-slate-900 text-xs uppercase font-semibold text-slate-500 sticky top-0">
                <tr>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Asset</th>
                  <th className="px-6 py-3">Index</th>
                  <th className="px-6 py-3">Address</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {deposits.map((event) => (
                  <tr key={event.id} className="hover:bg-slate-900/60 transition-colors">
                    <td className="px-6 py-3 text-sm">{event.clientName}</td>
                    <td className="px-6 py-3 text-sm">{event.asset}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {event.derivationIndex}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-300">
                      {event.address.slice(0, 12)}…
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-500">
                      {new Date(event.createdAt).toLocaleString()}
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
