/**
 * AgentSpace — Local API Server
 * 
 * Bridges the Three.js viewer (viewer/index.html) and the Skybox integration (skybox.js).
 * Runs locally on your machine so your SKYBOX_API_KEY never touches the browser.
 * 
 * Setup:
 *   1. Install dependencies:
 *        npm install express cors dotenv
 * 
 *   2. Make sure your .env file has:
 *        SKYBOX_API_KEY=your-key-here
 *        ANTHROPIC_API_KEY=your-key-here
 * 
 *   3. Start the server:
 *        node server.js
 * 
 *   4. Open the viewer:
 *        http://localhost:3000
 * 
 *   The viewer will automatically connect to this server for skybox generation.
 */

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { updateEnvironmentOnChain } = require('./onchain');
const {
  generateSkybox,
  generateSkyboxAndWait,
  regenerateSkybox,
  getSkyboxStatus,
  listSkyboxes,
  getStyles,
} = require('./skybox');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Serve the viewer at /
app.use(express.static(path.join(__dirname, 'viewer')));

// ─── In-memory agent state ────────────────────────────────────────────────────
// Tracks each agent's current environment.
// In Phase 3 this will be replaced by on-chain storage.

const agentEnvironments = {
  'agent-001': { prompt: 'Futuristic floating city above the clouds', skyboxId: null, fileUrl: null },
  'agent-002': { prompt: 'Deep ocean bioluminescent world',           skyboxId: null, fileUrl: null },
  'agent-003': { prompt: 'Ancient forest bathed in golden hour light', skyboxId: null, fileUrl: null },
};

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Basic health check — confirms server and API key are configured.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    skyboxKeyConfigured: !!process.env.SKYBOX_API_KEY,
    anthropicKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
    agents: Object.keys(agentEnvironments),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/styles
 * Returns all available Blockade Labs skybox styles.
 */
app.get('/api/styles', async (req, res) => {
  try {
    const styles = await getStyles();
    res.json({ styles });
  } catch (err) {
    console.error('[/api/styles]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/agents
 * Returns current state of all agents and their environments.
 */
app.get('/api/agents', (req, res) => {
  res.json({ agents: agentEnvironments });
});

/**
 * POST /api/generate
 * Generate a new skybox environment for an agent.
 * 
 * Body: { agentId: string, prompt: string, styleId?: number, wait?: boolean }
 * 
 * If wait=true (default), polls until generation is complete and returns the file URL.
 * If wait=false, returns immediately with the job ID for polling via /api/status/:id.
 */
app.post('/api/generate', async (req, res) => {
  const { agentId, prompt, styleId = null, wait = true } = req.body;

  if (!agentId || !prompt) {
    return res.status(400).json({ error: 'agentId and prompt are required.' });
  }

  console.log(`[API] Agent "${agentId}" requesting environment: "${prompt}"`);

  try {
    let skybox;

    if (wait) {
      // Generate and wait for completion (recommended for small deployments)
      skybox = await generateSkyboxAndWait(prompt, styleId);
    } else {
      // Fire and forget — client polls /api/status/:id
      skybox = await generateSkybox(prompt, styleId);
    }

    // Update agent state
    if (agentEnvironments[agentId]) {
      agentEnvironments[agentId].prompt   = prompt;
      agentEnvironments[agentId].skyboxId = skybox.id;
      agentEnvironments[agentId].fileUrl  = skybox.fileUrl;
    } else {
      // New agent not in default list
      agentEnvironments[agentId] = { prompt, skyboxId: skybox.id, fileUrl: skybox.fileUrl };
      updateEnvironmentOnChain(agentId, prompt, skybox.id, skybox.fileUrl);
    }

    console.log(`[API] Agent "${agentId}" environment updated. Skybox ID: ${skybox.id}`);

    res.json({ agentId, skybox });

  } catch (err) {
    console.error(`[/api/generate]`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/status/:skyboxId
 * Poll the status of a skybox generation job.
 * Use this when you called /api/generate with wait=false.
 */
app.get('/api/status/:skyboxId', async (req, res) => {
  try {
    const status = await getSkyboxStatus(req.params.skyboxId);
    res.json(status);
  } catch (err) {
    console.error('[/api/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/skyboxes
 * List recent skyboxes on your Blockade Labs account.
 */
app.get('/api/skyboxes', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const skyboxes = await listSkyboxes(limit);
    res.json({ skyboxes });
  } catch (err) {
    console.error('[/api/skyboxes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/agent/:agentId/regenerate
 * Dedicated endpoint for an agent to regenerate their own environment.
 * This is the endpoint OpenClaw agents will call directly.
 * 
 * Body: { prompt: string, styleId?: number }
 */
app.post('/api/agent/:agentId/regenerate', async (req, res) => {
  const { agentId } = req.params;
  const { prompt, styleId = null } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required.' });
  }

  console.log(`[API] Agent "${agentId}" self-regenerating environment: "${prompt}"`);

  try {
    const result = await regenerateSkybox(agentId, prompt, styleId);

    // Update agent state
    agentEnvironments[agentId] = {
      prompt,
      skyboxId: result.skybox.id,
      fileUrl:  result.skybox.fileUrl,
    };

    res.json(result);

  } catch (err) {
    console.error(`[/api/agent/${agentId}/regenerate]`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║        AgentSpace Server             ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  Viewer:  http://localhost:${PORT}`);
  console.log(`  API:     http://localhost:${PORT}/api/health`);
  console.log('');
  console.log(`  Skybox key:   ${process.env.SKYBOX_API_KEY   ? '✓ configured' : '✗ MISSING — add to .env'}`);
  console.log(`  Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ configured' : '✗ MISSING — add to .env'}`);
  console.log('');
});
