import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AlertCircle, LayoutDashboard, Plus, QrCode, Settings, ShieldCheck, Sparkles, User, Wallet } from "lucide-react";
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

const CONFIG_STORAGE_KEY = "cryptovault_config_v1";
const CLIENTS_STORAGE_KEY = "cryptovault_clients_v1";
const DEPOSITS_STORAGE_KEY = "cryptovault_deposits_v1";
const GENERATED_WALLETS_STORAGE_KEY = "cryptovault_generated_wallets_v1";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Overview", icon: LayoutDashboard, hint: "Client balances and activity" },
  { key: "wallets", label: "Wallets", icon: Wallet, hint: "HD derivation + explorer sync" },
  { key: "admin", label: "Admin", icon: Settings, hint: "XPUBs, seed helper, state export" },
];

const readFromStorage = <T,>(key: string, fallback: T, validate?: (value: unknown) => value is T): T => {
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

const usePersistentState = <T,>(key: string, fallback: T, validate?: (value: unknown) => value is T) => {
  const [value, setValue] = useState<T>(() => readFromStorage<T>(key, fallback, validate));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Swallow persistence errors for the POC; nothing mission critical here.
    }
  }, [key, value]);

  return [value, setValue] as const;
};

const StatusPill = ({
  active,
  label,
  tone,
}: {
  active: boolean;
  label: string;
  tone: "blue" | "emerald" | "amber";
}) => {
  const palette =
    tone === "emerald"
      ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
      : tone === "amber"
        ? "text-amber-300 bg-amber-500/10 border-amber-500/20"
        : "text-blue-300 bg-blue-500/10 border-blue-500/20";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${
        active ? palette : "text-slate-400 border-slate-700"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          active
            ? tone === "amber"
              ? "bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]"
              : tone === "emerald"
                ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
                : "bg-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.15)]"
            : "bg-slate-600"
        }`}
      />
      {label}
    </span>
  );
};

const SidebarItem = ({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) => {
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
    (value): value is AppConfig =>
      typeof value === "object" &&
      value !== null &&
      "btcMasterXpub" in (value as Record<string, unknown>) &&
      "ethMasterXpub" in (value as Record<string, unknown>),
  );
  const [clients, setClients] = usePersistentState<UserProfile[]>(
    CLIENTS_STORAGE_KEY,
    INITIAL_CLIENTS,
    Array.isArray,
  );
  const [deposits, setDeposits] = usePersistentState<DepositEvent[]>(DEPOSITS_STORAGE_KEY, [], Array.isArray);
  const [wallets, setWallets] = usePersistentState<GeneratedWallet[]>(
    GENERATED_WALLETS_STORAGE_KEY,
    [],
    Array.isArray,
  );
  const [selectedClientId, setSelectedClientId] = useState<number | null>(INITIAL_CLIENTS[0]?.id ?? null);
  const [showDeposit, setShowDeposit] = useState(false);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId]
  );

  useEffect(() => {
    if (!selectedClient && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClient]);

  const handleRecordDeposit = (params: { client: UserProfile; asset: "BTC" | "USDT" | "USDC"; address: string }) => {
    if (!params.address) return;
    const event: DepositEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId: params.client.id,
      clientName: params.client.name,
      asset: params.asset,
      derivationIndex: params.client.derivationIndex,
      address: params.address,
      createdAt: new Date().toISOString(),
    };
    setDeposits((prev) => [event, ...prev]);
  };

  const handleCreateClient = () => {
    const nextIndex = clients.reduce((max, c) => Math.max(max, c.derivationIndex), -1) + 1;
    const nextNumber = clients.length + 1;
    const id = Date.now();

    const newClient: UserProfile = {
      id,
      name: `Client ${nextNumber}`,
      email: `client${nextNumber}@demo.exchange`,
      role: "client",
      derivationIndex: nextIndex,
      balance: { btc: 0, usdt: 0, usd: 0 },
      notes: "Auto-created from UI",
    };

    setClients((prev) => [...prev, newClient]);
    setSelectedClientId(id);
  };

  const showDepositCta = activeTab !== "admin" && Boolean(selectedClient);

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-10%] top-[-20%] h-[420px] w-[420px] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute right-[-20%] top-[-10%] h-[360px] w-[360px] rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(148,163,184,0.05),transparent_30%)]" />
      </div>

      <div className="relative flex h-screen overflow-hidden">
        <aside className="w-72 border-r border-slate-800/60 bg-slate-950/80 backdrop-blur-xl px-5 py-6 flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <div className="text-sm uppercase tracking-[0.2em] text-slate-500">CryptoVault</div>
              <div className="text-lg font-bold text-white">Exchange POC</div>
            </div>
          </div>

          <div className="space-y-3">
            {navItems.map((item) => (
              <SidebarItem key={item.key} item={item} active={activeTab === item.key} onClick={() => setActiveTab(item.key)} />
            ))}
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">XPUB coverage</div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label="BTC XPUB" tone="amber" active={Boolean(config.btcMasterXpub)} />
              <StatusPill label="ETH XPUB" tone="emerald" active={Boolean(config.ethMasterXpub)} />
              <StatusPill label="Trezor" tone="blue" active={config.trezorConnected} />
            </div>
          </div>

          <div className="mt-auto space-y-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-100">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-200">
              <ShieldCheck size={14} />
              Cold Storage Story
            </div>
            <p className="text-[12px] leading-relaxed text-blue-100/90">
              Per-client deposit addresses are derived client-side from XPUBs. Private keys stay on hardware.
            </p>
            <button
              onClick={handleCreateClient}
              className="inline-flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white"
            >
              <Plus size={14} /> Add demo client
            </button>
          </div>
        </aside>

        <section className="flex-1 flex flex-col overflow-hidden">
          <header className="border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-xl px-8 py-4 flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {activeTab === "admin" ? "Platform administration" : "Client operations"}
              </div>
              <div className="flex items-center gap-2 text-xl font-semibold text-white">
                {activeTab === "dashboard" && "Client overview"}
                {activeTab === "wallets" && "HD Wallets"}
                {activeTab === "admin" && "Security + XPUBs"}
                <span className="text-[11px] font-medium text-slate-500 bg-slate-800/70 px-2 py-0.5 rounded-full">
                  POC only
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {activeTab !== "admin" && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <span className="text-[11px] text-slate-500">Active client</span>
                  <select
                    className="bg-transparent text-sm font-medium text-white outline-none"
                    value={selectedClientId ?? ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      setSelectedClientId(Number.isNaN(id) ? null : id);
                    }}
                  >
                    {clients.map((client) => (
                      <option className="bg-slate-900" key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  {clients.length === 0 && (
                    <span className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertCircle size={12} /> No clients configured
                    </span>
                  )}
                </div>
              )}

              {showDepositCta && (
                <button
                  onClick={() => setShowDeposit(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-95"
                >
                  <QrCode size={16} />
                  Deposit funds
                </button>
              )}

              <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/70 px-3 py-2">
                <div className="flex flex-col text-right">
                  <span className="text-sm font-semibold text-white">
                    {activeTab === "admin" ? "Admin" : selectedClient?.name ?? "No client"}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {activeTab === "admin" ? "System admin" : "Verified client"}
                  </span>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-700">
                  <User size={18} className="text-slate-200" />
                </div>
              </div>
            </div>
          </header>

          <div className="flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-8 py-2 text-[12px] text-amber-100">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle size={14} /> Proof of concept only — never send real funds.
            </div>
            <span className="hidden sm:inline text-amber-200/80">
              Addresses are derived locally from XPUBs; no custody or broadcasts happen here.
            </span>
          </div>

          <main className="relative flex-1 overflow-y-auto p-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.08),transparent_45%)]" />
            <div className="relative">
              {activeTab === "admin" && <AdminPanel config={config} setConfig={setConfig} />}
              {activeTab === "wallets" && (
                <WalletsView config={config} wallets={wallets} setWallets={setWallets} />
              )}
              {activeTab === "dashboard" && <ClientDashboard client={selectedClient ?? undefined} deposits={deposits} wallets={wallets} />}
            </div>
          </main>
        </section>
      </div>

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
