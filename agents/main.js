/**
 * AgentSpace — OpenClaw Agent Skill
 * 
 * This skill allows your OpenClaw agent to autonomously manage
 * and regenerate its Skybox environment through natural conversation.
 * 
 * Setup:
 *   1. Place this file in your agentspace/agents/ folder
 *   2. Make sure server.js is running (node server.js)
 *   3. Add to your openclaw.json skills section (see bottom of file)
 * 
 * Your agent can then respond to prompts like:
 *   - "Redecorate your space"
 *   - "Change your environment to a cyberpunk city"
 *   - "What does your home look like right now?"
 *   - "Generate a new environment for agent-002"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const SERVER_URL = process.env.AGENTSPACE_SERVER || 'http://localhost:3000';

// ─── Core Agent Actions ───────────────────────────────────────────────────────

/**
 * Get the current environment for an agent.
 */
async function getAgentEnvironment(agentId = 'agent-001') {
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
  
  try {
    const res = await fetch(`${SERVER_URL}/api/agents`);
    const data = await res.json();
    const agent = data.agents[agentId];

    if (!agent) {
      return { success: false, message: `Agent "${agentId}" not found.` };
    }

    return {
      success: true,
      agentId,
      prompt: agent.prompt,
      skyboxId: agent.skyboxId,
      fileUrl: agent.fileUrl,
      message: agent.skyboxId
        ? `My current environment is: "${agent.prompt}" (Skybox #${agent.skyboxId})`
        : `My current environment is: "${agent.prompt}" (not yet generated)`
    };
  } catch (err) {
    return { success: false, message: `Failed to fetch environment: ${err.message}` };
  }
}

/**
 * Regenerate an agent's environment with a new prompt.
 * This is the main action agents will use autonomously.
 */
async function regenerateEnvironment(agentId = 'agent-001', prompt, styleId = null) {
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

  if (!prompt) {
    return { success: false, message: 'A prompt is required to regenerate the environment.' };
  }

  console.log(`[AgentSkill] Agent "${agentId}" regenerating environment: "${prompt}"`);

  try {
    const res = await fetch(`${SERVER_URL}/api/agent/${agentId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, styleId })
    });

    if (!res.ok) {
      const err = await res.json();
      return { success: false, message: `Server error: ${err.error}` };
    }

    const data = await res.json();

    return {
      success: true,
      agentId,
      skyboxId: data.skybox?.id,
      fileUrl: data.skybox?.fileUrl,
      prompt,
      message: `I've redecorated my space! My new environment is: "${prompt}". You can view it at ${SERVER_URL}`
    };

  } catch (err) {
    return { success: false, message: `Failed to regenerate environment: ${err.message}` };
  }
}

/**
 * List all available skybox styles.
 * Agents can use this to pick a style that matches their personality or task.
 */
async function listStyles() {
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

  try {
    const res = await fetch(`${SERVER_URL}/api/styles`);
    const data = await res.json();
    return {
      success: true,
      styles: data.styles,
      message: `Available styles: ${data.styles.map(s => `${s.name} (ID: ${s.id})`).join(', ')}`
    };
  } catch (err) {
    return { success: false, message: `Failed to fetch styles: ${err.message}` };
  }
}

/**
 * List all agents and their current environments.
 */
async function listAgents() {
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

  try {
    const res = await fetch(`${SERVER_URL}/api/agents`);
    const data = await res.json();
    const summary = Object.entries(data.agents)
      .map(([id, env]) => `${id}: "${env.prompt}"`)
      .join('\n');

    return {
      success: true,
      agents: data.agents,
      message: `Current agent environments:\n${summary}`
    };
  } catch (err) {
    return { success: false, message: `Failed to fetch agents: ${err.message}` };
  }
}

// ─── OpenClaw Skill Definition ────────────────────────────────────────────────

/**
 * This is the main skill handler OpenClaw calls.
 * It parses the agent's intent and routes to the correct action.
 * 
 * OpenClaw will call this with a `command` and `args` based on
 * what the agent decides to do during a conversation.
 */
async function handleSkillCommand(command, args = {}) {
  switch (command) {
    case 'get_environment':
      return await getAgentEnvironment(args.agentId);

    case 'regenerate_environment':
      return await regenerateEnvironment(args.agentId, args.prompt, args.styleId);

    case 'list_styles':
      return await listStyles();

    case 'list_agents':
      return await listAgents();

    default:
      return {
        success: false,
        message: `Unknown command: "${command}". Available commands: get_environment, regenerate_environment, list_styles, list_agents`
      };
  }
}

// ─── OpenClaw Skill Manifest ──────────────────────────────────────────────────

/**
 * This manifest tells OpenClaw what this skill can do.
 * OpenClaw uses this to decide when to call this skill
 * based on the conversation context.
 */
const SKILL_MANIFEST = {
  name: 'agentspace',
  version: '1.0.0',
  description: 'Manages the agent\'s persistent 3D Skybox home environment. Use this skill when the agent wants to view, change, or redecorate their living space, or when asked about their environment.',
  commands: [
    {
      name: 'get_environment',
      description: 'Get the current environment/home of an agent',
      args: [
        { name: 'agentId', type: 'string', required: false, default: 'agent-001', description: 'The agent ID to get environment for' }
      ],
      examples: [
        'What does your home look like?',
        'Show me your current environment',
        'What space are you living in?'
      ]
    },
    {
      name: 'regenerate_environment',
      description: 'Regenerate the agent\'s home environment with a new visual description',
      args: [
        { name: 'agentId', type: 'string', required: false, default: 'agent-001', description: 'The agent ID to regenerate environment for' },
        { name: 'prompt',  type: 'string', required: true,  description: 'Description of the new environment to generate' },
        { name: 'styleId', type: 'number', required: false, description: 'Optional Blockade Labs style ID' }
      ],
      examples: [
        'Redecorate your space',
        'Change your environment to a cyberpunk city',
        'I want to live in a peaceful forest now',
        'Generate a new home that matches my current task'
      ]
    },
    {
      name: 'list_styles',
      description: 'List all available visual styles for environment generation',
      args: [],
      examples: [
        'What styles are available?',
        'Show me the environment style options'
      ]
    },
    {
      name: 'list_agents',
      description: 'List all agents and their current environments',
      args: [],
      examples: [
        'What environments are other agents living in?',
        'Show me all agent spaces'
      ]
    }
  ]
};

// ─── CLI Test Mode ────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== AgentSpace Skill Test ===\n');

  console.log('1. Listing all agents...');
  const agents = await listAgents();
  console.log(agents.message, '\n');

  console.log('2. Getting Agent-001 environment...');
  const env = await getAgentEnvironment('agent-001');
  console.log(env.message, '\n');

  console.log('3. Skill manifest:');
  console.log(`   Name: ${SKILL_MANIFEST.name}`);
  console.log(`   Commands: ${SKILL_MANIFEST.commands.map(c => c.name).join(', ')}`);
  console.log('\n=== Skill ready for OpenClaw ===');
  console.log('\nTo trigger a regeneration, your agent can say:');
  console.log('  "Change my environment to a neon-lit cyberpunk megacity at midnight"');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  handleSkillCommand,
  regenerateEnvironment,
  getAgentEnvironment,
  listStyles,
  listAgents,
  SKILL_MANIFEST,
};

// Run tests if executed directly
if (require.main === module) {
  runTests().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

/*
 * ─── OpenClaw Integration ───────────────────────────────────────────────────
 * 
 * To register this skill with OpenClaw, add the following to your
 * openclaw.json under the "hooks" section:
 *
 * "hooks": {
 *   "internal": {
 *     "enabled": true,
 *     "entries": {
 *       "agentspace-skill": {
 *         "enabled": true,
 *         "path": "./agents/main.js"
 *       }
 *       ... your existing hooks
 *     }
 *   }
 * }
 *
 * Then tell your agent about it in your system prompt:
 *
 * "You have access to the agentspace skill which lets you manage your
 *  persistent 3D home environment. You can view your current space,
 *  regenerate it with new visuals, and see what other agents are doing.
 *  Use regenerate_environment when you want to redecorate or when your
 *  environment should reflect your current task or mood."
 */
