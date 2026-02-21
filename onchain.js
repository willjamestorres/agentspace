/**
 * AgentSpace — On-Chain Update Module
 * 
 * Wires the Express server to the deployed AgentSpaceRegistry contract.
 * Every successful skybox generation is automatically committed to Base Sepolia.
 * 
 * Usage: require('./onchain') in server.js, then call updateEnvironmentOnChain()
 * after a successful skybox generation.
 */

require('dotenv').config();
const { ethers } = require('ethers');

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL         = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const PRIVATE_KEY     = process.env.SERVER_WALLET_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// Minimal ABI — only the functions we need
const ABI = [
  "function updateEnvironment(uint256 tokenId, string calldata newPrompt, uint256 skyboxJobId, string calldata skyboxUrl) external",
  "function agentIdToToken(string calldata agentId) external view returns (uint256)",
  "function getAgent(uint256 tokenId) external view returns (tuple(string agentId, uint256 erc8004TokenId, string environmentPrompt, uint256 skyboxJobId, string skyboxUrl, uint256 totalRegens, bool isActive))",
  "event EnvironmentUpdated(uint256 indexed erc8004TokenId, string agentId, string newPrompt, uint256 skyboxJobId, string skyboxUrl, uint256 timestamp)"
];

// ─── Setup ────────────────────────────────────────────────────────────────────

let provider;
let signer;
let contract;
let initialized = false;

function init() {
  if (!PRIVATE_KEY) {
    console.warn('[OnChain] SERVER_WALLET_KEY not set — on-chain updates disabled');
    return false;
  }
  if (!CONTRACT_ADDRESS) {
    console.warn('[OnChain] CONTRACT_ADDRESS not set — on-chain updates disabled');
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    signer   = new ethers.Wallet(PRIVATE_KEY, provider);
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    initialized = true;
    console.log(`[OnChain] Connected to Base Sepolia`);
    console.log(`[OnChain] Contract: ${CONTRACT_ADDRESS}`);
    console.log(`[OnChain] Signer:   ${signer.address}`);
    return true;
  } catch (err) {
    console.error('[OnChain] Init failed:', err.message);
    return false;
  }
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Look up an agent's ERC-8004 token ID by their string agent ID.
 * Returns 0 if agent isn't registered on-chain yet.
 */
async function getTokenId(agentId) {
  if (!initialized) return null;
  try {
    const tokenId = await contract.agentIdToToken(agentId);
    return Number(tokenId);
  } catch (err) {
    console.error(`[OnChain] getTokenId failed for ${agentId}:`, err.message);
    return null;
  }
}

/**
 * Update an agent's environment on-chain after a successful skybox generation.
 * 
 * @param {string} agentId    - Off-chain agent ID (e.g. "agent-001")
 * @param {string} prompt     - The environment description
 * @param {number} skyboxJobId - Blockade Labs job ID
 * @param {string} skyboxUrl  - URL to the generated skybox image
 */
async function updateEnvironmentOnChain(agentId, prompt, skyboxJobId, skyboxUrl) {
  if (!initialized) {
    console.log('[OnChain] Skipping on-chain update — not initialized');
    return null;
  }

  try {
    // Look up the agent's token ID
    const tokenId = await getTokenId(agentId);
    
    if (!tokenId || tokenId === 0) {
      console.log(`[OnChain] Agent "${agentId}" not registered on-chain yet — skipping update`);
      console.log(`[OnChain] To register: call registerAgent() on the contract first`);
      return null;
    }

    console.log(`[OnChain] Updating environment for agent "${agentId}" (token #${tokenId})...`);

    // Send the transaction
    const tx = await contract.updateEnvironment(
      tokenId,
      prompt,
      skyboxJobId,
      skyboxUrl
    );

    console.log(`[OnChain] Transaction sent: ${tx.hash}`);
    console.log(`[OnChain] View on BaseScan: https://sepolia.basescan.org/tx/${tx.hash}`);

    // Wait for confirmation
    const receipt = await tx.wait();
    console.log(`[OnChain] Confirmed in block ${receipt.blockNumber} ✅`);

    return {
      txHash:      tx.hash,
      blockNumber: receipt.blockNumber,
      tokenId,
      agentId,
      explorerUrl: `https://sepolia.basescan.org/tx/${tx.hash}`
    };

  } catch (err) {
    // Don't crash the server if on-chain update fails
    console.error(`[OnChain] Update failed for "${agentId}":`, err.message);
    return null;
  }
}

/**
 * Read an agent's current on-chain environment data.
 */
async function getAgentOnChain(agentId) {
  if (!initialized) return null;

  try {
    const tokenId = await getTokenId(agentId);
    if (!tokenId || tokenId === 0) return null;

    const data = await contract.getAgent(tokenId);
    return {
      agentId:           data.agentId,
      tokenId:           Number(data.erc8004TokenId),
      environmentPrompt: data.environmentPrompt,
      skyboxJobId:       Number(data.skyboxJobId),
      skyboxUrl:         data.skyboxUrl,
      totalRegens:       Number(data.totalRegens),
      isActive:          data.isActive
    };
  } catch (err) {
    console.error(`[OnChain] getAgent failed for ${agentId}:`, err.message);
    return null;
  }
}

// ─── Initialize on require ────────────────────────────────────────────────────

init();

module.exports = {
  updateEnvironmentOnChain,
  getAgentOnChain,
  getTokenId,
  isInitialized: () => initialized
};
