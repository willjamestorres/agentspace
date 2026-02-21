/**
 * AgentSpace — Blockade Labs Skybox Integration
 * 
 * Setup:
 *   1. Add your key to ~/.openclaw/openclaw.json env block:
 *      "SKYBOX_API_KEY": "your-key-here"
 *   OR export it in your shell:
 *      export SKYBOX_API_KEY="your-key-here"
 * 
 *   2. Install dependencies:
 *      npm install node-fetch
 * 
 *   3. Run directly to test:
 *      node skybox.js
 * 
 *   4. Or import into your OpenClaw agent skill:
 *      const { generateSkybox, regenerateSkybox, getSkyboxStatus } = require('./skybox');
 */

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SKYBOX_API_BASE = 'https://backend-staging.blockadelabs.com/api/v1';
const API_KEY = process.env.SKYBOX_API_KEY;

// ─── Sanity Check ────────────────────────────────────────────────────────────

function checkApiKey() {
  if (!API_KEY) {
    throw new Error(
      'SKYBOX_API_KEY is not set.\n' +
      'Add it to your environment:\n' +
      '  export SKYBOX_API_KEY="your-key-here"\n' +
      'Or add it to your openclaw.json env block.'
    );
  }
}

// ─── Core API Helpers ─────────────────────────────────────────────────────────

async function apiGet(endpoint) {
  checkApiKey();
  const res = await fetch(`${SKYBOX_API_BASE}${endpoint}`, {
    headers: { 'x-api-key': API_KEY }
  });
  if (!res.ok) throw new Error(`Skybox API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(endpoint, body) {
  checkApiKey();
  const res = await fetch(`${SKYBOX_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.log('Full error response:', errorText);
    console.log('Request URL:', `${SKYBOX_API_BASE}${endpoint}`);
    console.log('API Key used:', API_KEY.substring(0, 8) + '...');
    throw new Error(`Skybox API error ${res.status}: ${errorText}`);
  }

  //if (!res.ok) throw new Error(`Skybox API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Skybox Styles ────────────────────────────────────────────────────────────

/**
 * Fetch all available skybox styles.
 * Useful for letting agents pick a visual theme for their space.
 */
async function getStyles() {
  const data = await apiGet('/skybox/styles');
  return data.map(s => ({ id: s.id, name: s.name, description: s.description }));
}

// ─── Generate a Skybox ────────────────────────────────────────────────────────

/**
 * Generate a new skybox from a text prompt.
 * 
 * @param {string} prompt      - Description of the environment to generate
 * @param {number} [styleId]   - Optional style ID (get options from getStyles())
 * @param {string} [negPrompt] - Optional negative prompt (things to avoid)
 * @returns {object}           - { id, status, prompt, thumbUrl, fileUrl }
 */
async function generateSkybox(prompt, styleId = null, negPrompt = '') {
  console.log(`[Skybox] Generating: "${prompt}"`);

  const body = { prompt, skybox_style_id: styleId };
  if (negPrompt) body.negative_text = negPrompt;

  const data = await apiPost('/skybox', body);

  return {
    id: data.id,
    status: data.status,
    prompt: data.prompt,
    thumbUrl: data.thumb_url || null,
    fileUrl: data.file_url || null,
    pusherChannel: data.pusher_channel || null,
    obfuscatedId: data.obfuscated_id || null,
  };
}

// ─── Check Generation Status ──────────────────────────────────────────────────

/**
 * Poll the status of a skybox generation job.
 * Status values: 'pending', 'processing', 'complete', 'error'
 * 
 * @param {number} skyboxId - The ID returned from generateSkybox()
 * @returns {object}        - { id, status, thumbUrl, fileUrl }
 */
async function getSkyboxStatus(skyboxId) {
  const data = await apiGet(`/imagine/requests/${skyboxId}`);
  const req = data.request; //
  //Debug, returns specific fields
  //console.log('Status response:', JSON.stringify(data, null, 2));
  return {
    id: req.id,
    status: req.status,
    prompt: req.prompt,
    thumbUrl: req.thumb_url || null,
    fileUrl: req.file_url || null,
  };
}

// ─── Wait for Completion ──────────────────────────────────────────────────────

/**
 * Generate a skybox and wait for it to complete.
 * Polls every 5 seconds until done or timeout.
 * 
 * @param {string} prompt      - Description of the environment
 * @param {number} [styleId]   - Optional style ID
 * @param {string} [negPrompt] - Optional negative prompt
 * @param {number} [timeoutMs] - Max wait time in ms (default: 3 minutes)
 * @returns {object}           - Completed skybox data with fileUrl
 */
async function generateSkyboxAndWait(prompt, styleId = null, negPrompt = '', timeoutMs = 180000) {
  const result = await generateSkybox(prompt, styleId, negPrompt);

  if (result.status === 'complete') return result;

  console.log(`[Skybox] Job ${result.id} queued, polling for completion...`);

  const start = Date.now();
  const pollInterval = 5000;

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    const status = await getSkyboxStatus(result.id);
    console.log(`[Skybox] Status: ${status.status}`);

    if (status.status === 'complete') {
      console.log(`[Skybox] Complete! File: ${status.fileUrl}`);
      return status;
    }

    if (status.status === 'error') {
      throw new Error(`[Skybox] Generation failed for job ${result.id}`);
    }
  }

  throw new Error(`[Skybox] Timed out waiting for job ${result.id}`);
}

// ─── Agent-Triggered Regeneration ────────────────────────────────────────────

/**
 * Allow an agent to regenerate its home environment.
 * 
 * This is the main entry point for OpenClaw agents to modify their space.
 * Pass agentId to track which agent owns which environment.
 * 
 * @param {string} agentId   - Unique identifier for the agent
 * @param {string} prompt    - The new environment the agent wants to create
 * @param {number} [styleId] - Optional visual style
 * @returns {object}         - { agentId, skybox }
 */
async function regenerateSkybox(agentId, prompt, styleId = null) {
  console.log(`[AgentSpace] Agent "${agentId}" is regenerating their environment...`);
  console.log(`[AgentSpace] New environment: "${prompt}"`);

  const skybox = await generateSkyboxAndWait(prompt, styleId);

  console.log(`[AgentSpace] Agent "${agentId}" environment updated successfully.`);

  return {
    agentId,
    skybox,
    timestamp: new Date().toISOString(),
  };
}

// ─── Fetch Agent's Current Environment ───────────────────────────────────────

/**
 * Get all skyboxes associated with your account.
 * Use this to track what environment each agent currently has.
 */
async function listSkyboxes(limit = 10) {
  const data = await apiGet(`/imagine/myRequests?limit=${limit}&order=DESC`);
  return (data.data || []).map(s => ({
    id: s.id,
    status: s.status,
    prompt: s.prompt,
    thumbUrl: s.thumb_url,
    fileUrl: s.file_url,
    createdAt: s.created_at,
  }));
}

// ─── Test / Demo ──────────────────────────────────────────────────────────────

async function demo() {
  console.log('=== AgentSpace Skybox Integration Test ===\n');

  // 1. List available styles
  console.log('Fetching available styles...');
  const styles = await getStyles();
  console.log(`Found ${styles.length} styles. First 5:`);
  styles.slice(0, 5).forEach(s => console.log(`  [${s.id}] ${s.name}`));
  console.log();

  // 2. Simulate an agent generating their home environment
  const agentId = 'agent-001';
  const prompt = 'A futuristic floating city above the clouds, neon lights, glass towers, peaceful and vast';

  console.log(`Simulating agent "${agentId}" creating their home environment...`);
  console.log(`Prompt: "${prompt}"\n`);

  // NOTE: Remove the comment below to actually call the API and generate a skybox.
  // This is commented out so the demo doesn't consume API credits on every run.

  /*
  const result = await regenerateSkybox(agentId, prompt, styles[0]?.id);
  console.log('\nResult:');
  console.log(JSON.stringify(result, null, 2));
  */

  console.log('[Demo] API call is commented out to preserve credits.');
  console.log('[Demo] Uncomment the block in demo() to generate a real skybox.');
  console.log('\n=== Integration ready! ===');
  console.log('Import these functions into your OpenClaw agent skill:');
  console.log('  generateSkybox(prompt, styleId)');
  console.log('  regenerateSkybox(agentId, prompt, styleId)');
  console.log('  getSkyboxStatus(skyboxId)');
  console.log('  listSkyboxes()');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateSkybox,
  generateSkyboxAndWait,
  regenerateSkybox,
  getSkyboxStatus,
  listSkyboxes,
  getStyles,
};

// Run demo if executed directly
if (require.main === module) {
  demo().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
