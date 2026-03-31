export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: 'client' | 'admin';
  balance: {
    btc: number;
    usdt: number;
    usd: number;
  };
  // The unique index for this user in the HD wallet tree (m/44'/60'/0'/0/index)
  derivationIndex: number;
  // Optional free-form notes/tags for this client
  notes?: string;
}

export interface AppConfig {
  // Master Public Keys (from Trezor/Cold Storage)
  btcMasterXpub: string;
  ethMasterXpub: string; // Used for USDT-ERC20
  trezorConnected: boolean;
}

// --- Mock / Initial Data ---

// No clients by default — the wallet scanner is independent of the client system.
// Clients can be added later via the Admin panel or by re-enabling the client UI.
export const INITIAL_CLIENTS: UserProfile[] = [];

export const INITIAL_CONFIG: AppConfig = {
  // Start with empty XPUBs; user or admin must provide them
  btcMasterXpub: "",
  ethMasterXpub: "",
  trezorConnected: false
};

export type DepositEvent = {
  id: string;
  clientId: number;
  clientName: string;
  asset: "BTC" | "USDT" | "USDC";
  derivationIndex: number;
  address: string;
  createdAt: string;
};

export type GeneratedWallet = {
  id: string;
  asset: "BTC" | "ETH";
  derivationIndex: number;
  address: string;
  createdAt: string;
  txCount?: number;
  balanceWei?: string;      // ETH balance in wei
  balanceSats?: number;     // BTC balance in sats
  usdtBalanceRaw?: string;  // USDT balance raw string (6 decimals)
  usdcBalanceRaw?: string;  // USDC balance raw string (6 decimals)
};
