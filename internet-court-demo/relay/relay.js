#!/usr/bin/env node
/**
 * BountyJudge <-> Kleros relay.
 *
 * Bridges a GenLayer AppealableBountyJudge bounty (Studionet, chain 61999)
 * with Kleros Court V2 (Arbitrum Sepolia, chain 421614, Agentic Commerce
 * Court id 8) through the already-deployed Kleros DisputeResolver.
 *
 * Flow:
 *   1. GenLayer AI judge rules on a bounty  -> status "judged" (no payout).
 *   2. `appeal <bountyId>`  — creates a Kleros dispute via the
 *      DisputeResolver (court 8, 5 jurors, Classic kit), then records the
 *      Kleros dispute id on GenLayer (appeal_bounty) -> status "appealed".
 *   3. Kleros jurors vote (~1-2h on testnet). `resolve <bountyId>` reads
 *      the ruling on-chain (DisputeResolver.disputes + KlerosCore) and
 *      executes it on GenLayer (resolve_appeal): 1 = refund poster,
 *      2 = pay hunter, 0 = GenLayer verdict stands.
 *   4. `finalize <bountyId>` — no appeal: pay per the GenLayer verdict.
 *
 * Trust model (demo): GenLayer cannot read Arbitrum, so this relay is a
 * trusted off-chain bridge. It reads the Kleros ruling ON-CHAIN before
 * submitting it to GenLayer, and prints every transaction hash so anyone
 * can verify each step. A production version would verify the ruling with
 * a light client / attestation instead of trusting the relayer.
 *
 * Env:
 *   GENLAYER_CONTRACT            AppealableBountyJudge address (Studionet)
 *   ARBITRUM_SEPOLIA_PRIVATE_KEY testnet-only relay key (creates disputes)
 *   GENLAYER_KEYSTORE_PASSWORD_FILE (default ~/.config/genlayer-bountyjudge/password)
 *   ARBITRUM_SEPOLIA_RPC        (default https://sepolia-rollup.arbitrum.io/rpc)
 *
 * The relay key needs ~0.01 testnet ETH on Arbitrum Sepolia (faucet).
 * Never put a mainnet key or a seed phrase here. Testnet only.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { ethers } = require("ethers");

const ARB_RPC = process.env.ARBITRUM_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";
const KLEROS_CORE = "0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479";
const DISPUTE_RESOLVER = "0xed31bEE8b1F7cE89E93033C0d3B2ccF4cEb27652";
const COURT_ID = 8; // Agentic Commerce Court
const MIN_JURORS = 5;
const DISPUTE_KIT_CLASSIC = 1;
const NUMBER_OF_RULING_OPTIONS = 2; // rulings 1 and 2 (+ 0 = refuse)

const GENLAYER_CONTRACT = process.env.GENLAYER_CONTRACT || "";
const TEMPLATE_PATH = path.join(__dirname, "..", "contracts", "BountyJudgeAppeal.template.json");

const RESOLVER_ABI = [
  "function createDisputeForTemplate(bytes _arbitratorExtraData, string _disputeTemplate, string _disputeTemplateDataMappings, uint256 _numberOfRulingOptions) payable returns (uint256)",
  "function disputes(uint256) view returns (bytes arbitratorExtraData, bool isRuled, uint256 ruling, uint256 numberOfRulingOptions)",
  "function arbitratorDisputeIDToLocalID(uint256) view returns (uint256)",
];
const CORE_ABI = [
  "function arbitrationCost(bytes _extraData) view returns (uint256)",
  "function currentRuling(uint256 _disputeID) view returns (uint256 ruling, bool tied, bool overridden)",
];

function genlayerPassword() {
  const f = process.env.GENLAYER_KEYSTORE_PASSWORD_FILE ||
    path.join(os.homedir(), ".config", "genlayer-bountyjudge", "password");
  return fs.readFileSync(f, "utf8").trim();
}

// Run the genlayer CLI. `input` (password) is piped to stdin when given.
function genlayer(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn("genlayer", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, out, err }));
    if (input) p.stdin.write(input + "\n");
    p.stdin.end();
  });
}

async function genlayerCall(method, ...args) {
  if (!GENLAYER_CONTRACT) throw new Error("GENLAYER_CONTRACT env not set");
  const r = await genlayer(["call", GENLAYER_CONTRACT, method,
    ...(args.length ? ["--args", ...args.map(String)] : [])]);
  if (r.code !== 0) throw new Error(`genlayer call ${method} failed: ${r.err || r.out}`);
  // CLI prints "Result:\n<value>\n\n✔ ..." — take the JSON-ish block after "Result:".
  const m = r.out.match(/Result:\n([\s\S]*?)\n\s*\n/);
  const raw = (m ? m[1] : r.out).trim();
  try { return JSON.parse(raw); } catch {
    // Struct results print as a JS object literal (single quotes, unquoted
    // keys) — not valid JSON. Evaluate it; the input is the local CLI's own
    // output, so this is trusted. Falls back to the raw string.
    try { return new Function("return (" + raw + ")")(); } catch { return raw; }
  }
}

async function genlayerWrite(method, ...args) {
  if (!GENLAYER_CONTRACT) throw new Error("GENLAYER_CONTRACT env not set");
  const r = await genlayer(
    ["write", GENLAYER_CONTRACT, method, "--args", ...args.map(String)],
    genlayerPassword()
  );
  if (r.code !== 0) throw new Error(`genlayer write ${method} failed: ${r.err || r.out}`);
  const tx = r.out.match(/'Transaction Hash': '([^']+)'/);
  const addr = r.out.match(/'Contract Address': '([^']+)'/);
  return { txHash: tx ? tx[1] : null, raw: r.out };
}

function extraData() {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "uint256"],
    [COURT_ID, MIN_JURORS, DISPUTE_KIT_CLASSIC]
  );
}

function fillTemplate(bounty) {
  const tpl = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const sub = (s) =>
    s.replaceAll("{{bountyId}}", String(bounty.id))
     .replaceAll("{{title}}", bounty.title)
     .replaceAll("{{verdict}}", bounty.verdict || "")
     .replaceAll("{{reasons}}", bounty.reasons || "")
     .replaceAll("{{evidenceUrl}}", bounty.evidence_url || "")
     .replaceAll("{{genLayerContract}}", GENLAYER_CONTRACT)
     .replaceAll("{{hunter}}", bounty.hunter || "")
     .replaceAll("{{poster}}", bounty.poster || "");
  return sub(tpl);
}

function arbProvider() {
  return new ethers.JsonRpcProvider(ARB_RPC);
}
function arbWallet() {
  let pk = process.env.ARBITRUM_SEPOLIA_PRIVATE_KEY;
  if (!pk && process.env.ARBITRUM_SEPOLIA_KEY_FILE) {
    pk = JSON.parse(fs.readFileSync(process.env.ARBITRUM_SEPOLIA_KEY_FILE, "utf8")).privateKey;
  }
  if (!pk) throw new Error("Set ARBITRUM_SEPOLIA_PRIVATE_KEY or ARBITRUM_SEPOLIA_KEY_FILE (testnet-only key)");
  return new ethers.Wallet(pk, arbProvider());
}

async function cmdCost() {
  const core = new ethers.Contract(KLEROS_CORE, CORE_ABI, arbProvider());
  const cost = await core.arbitrationCost(extraData());
  console.log(`Court ${COURT_ID}, ${MIN_JURORS} jurors, Classic kit: ${ethers.formatEther(cost)} ETH`);
}

async function cmdStatus(bountyId) {
  const bounty = await genlayerCall("get_bounty", bountyId);
  console.log("GenLayer bounty:", JSON.stringify(bounty, null, 2));
  if (bounty.kleros_dispute_id && Number(bounty.kleros_dispute_id) > 0) {
    const kId = BigInt(bounty.kleros_dispute_id);
    const resolver = new ethers.Contract(DISPUTE_RESOLVER, RESOLVER_ABI, arbProvider());
    const localId = await resolver.arbitratorDisputeIDToLocalID(kId);
    const d = await resolver.disputes(localId);
    const core = new ethers.Contract(KLEROS_CORE, CORE_ABI, arbProvider());
    const cur = await core.currentRuling(kId);
    console.log(`Kleros dispute ${kId} (local ${localId}): isRuled=${d[1]} ruling=${d[2]} currentRuling=${cur[0]} tied=${cur[1]}`);
    console.log(`Court UI: https://v2.kleros.builders/#/cases/${kId} (Arbitrum Sepolia)`);
  }
}

async function cmdAppeal(bountyId) {
  const bounty = await genlayerCall("get_bounty", bountyId);
  if (bounty.status !== "judged") {
    throw new Error(`Bounty ${bountyId} status is "${bounty.status}", expected "judged" (run judge_bounty first)`);
  }
  const wallet = arbWallet();
  const resolver = new ethers.Contract(DISPUTE_RESOLVER, RESOLVER_ABI, wallet);
  const core = new ethers.Contract(KLEROS_CORE, CORE_ABI, arbProvider());
  const cost = await core.arbitrationCost(extraData());
  console.log(`Arbitration cost: ${ethers.formatEther(cost)} ETH. Relayer: ${wallet.address}`);
  const bal = await arbProvider().getBalance(wallet.address);
  console.log(`Relayer balance: ${ethers.formatEther(bal)} ETH`);
  if (bal < cost) throw new Error("Relayer has less testnet ETH than the arbitration cost — fund it from the Arbitrum Sepolia faucet");

  const template = fillTemplate(bounty);
  console.log("Creating Kleros dispute via DisputeResolver.createDisputeForTemplate ...");
  const tx = await resolver.createDisputeForTemplate(extraData(), template, "[]", NUMBER_OF_RULING_OPTIONS, { value: cost });
  console.log("tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("confirmed in block", receipt.blockNumber);
  // DisputeRequest(arbitrator, arbitratorDisputeID, externalDisputeID, templateId, templateUri)
  const iface = new ethers.Interface(RESOLVER_ABI.concat([
    "event DisputeRequest(address indexed _arbitrator, uint256 indexed _arbitratorDisputeID, uint256 _externalDisputeID, uint256 _templateId, string _templateUri)",
  ]));
  let klerosDisputeId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "DisputeRequest") {
        klerosDisputeId = parsed.args._arbitratorDisputeID;
        console.log(`Kleros dispute id: ${klerosDisputeId} (template ${parsed.args._templateId})`);
      }
    } catch { /* not our event */ }
  }
  if (klerosDisputeId === null) throw new Error("DisputeRequest event not found in receipt");
  console.log(`Recording appeal on GenLayer (appeal_bounty ${bountyId} ${klerosDisputeId}) ...`);
  const w = await genlayerWrite("appeal_bounty", bountyId, klerosDisputeId.toString());
  console.log("GenLayer tx:", w.txHash);
  console.log(`Done. Kleros case: https://v2.kleros.builders/#/cases/${klerosDisputeId} (Arbitrum Sepolia)`);
  console.log("Jurors vote in ~1-2h on testnet. Poll with: node relay.js status " + bountyId);
}

async function cmdResolve(bountyId) {
  const bounty = await genlayerCall("get_bounty", bountyId);
  if (bounty.status !== "appealed") {
    throw new Error(`Bounty ${bountyId} status is "${bounty.status}", expected "appealed"`);
  }
  const kId = BigInt(bounty.kleros_dispute_id);
  const resolver = new ethers.Contract(DISPUTE_RESOLVER, RESOLVER_ABI, arbProvider());
  const localId = await resolver.arbitratorDisputeIDToLocalID(kId);
  const d = await resolver.disputes(localId);
  if (!d[1]) {
    console.log(`Kleros dispute ${kId} not ruled yet (isRuled=false). Jurors are still voting — try again later.`);
    return;
  }
  const ruling = Number(d[2]);
  const label = ruling === 1 ? "refund poster" : ruling === 2 ? "pay hunter" : "refuse (GenLayer verdict stands)";
  console.log(`Kleros ruling for dispute ${kId}: ${ruling} (${label})`);
  console.log(`Executing on GenLayer (resolve_appeal ${bountyId} ${ruling}) ...`);
  const w = await genlayerWrite("resolve_appeal", bountyId, String(ruling));
  console.log("GenLayer tx:", w.txHash);
  console.log("Done. Verify with: node relay.js status " + bountyId);
}

async function cmdFinalize(bountyId) {
  const bounty = await genlayerCall("get_bounty", bountyId);
  if (bounty.status !== "judged") {
    throw new Error(`Bounty ${bountyId} status is "${bounty.status}", expected "judged"`);
  }
  console.log(`Finalizing bounty ${bountyId} per GenLayer verdict "${bounty.verdict}" ...`);
  const w = await genlayerWrite("finalize_bounty", bountyId);
  console.log("GenLayer tx:", w.txHash);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "cost") await cmdCost();
    else if (cmd === "status") await cmdStatus(arg);
    else if (cmd === "appeal") await cmdAppeal(arg);
    else if (cmd === "resolve") await cmdResolve(arg);
    else if (cmd === "finalize") await cmdFinalize(arg);
    else {
      console.log("Usage: node relay.js <cost|status|appeal|resolve|finalize> [bountyId]");
      process.exit(2);
    }
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
main();
