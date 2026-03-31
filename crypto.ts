import { ethers } from "ethers";
import { p2wpkh } from "@scure/btc-signer";

// --- Base58 helpers for zpub/xpub normalization ---

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const base58Decode = (input: string): Uint8Array => {
  let num = 0n;
  for (const char of input) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base58 character '${char}'`);
    }
    num = num * 58n + BigInt(index);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.push(Number(num & 0xffn));
    num >>= 8n;
  }
  bytes.reverse();

  let leadingZeroCount = 0;
  for (const char of input) {
    if (char === "1") {
      leadingZeroCount += 1;
    } else {
      break;
    }
  }

  return new Uint8Array([...new Array(leadingZeroCount).fill(0), ...bytes]);
};

const base58Encode = (bytes: Uint8Array): string => {
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }

  let encoded = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    num /= 58n;
    encoded = BASE58_ALPHABET[rem] + encoded;
  }

  for (const b of bytes) {
    if (b === 0) {
      encoded = "1" + encoded;
    } else {
      break;
    }
  }

  return encoded || "1";
};

// zpub mainnet p2wpkh version bytes: 0x04b24746
const ZPUB_MAINNET_VERSION = new Uint8Array([0x04, 0xb2, 0x47, 0x46]);
// xpub mainnet version bytes: 0x0488b21e
const XPUB_MAINNET_VERSION = new Uint8Array([0x04, 0x88, 0xb2, 0x1e]);

/**
 * Converts a zpub (native segwit / BIP84) to xpub by swapping version bytes
 * and recalculating the base58check checksum.
 *
 * BIP32 serialization (82 bytes total after base58check decode):
 *   4 bytes version | 1 depth | 4 fingerprint | 4 child# | 32 chain code | 33 key | 4 checksum
 * The checksum = SHA256(SHA256(first-78-bytes))[0:4], so it MUST be recalculated
 * whenever the version bytes change.
 */
export const normalizeBtcExtendedKey = (key: string): string => {
  if (key.startsWith("xpub")) return key;

  if (key.startsWith("zpub")) {
    try {
      // base58check-encoded key is 82 bytes: 78-byte payload + 4-byte checksum
      const decoded = base58Decode(key);
      if (decoded.length !== 82) throw new Error(`Unexpected key length: ${decoded.length}`);

      // payload = first 78 bytes; last 4 are the old base58check checksum
      const payload = decoded.slice(0, 78);

      const isZpub =
        payload[0] === ZPUB_MAINNET_VERSION[0] &&
        payload[1] === ZPUB_MAINNET_VERSION[1] &&
        payload[2] === ZPUB_MAINNET_VERSION[2] &&
        payload[3] === ZPUB_MAINNET_VERSION[3];

      if (!isZpub) return key;

      // Swap the 4-byte version prefix
      const newPayload = new Uint8Array(78);
      newPayload.set(XPUB_MAINNET_VERSION, 0);
      newPayload.set(payload.slice(4), 4);

      // Recalculate checksum: HASH256(payload) = SHA256(SHA256(payload)), take first 4 bytes
      const hash1 = ethers.getBytes(ethers.sha256(newPayload));
      const hash2 = ethers.getBytes(ethers.sha256(hash1));
      const checksum = hash2.slice(0, 4);

      const withChecksum = new Uint8Array(82);
      withChecksum.set(newPayload, 0);
      withChecksum.set(checksum, 78);

      return base58Encode(withChecksum);
    } catch (e) {
      console.error("Failed to normalize zpub to xpub:", e);
      return key;
    }
  }

  return key;
};

/**
 * Derives an ETH address (for ETH/USDT/USDC ERC-20) from a master XPUB and an index.
 * The xpub must be the account-level key at path m/44'/60'/0'.
 * Derives relative child path 0/index → full path m/44'/60'/0'/0/index (same as Trezor Suite).
 */
export const deriveUsdtAddress = (xpub: string, index: number): string => {
  try {
    if (!xpub || !xpub.startsWith("xpub")) return "";

    const node = ethers.HDNodeWallet.fromExtendedKey(xpub);
    // Derive external chain (0) address at index — relative to the account xpub
    const child = node.derivePath(`0/${index}`);

    return child.address;
  } catch (e) {
    console.error("Error deriving ETH address:", e);
    return "Error: Invalid XPUB Configuration";
  }
};

/**
 * Derives a real Bitcoin native-segwit (P2WPKH / bech32) address from a master
 * XPUB/ZPUB and an index using BIP84 external chain path (0/index).
 * Produces the same addresses as Trezor for the m/84'/0'/0' account.
 */
export const deriveBtcAddress = (extendedKey: string, index: number): string => {
  try {
    if (!extendedKey) return "";

    // Normalize zpub → xpub (with correct checksum recalculation)
    const normalized = normalizeBtcExtendedKey(extendedKey);

    // ethers HDNodeWallet handles BIP32 arithmetic regardless of coin type
    const node = ethers.HDNodeWallet.fromExtendedKey(normalized as any);
    const child = node.derivePath(`0/${index}`);

    // Get compressed public key (33 bytes); BIP32 stores compressed keys internally
    const compressedHex = ethers.SigningKey.computePublicKey(child.publicKey, true);
    const pubKeyBytes = ethers.getBytes(compressedHex);

    // Produce a real P2WPKH bech32 address (bc1q...)
    return p2wpkh(pubKeyBytes).address!;
  } catch (e) {
    console.error("Error deriving BTC address:", e);
    return "Error: Invalid BTC extended key";
  }
};
