// Verify Kleros V2 testnet court is live and readable — and confirm the
// extraData encoding (courtID as uint96 + minJurors as uint256, packed)
// by calling KlerosCore.arbitrationCost on Arbitrum Sepolia.
//
// KlerosCore (Arbitrum Sepolia, chain 421614):
//   0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479
// DisputeResolver (already-deployed arbitrable, whitelisted):
//   0xed31bEE8b1F7cE89E93033C0d3B2ccF4cEb27652
// Agentic Commerce Court: id 8, feePerJuror 0.00027 ETH.
const { ethers } = require("ethers");

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const KLEROS_CORE = "0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479";
const DISPUTE_RESOLVER = "0xed31bEE8b1F7cE89E93033C0d3B2ccF4cEb27652";
const TEMPLATE_REGISTRY = "0xe763d31Cb096B4bc7294012B78FC7F148324ebcb";

const KLEROS_CORE_ABI = [
  "function arbitrationCost(bytes _extraData) view returns (uint256)",
  "function currentRuling(uint256 _disputeID) view returns (uint256 ruling, bool tied, bool overridden)",
];
const RESOLVER_ABI = [
  "function arbitrator() view returns (address)",
  "function templateRegistry() view returns (address)",
  "function disputes(uint256) view returns (bytes arbitratorExtraData, bool isRuled, uint256 ruling, uint256 numberOfRulingOptions)",
];

function extraData(courtId, minJurors) {
  // abi.encodePacked(uint96 courtID, uint256 minJurors)
  return ethers.solidityPacked(["uint96", "uint256"], [courtId, minJurors]);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const net = await provider.getNetwork();
  console.log("chainId:", net.chainId.toString());
  console.log("block:", await provider.getBlockNumber());

  const core = new ethers.Contract(KLEROS_CORE, KLEROS_CORE_ABI, provider);
  for (const jurors of [3, 5]) {
    const ed = extraData(8, jurors);
    const cost = await core.arbitrationCost(ed);
    console.log(
      `court 8, minJurors ${jurors}: extraData=${ed} arbitrationCost=${ethers.formatEther(cost)} ETH`
    );
  }
  // Sanity: General Court (id 1) for comparison.
  const ed1 = extraData(1, 3);
  console.log(
    `court 1, minJurors 3: arbitrationCost=${ethers.formatEther(await core.arbitrationCost(ed1))} ETH`
  );

  // DisputeResolver wiring.
  const resolver = new ethers.Contract(DISPUTE_RESOLVER, RESOLVER_ABI, provider);
  console.log("DisputeResolver.arbitrator() =", await resolver.arbitrator());
  console.log("DisputeResolver.templateRegistry() =", await resolver.templateRegistry());
  console.log("expected arbitrator:", KLEROS_CORE);
  console.log("expected templateRegistry:", TEMPLATE_REGISTRY);

  // Latest ruled dispute in the resolver (dispute 219 -> local id unknown;
  // read disputes(0..2) shape check is enough for the getter ABI).
  try {
    const d0 = await resolver.disputes(0);
    console.log("disputes(0): isRuled=", d0[1], "ruling=", d0[2].toString());
  } catch (e) {
    console.log("disputes(0) read failed:", e.message.slice(0, 120));
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
