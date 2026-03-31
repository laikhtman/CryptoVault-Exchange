import React, { useState } from "react";
import { ShieldCheck, Settings, RefreshCw, CheckCircle2, Download, Upload, AlertCircle } from "lucide-react";
import { Mnemonic, HDNodeWallet } from "ethers";
import trezorLogo from "../trezor.svg";
import { AppConfig, INITIAL_CONFIG } from "../models";
import * as _TrezorConnectModule from "@trezor/connect-web";
const TrezorConnect = (_TrezorConnectModule as any).default ?? _TrezorConnectModule;

type AdminPanelProps = {
  config: AppConfig;
  setConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
};

let trezorInitialized = false;

const initTrezor = async () => {
  if (trezorInitialized) return;
  await TrezorConnect.init({
    lazyLoad: true,
    manifest: {
      appName: "CryptoVault",
      email: "cryptovault@localhost.com",
      appUrl: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
    },
  });
  trezorInitialized = true;
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ config, setConfig }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [trezorError, setTrezorError] = useState<string | null>(null);
  const [btcError, setBtcError] = useState<string | null>(null);
  const [ethError, setEthError] = useState<string | null>(null);
  // Local input state: what the user is typing — decoupled from persisted config.
  // config.ethMasterXpub / config.btcMasterXpub only get updated when the value is valid.
  const [btcXpubInput, setBtcXpubInput] = useState(config.btcMasterXpub);
  const [ethXpubInput, setEthXpubInput] = useState(config.ethMasterXpub);
  const [stateJson, setStateJson] = useState("");
  const [stateMessage, setStateMessage] = useState<string | null>(null);
  const [seedPhrase, setSeedPhrase] = useState("");
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const CONFIG_STORAGE_KEY = "cryptovault_config_v1";
  const CLIENTS_STORAGE_KEY = "cryptovault_clients_v1";
  const DEPOSITS_STORAGE_KEY = "cryptovault_deposits_v1";

  // Valid base58 alphabet excludes 0, O, I, l
  const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

  const validateBtcXpub = (xpub: string): string | null => {
    if (!xpub.trim()) return null; // empty is fine (optional)
    if (!xpub.startsWith("xpub") && !xpub.startsWith("zpub"))
      return 'BTC extended key must start with "xpub" or "zpub" (mainnet)';
    if (xpub.length < 100 || xpub.length > 120) return "XPUB length looks unusual; please double-check";
    if (!BASE58_RE.test(xpub)) return "XPUB contains invalid characters (not valid base58)";
    return null;
  };

  const validateEthXpub = (xpub: string): string | null => {
    if (!xpub.trim()) return null;
    // ETH xpub must be xpub format — zpub is BTC-only and will silently fail derivation
    if (!xpub.startsWith("xpub"))
      return 'ETH extended key must start with "xpub". Got a zpub? Use the BTC field instead.';
    if (xpub.length < 100 || xpub.length > 120) return "XPUB length looks unusual; please double-check";
    if (!BASE58_RE.test(xpub)) return "XPUB contains invalid characters (not valid base58)";
    return null;
  };

  const handleBtcXpubChange = (next: string) => {
    setBtcXpubInput(next);
    const err = validateBtcXpub(next);
    setBtcError(err);
    // Only persist to config when valid or explicitly cleared — never store a known-bad key
    if (!err) setConfig((prev) => ({ ...prev, btcMasterXpub: next }));
    else if (!next.trim()) setConfig((prev) => ({ ...prev, btcMasterXpub: "" }));
  };

  const handleEthXpubChange = (next: string) => {
    setEthXpubInput(next);
    const err = validateEthXpub(next);
    setEthError(err);
    if (!err) setConfig((prev) => ({ ...prev, ethMasterXpub: next }));
    else if (!next.trim()) setConfig((prev) => ({ ...prev, ethMasterXpub: "" }));
  };

  const handleResetConfig = () => {
    setConfig({ ...INITIAL_CONFIG });
    setBtcXpubInput("");
    setEthXpubInput("");
    setBtcError(null);
    setEthError(null);
    setTrezorError(null);
    try { TrezorConnect.dispose(); } catch { /* ignore if not initialized */ }
    trezorInitialized = false;
    setSuccessMsg("Configuration reset.");
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  const handleConnectTrezor = async () => {
    setIsConnecting(true);
    setTrezorError(null);
    setSuccessMsg("");

    try {
      await initTrezor();

      // Get ETH account-level XPUB (m/44'/60'/0')
      const ethResult = await TrezorConnect.getPublicKey({
        path: "m/44'/60'/0'",
        coin: "eth",
      });

      if (!ethResult.success) {
        throw new Error(
          (ethResult.payload as { error: string }).error ||
            "Failed to get ETH public key from Trezor"
        );
      }

      // Validate the ETH xpub before using it
      const ethXpub = ethResult.payload.xpub;
      if (!ethXpub || typeof ethXpub !== "string" || !ethXpub.startsWith("xpub")) {
        throw new Error(
          `Trezor returned an unexpected ETH key format: "${String(ethXpub).slice(0, 12)}...". Expected xpub.`
        );
      }

      // Try to also get BTC account XPUB (m/84'/0'/0' — native segwit)
      let btcXpub = config.btcMasterXpub;
      let btcImported = false;
      try {
        const btcResult = await TrezorConnect.getPublicKey({
          path: "m/84'/0'/0'",
          coin: "btc",
        });
        if (btcResult.success) {
          // Prefer xpubSegwit (zpub format) when available; fall back to xpub
          const candidate = (btcResult.payload as any).xpubSegwit ?? btcResult.payload.xpub;
          if (candidate && typeof candidate === "string") {
            btcXpub = candidate;
            btcImported = true;
          }
        } else {
          console.warn("BTC xpub import failed (non-fatal):", (btcResult.payload as any).error);
        }
      } catch (e) {
        console.warn("BTC xpub import threw (non-fatal):", e);
      }

      setConfig((prev) => ({
        ...prev,
        trezorConnected: true,
        ethMasterXpub: ethXpub,
        btcMasterXpub: btcXpub,
      }));
      // Sync local input state so the inputs reflect the imported keys
      setEthXpubInput(ethXpub);
      if (btcImported) setBtcXpubInput(btcXpub);

      const imported = btcImported
        ? "ETH + BTC Master Public Keys imported."
        : "ETH Master Public Key imported. (BTC import skipped — you can paste a zpub manually.)";

      setSuccessMsg(`Trezor connected! ${imported}`);
      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : "Failed to connect to Trezor. Make sure the device is plugged in and unlocked.";
      setTrezorError(msg);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDeriveFromSeed = () => {
    try {
      const phrase = seedPhrase.trim();
      if (!phrase) {
        setSeedMessage("Enter a BIP39 seed phrase to derive XPUBs (test phrases only).");
        return;
      }
      const words = phrase.split(/\s+/);
      if (words.length < 12 || words.length > 24) {
        setSeedMessage("Seed phrase should be 12–24 words.");
        return;
      }

      const mnemonic = Mnemonic.fromPhrase(phrase);
      const root = HDNodeWallet.fromSeed(mnemonic.computeSeed());

      const btcAccount = root.derivePath("m/84'/0'/0'");
      const btcXpub = btcAccount.neuter().extendedKey;

      const ethAccount = root.derivePath("m/44'/60'/0'");
      const ethXpub = ethAccount.neuter().extendedKey;

      setConfig((prev) => ({ ...prev, btcMasterXpub: btcXpub, ethMasterXpub: ethXpub }));
      setBtcXpubInput(btcXpub);
      setEthXpubInput(ethXpub);
      setSeedPhrase("");
      setSeedMessage("XPUBs derived from seed phrase in-memory only. Seed was not persisted.");
      setBtcError(null);
      setEthError(null);
    } catch (e) {
      console.error(e);
      setSeedMessage("Could not parse seed phrase. Please check it and try again.");
    }
  };

  const handleExportState = () => {
    try {
      const payload = {
        config: JSON.parse(window.localStorage.getItem(CONFIG_STORAGE_KEY) || "{}"),
        clients: JSON.parse(window.localStorage.getItem(CLIENTS_STORAGE_KEY) || "[]"),
        deposits: JSON.parse(window.localStorage.getItem(DEPOSITS_STORAGE_KEY) || "[]"),
      };
      setStateJson(JSON.stringify(payload, null, 2));
      setStateMessage("State exported. Copy the JSON below for backup.");
    } catch {
      setStateMessage("Failed to export state.");
    }
  };

  const handleImportState = () => {
    try {
      if (!stateJson.trim()) {
        setStateMessage("Paste a JSON payload before importing.");
        return;
      }
      const parsed = JSON.parse(stateJson);
      if (parsed.config) window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(parsed.config));
      if (parsed.clients) window.localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(parsed.clients));
      if (parsed.deposits) window.localStorage.setItem(DEPOSITS_STORAGE_KEY, JSON.stringify(parsed.deposits));
      setStateMessage("State imported. Reload the page to apply changes.");
    } catch (e) {
      console.error(e);
      setStateMessage("Invalid JSON. Please check the payload.");
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Wallet Management System</h2>
        <p className="text-slate-400">Configure XPUB keys and connect your Trezor hardware wallet.</p>

        <div className="mt-4 bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-2">
          <h3 className="text-xs font-semibold tracking-wider text-slate-400 uppercase">Security Model</h3>
          <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
            <li>
              XPUB-only: stores <strong>only</strong> master public keys in localStorage; private keys
              never leave your Trezor.
            </li>
            <li>Address derivation is fully client-side — no server or third-party custody.</li>
            <li>
              Balance scanning uses Etherscan (ETH/USDT/USDC) and mempool.space (BTC) — read-only.
            </li>
          </ul>
        </div>
      </div>

      {successMsg && (
        <div className="mb-6 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-xl flex items-center gap-3">
          <CheckCircle2 size={20} />
          {successMsg}
        </div>
      )}

      <div className="grid gap-6">
        {/* ── Trezor + XPUB Section ─────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <ShieldCheck size={120} className="text-blue-500" />
          </div>

          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <img src={trezorLogo} alt="Trezor" className="h-6 opacity-80" />
                Hardware Wallet Integration
              </h3>
              <p className="text-sm text-slate-400 mt-1 max-w-lg">
                Connect your Trezor to automatically import the account-level XPUB for ETH
                (<code className="text-slate-300">m/44'/60'/0'</code>) and BTC
                (<code className="text-slate-300">m/84'/0'/0'</code>). A browser popup will open — confirm on
                your device.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <button
                onClick={handleConnectTrezor}
                disabled={config.trezorConnected || isConnecting}
                className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${
                  config.trezorConnected
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 cursor-default"
                    : "bg-white text-slate-900 hover:bg-slate-200 shadow-lg shadow-white/10"
                }`}
              >
                {isConnecting ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : config.trezorConnected ? (
                  <ShieldCheck size={16} />
                ) : (
                  <Settings size={16} />
                )}
                {isConnecting
                  ? "Waiting for Trezor..."
                  : config.trezorConnected
                    ? "Trezor Active"
                    : "Connect Trezor"}
              </button>
              <button
                type="button"
                onClick={handleResetConfig}
                className="text-xs text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
              >
                Reset XPUB configuration
              </button>
            </div>
          </div>

          {trezorError && (
            <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{trezorError}</span>
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-1 block">
                Bitcoin Master XPUB / ZPUB (Native SegWit — m/84'/0'/0')
              </label>
              <input
                type="text"
                value={btcXpubInput}
                onChange={(e) => handleBtcXpubChange(e.target.value)}
                placeholder="Paste your BTC xpub or zpub..."
                className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg block w-full p-2.5 font-mono focus:outline-none focus:border-orange-500"
              />
              {btcError && <p className="text-xs text-red-400 mt-1">{btcError}</p>}
              {!btcError && config.btcMasterXpub && (
                <p className="text-[10px] text-emerald-500 mt-1">BTC XPUB configured.</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs uppercase tracking-wider text-slate-500 font-bold block">
                  Ethereum Master XPUB (ETH / USDT / USDC — m/44'/60'/0')
                </label>
                <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                  Required for ETH scanning
                </span>
              </div>
              <input
                type="text"
                value={ethXpubInput}
                onChange={(e) => handleEthXpubChange(e.target.value)}
                placeholder="Paste your ETH xpub..."
                className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg block w-full p-2.5 font-mono border-l-4 border-l-emerald-500 focus:outline-none focus:border-emerald-400"
              />
              {ethError && <p className="text-xs text-red-400 mt-1">{ethError}</p>}
              {!ethError && config.ethMasterXpub && (
                <p className="text-[10px] text-emerald-500 mt-1">ETH XPUB configured — ready to generate and scan wallets.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Seed Phrase Helper ─────────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-white">Seed Phrase Helper (offline test only)</h3>
          <p className="text-xs text-amber-400">
            Never enter a real production seed here. Use only for offline test phrases. The phrase is
            used in-memory to derive XPUBs and is never persisted.
          </p>
          <textarea
            value={seedPhrase}
            onChange={(e) => setSeedPhrase(e.target.value)}
            rows={3}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono p-2 resize-y focus:outline-none focus:border-slate-500"
            placeholder="word1 word2 word3 ... (12 or 24 words, test phrases only)"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleDeriveFromSeed}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white hover:bg-emerald-500"
            >
              Derive BTC &amp; ETH XPUBs
            </button>
            {seedMessage && <p className="text-[11px] text-slate-400 text-right">{seedMessage}</p>}
          </div>
        </div>

        {/* ── State Export / Import ──────────────────────────────────────── */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-white">State Export / Import</h3>
              <p className="text-xs text-slate-500">
                Backup or restore XPUB configuration, clients, and deposit activity as JSON.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExportState}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-600"
              >
                <Download size={14} />
                Export
              </button>
              <button
                type="button"
                onClick={handleImportState}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-600"
              >
                <Upload size={14} />
                Import
              </button>
            </div>
          </div>
          <textarea
            value={stateJson}
            onChange={(e) => setStateJson(e.target.value)}
            rows={6}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono p-2 resize-y focus:outline-none focus:border-slate-500"
            placeholder='Click "Export" to populate, or paste JSON here and click "Import".'
          />
          {stateMessage && <p className="text-[11px] text-slate-400">{stateMessage}</p>}
        </div>
      </div>
    </div>
  );
};
