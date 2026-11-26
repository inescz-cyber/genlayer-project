#!/usr/bin/env node
/**
 * GenLayer write helper (genlayer-js SDK) — the CLI `genlayer write` has
 * no --value flag, so payable calls (create_bounty) go through the SDK,
 * which accepts a `value` in writeContract.
 *
 * Usage:
 *   node genlayer-write.js <contract> <method> <valueGEN> [<arg1> <arg2> ...]
 *
 * The deployer keystore (~/.genlayer/keystores/bountyjudge-deployer.json)
 * is decrypted in-memory with the password from
 * ~/.config/genlayer-bountyjudge/password. The private key is never
 * printed or written anywhere. Testnet only (Studionet, chain 61999).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");
const { createClient, createAccount } = require("genlayer-js");
// genlayer-js exports chains from 'genlayer-js/chains'
const chains = require("genlayer-js/chains");

async function main() {
  const [contract, method, valueGEN, ...args] = process.argv.slice(2);
  if (!contract || !method || valueGEN === undefined) {
    console.log("Usage: node genlayer-write.js <contract> <method> <valueGEN> [args...]");
    process.exit(2);
  }
  const keystoreName = process.env.GENLAYER_KEYSTORE || "bountyjudge-deployer";
  const passwordFile = process.env.GENLAYER_PASSWORD_FILE ||
    path.join(os.homedir(), ".config", "genlayer-bountyjudge", "password");
  const password = fs.readFileSync(passwordFile, "utf8").trim();
  const keystoreJson = fs.readFileSync(
    path.join(os.homedir(), ".genlayer", "keystores", keystoreName + ".json"), "utf8"
  );
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  const account = createAccount(wallet.privateKey);
  console.log("signer:", account.address);
  const client = createClient({ chain: chains.studionet, account });
  const value = ethers.parseEther(valueGEN);
  // u256 args arrive as strings from argv; convert pure integers to BigInt
  // so the SDK encodes them as uint256 (string args stay strings).
  const encArgs = args.map((a) => (/^\d+$/.test(a) ? BigInt(a) : a));
  console.log(`writeContract ${method}(${args.join(", ")}) value=${valueGEN} GEN`);
  // Studionet requires an explicit fee preset: estimate first, then pass it.
  const estimate = await client.estimateTransactionFeesForWrite({
    account,
    address: contract,
    functionName: method,
    args: encArgs,
    value,
  });
  const hash = await client.writeContract({
    account,
    address: contract,
    functionName: method,
    args: encArgs,
    value,
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  console.log("tx hash:", hash);
  const receipt = await client.waitForTransactionReceipt({ hash, waitUntil: "decided" });
  console.log("receipt status:", receipt.status ?? receipt.lifecycle?.state ?? JSON.stringify(receipt).slice(0, 300));
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
