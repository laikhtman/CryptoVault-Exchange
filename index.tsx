import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertCircle, LayoutDashboard, Settings, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { AdminPanel } from "./components/AdminPanel";
import { ClientDashboard } from "./components/ClientDashboard";
import { DepositModal } from "./components/DepositModal";
import { WalletsView } from "./components/WalletsView";
import {
  AppConfig,
  DepositEvent,
  GeneratedWallet,
  INITIAL_CLIENTS,
  INITIAL_CONFIG,
  UserProfile,
} from "./models";

type NavKey = "dashboard" | "wallets" | "admin";

type NavItem = {
  key: NavKey;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  hint: string;
};

const CONFIG_STORAGE_KEY          = "cryptovault_config_v1";
const CLIENTS_STORAGE_KEY         = "cryptovault_clients_v1";
const DEPOSITS_STORAGE_KEY        = "cryptovault_deposits_v1";
const GENERATED_WALLETS_STORAGE_KEY = "cryptovault_generated_wallets_v1";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Overview",  icon: LayoutDashboard, hint: "Aggregate balances across all wallets" },
  { key: "wallets",   label: "Wallets",   icon: Wallet,           hint: "Generate addresses + scan balances" },
  { key: "admin",     label: "Admin",     icon: Settings,         hint: "Trezor, XPUBs, export / import" },
];

const readFromStorage = <T,>(key: string, fallback: T, validate?: (v: unknown) => v is T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
};

const usePersistentState = <T,>(key: string, fallback: T, validate?: (v: unknown) => v is T) => {
  const [value, setValue] = useState<T>(() => readFromStorage<T>(key, fallback, validate));
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /**/ }
  }, [key, value]);
  return [value, setValue] as const;
};

const StatusPill = ({ active, label, tone }: { active: boolean; label: string; tone: "blue" | "emerald" | "amber" }) => {
  const palette =
    tone === "emerald" ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" :
    tone === "amber"   ? "text-amber-300 bg-amber-500/10 border-amber-500/20" :
                         "text-blue-300 bg-blue-500/10 border-blue-500/20";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${active ? palette : "text-slate-400 border-slate-700"}`}>
      <span className={`h-2 w-2 rounded-full ${
        active
          ? tone === "amber"   ? "bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]"
          : tone === "emerald" ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
          :                      "bg-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.15)]"
          : "bg-slate-600"
      }`} />
      {label}
    </span>
  );
};

const SidebarItem = ({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl px-4 py-3 transition-all border ${
        active
          ? "bg-slate-900/80 border-slate-700 text-white shadow-lg shadow-blue-900/20"
          : "bg-slate-900/30 border-slate-800 text-slate-400 hover:text-slate-100 hover:border-slate-700"
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon size={18} className={active ? "text-blue-400" : "text-slate-500"} />
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{item.label}</span>
          <span className="text-[11px] text-slate-500">{item.hint}</span>
        </div>
      </div>
    </button>
  );
};

const App = () => {
  const [activeTab, setActiveTab] = useState<NavKey>("dashboard");

  const [config, setConfig] = usePersistentState<AppConfig>(
    CONFIG_STORAGE_KEY,
    INITIAL_CONFIG,
    (v): v is AppConfig =>
      typeof v === "object" && v !== null &&
      "btcMasterXpub" in (v as Record<string, unknown>) &&
      "ethMasterXpub" in (v as Record<string, unknown>),
  );

  const [wallets, setWallets] = usePersistentState<GeneratedWallet[]>(
    GENERATED_WALLETS_STORAGE_KEY, [], Array.isArray,
  );

  // ── Client system — kept dormant, not rendered in main UI ───────────────
  // Re-enable by adding client selector, deposit button, and DepositModal
  // back to the header/sidebar JSX below.
  const [clients, setClients] = usePersistentState<UserProfile[]>(
    CLIENTS_STORAGE_KEY, INITIAL_CLIENTS, Array.isArray,
  );
  const [deposits, setDeposits] = usePersistentState<DepositEvent[]>(
    DEPOSITS_STORAGE_KEY, [], Array.isArray,
  );
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  useEffect(() => {
    if (!selectedClient && clients.length > 0) setSelectedClientId(clients[0].id);
  }, [clients, selectedClient]);

  const handleRecordDeposit = (params: { client: UserProfile; asset: "BTC" | "USDT" | "USDC"; address: string }) => {
    if (!params.address) return;
    setDeposits((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        clientId: params.client.id,
        clientName: params.client.name,
        asset: params.asset,
        derivationIndex: params.client.derivationIndex,
        address: params.address,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  // Wallet summary for sidebar
  const ethWalletCount  = wallets.filter((w) => w.asset === "ETH").length;
  const scannedCount    = wallets.filter((w) => w.asset === "ETH" && w.balanceWei !== undefined).length;

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      {/* Background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[420px] w-[420px] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute right-[-20%] top-[-10%] h-[360px] w-[360px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(148,163,184,0.05),transparent_30%)]" />
      </div>

      <div className="relative flex h-screen overflow-hidden">

        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <aside className="w-72 border-r border-slate-800/60 bg-slate-950/80 backdrop-blur-xl px-5 py-6 flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <div className="text-sm uppercase tracking-[0.2em] text-slate-500">CryptoVault</div>
              <div className="text-lg font-bold text-white">Wallet Scanner</div>
            </div>
          </div>

          <div className="space-y-3">
            {navItems.map((item) => (
              <SidebarItem key={item.key} item={item} active={activeTab === item.key} onClick={() => setActiveTab(item.key)} />
            ))}
          </div>

          {/* XPUB status */}
          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Key status</div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label="ETH XPUB" tone="emerald" active={Boolean(config.ethMasterXpub)} />
              <StatusPill label="BTC XPUB" tone="amber"   active={Boolean(config.btcMasterXpub)} />
              <StatusPill label="Trezor"   tone="blue"    active={config.trezorConnected} />
            </div>
          </div>

          {/* Wallet count */}
          <div className="mt-auto rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Wallets</div>
            <div className="flex gap-4">
              <div>
                <div className="text-lg font-bold text-white">{ethWalletCount}</div>
                <div className="text-[11px] text-slate-500">Generated</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-400">{scannedCount}</div>
                <div className="text-[11px] text-slate-500">Scanned</div>
              </div>
            </div>
            {ethWalletCount === 0 && (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Connect Trezor in <strong className="text-slate-400">Admin</strong>, then generate wallets in <strong className="text-slate-400">Wallets</strong>.
              </p>
            )}
          </div>
        </aside>

        {/* ── Main content ───────────────────────────────────────────── */}
        <section className="flex-1 flex flex-col overflow-hidden">
          <header className="border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-xl px-8 py-4 flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {activeTab === "admin" ? "Configuration" : "HD Wallet Scanner"}
              </div>
              <div className="flex items-center gap-2 text-xl font-semibold text-white">
                {activeTab === "dashboard" && "Wallet Overview"}
                {activeTab === "wallets"   && "Generate & Scan"}
                {activeTab === "admin"     && "Admin / XPUBs"}
              </div>
            </div>

            {/* Non-custodial badge */}
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2">
              <ShieldCheck size={14} className="text-emerald-500" />
              <span className="text-xs text-slate-400">Non-custodial · Keys never leave your device</span>
            </div>
          </header>

          {/* Safety banner */}
          <div className="flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-8 py-2 text-[12px] text-amber-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle size={14} /> Read-only balance scanner — never send real funds through this UI.
            </div>
            <span className="hidden sm:inline text-amber-200/80">
              Addresses derived locally from XPUBs · No custody · No broadcasts
            </span>
          </div>

          <main className="relative flex-1 overflow-y-auto p-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.08),transparent_45%)]" />
            <div className="relative">
              {activeTab === "admin"     && <AdminPanel config={config} setConfig={setConfig} />}
              {activeTab === "wallets"   && <WalletsView config={config} wallets={wallets} setWallets={setWallets} />}
              {activeTab === "dashboard" && <ClientDashboard wallets={wallets} />}
            </div>
          </main>
        </section>
      </div>

      {/* ── DepositModal — dormant until client system is re-enabled ─── */}
      {selectedClient && (
        <DepositModal
          isOpen={showDeposit}
          onClose={() => setShowDeposit(false)}
          user={selectedClient}
          config={config}
          onRecordDeposit={handleRecordDeposit}
        />
      )}
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
