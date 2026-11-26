// Pin down the KlerosCore extraData encoding on Arbitrum Sepolia.
// Court 8 feePerJuror = 0.00027 ETH, court 1 = 0.00001 ETH.
// Expected arbitrationCost for 3 jurors: court 8 -> 0.00081 ETH, court 1 -> 0.00003 ETH.
const { ethers } = require("ethers");

const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
const KLEROS_CORE = "0xE8442307d36e9bf6aB27F1A009F95CE8E11C3479";
const ABI = ["function arbitrationCost(bytes _extraData) view returns (uint256)"];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const core = new ethers.Contract(KLEROS_CORE, ABI, provider);

  const variants = {
    // A: packed uint96(court) + uint256(jurors) — 44 bytes (skill.md)
    "A packed u96+u256 court8/3": ethers.solidityPacked(["uint96", "uint256"], [8, 3]),
    // B: abi.encode uint256(court), uint256(jurors), uint256(kit=1) — 96 bytes (IArbitratorV2 doc)
    "B abi u256,u256,u256 court8/3/kit1": ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256"], [8, 3, 1]
    ),
    // C: abi.encode uint256(court), uint256(jurors) — 64 bytes
    "C abi u256,u256 court8/3": ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"], [8, 3]
    ),
    // D: packed uint96(court) + uint256(jurors) + uint256(kit=1) — 76 bytes
    "D packed u96+u256+u256 court8/3/kit1": ethers.solidityPacked(
      ["uint96", "uint256", "uint256"], [8, 3, 1]
    ),
    // E: invalid court 999, packed
    "E packed u96+u256 court999/3": ethers.solidityPacked(["uint96", "uint256"], [999, 3]),
    // F: invalid court 999, abi 96-byte
    "F abi u256,u256,u256 court999/3/kit1": ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint256"], [999, 3, 1]
    ),
  };

  for (const [name, ed] of Object.entries(variants)) {
    try {
      const cost = await core.arbitrationCost(ed);
      console.log(`${name}: ${ethers.formatEther(cost)} ETH (len ${ (ed.length - 2) / 2 } bytes)`);
    } catch (e) {
      console.log(`${name}: REVERT — ${e.message.slice(0, 140)}`);
    }
  }
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
