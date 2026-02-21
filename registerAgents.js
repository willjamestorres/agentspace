/**
 * AgentSpace — Register Agents On-Chain
 * z
 * Run once to register agent-001, agent-002, and agent-003
 * with the deployed AgentSpaceRegistry contract on Base Sepolia.
 * 
 * Usage:
 *   node registerAgents.js
 */

require('dotenv').config();
console.log('Dotenv loaded:', !!process.env.SERVER_WALLET_KEY, process.env.SERVER_WALLET_KEY?.slice(0,6));
console.log('Contract address:', process.env.CONTRACT_ADDRESS?.slice(0,10));
const { ethers } = require('ethers');

const RPC_URL          = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const PRIVATE_KEY      = process.env.SERVER_WALLET_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const ABI = [
  "function registerAgent(string calldata agentId, string calldata agentURI, string calldata initialPrompt, address controller) external returns (uint256)",
  "function agentIdToToken(string calldata agentId) external view returns (uint256)"
];

const AGENTS = [
  {
    agentId:       "agent-001",
    agentURI:      "ipfs://QmAgentSpace001",
    initialPrompt: "A futuristic floating city above the clouds",
  }
];

async function main() {
  if (!PRIVATE_KEY) {
    console.error('Error: SERVER_WALLET_KEY not set in .env');
    process.exit(1);
  }
  if (!CONTRACT_ADDRESS) {
    console.error('Error: CONTRACT_ADDRESS not set in .env');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider({
    url: RPC_URL,
    skipFetchSetup: true
  }, {
    chainId: 84532,
    name: 'base-sepolia',
    ensAddress: null
  });
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  console.log(`\nRegistering agents on Base Sepolia...`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`Signer:   ${signer.address}\n`);

  let succeeded = 0;
  let skipped   = 0;
  let failed    = 0;

  for (const agent of AGENTS) {
    console.log(`[${agent.agentId}] Registering...`);
    try {
      const tx = await contract.registerAgent(
        agent.agentId,
        agent.agentURI,
        agent.initialPrompt,
        signer.address
      );
      console.log(`[${agent.agentId}] Tx sent: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`[${agent.agentId}] Confirmed in block ${receipt.blockNumber} ✅`);
      console.log(`[${agent.agentId}] BaseScan: https://sepolia.basescan.org/tx/${tx.hash}\n`);
      succeeded++;
    } catch (err) {
      console.error(`[${agent.agentId}] Failed:`, err.message);
      failed++;
    }
  }

  console.log(`\nDone — ${succeeded} registered, ${skipped} skipped, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch(console.error);
