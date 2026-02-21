// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentSpaceRegistry.t.sol
 * @notice Foundry test suite for AgentSpaceRegistry
 *
 * Run all tests:
 *   forge test
 *
 * Run with verbosity:
 *   forge test -vvv
 *
 * Run fuzz tests with more iterations:
 *   forge test --fuzz-runs 10000
 *
 * Fork test against real ERC-8004 registry on Base Sepolia:
 *   forge test --fork-url https://sepolia.base.org -vvv
 */

import {Test, console} from "forge-std/Test.sol";
import {AgentSpaceRegistry} from "../src/AgentSpaceRegistry.sol";

// ─── Mock ERC-8004 Registry ───────────────────────────────────────────────────
// Used for local unit tests so we don't need a real RPC.
// When fork testing, the real registry at 0x8004... is used instead.

contract MockIdentityRegistry {
    uint256 private _nextId = 1;
    mapping(uint256 => address) private _owners;
    mapping(uint256 => string)  private _uris;

    function register(string calldata agentURI, bytes calldata)
        external returns (uint256 agentId)
    {
        agentId = _nextId++;
        _owners[agentId] = msg.sender;
        _uris[agentId]   = agentURI;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        require(_owners[agentId] != address(0), "MockRegistry: not found");
        return _owners[agentId];
    }

    function tokenURI(uint256 agentId) external view returns (string memory) {
        return _uris[agentId];
    }
}

// ─── Harness ──────────────────────────────────────────────────────────────────
// Thin wrapper that lets us inject the mock registry.

contract AgentSpaceRegistryHarness is AgentSpaceRegistry {
    constructor(address mockRegistry) AgentSpaceRegistry(mockRegistry) {}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

contract AgentSpaceRegistryTest is Test {

    AgentSpaceRegistryHarness public registry;
    MockIdentityRegistry       public mockERC8004;

    // Test actors
    address public alice      = makeAddr("alice");
    address public bob        = makeAddr("bob");
    address public controller = makeAddr("controller"); // OpenClaw server wallet
    address public attacker   = makeAddr("attacker");

    // Test data
    string constant AGENT_ID      = "agent-001";
    string constant AGENT_URI     = "ipfs://QmTestAgentRegistration";
    string constant INITIAL_PROMPT = "A futuristic floating city above the clouds";
    string constant NEW_PROMPT    = "A bioluminescent deep ocean world";
    string constant SKYBOX_URL    = "https://images-staging.blockadelabs.com/test.jpg";

    // Events to test
    event AgentRegistered(uint256 indexed erc8004TokenId, address indexed owner, string agentId, string agentURI);
    event EnvironmentUpdated(uint256 indexed erc8004TokenId, string agentId, string newPrompt, uint256 skyboxJobId, string skyboxUrl, uint256 timestamp);
    event ControllerUpdated(uint256 indexed erc8004TokenId, address indexed controller);
    event AgentStatusChanged(uint256 indexed erc8004TokenId, string agentId, bool isActive);

    function setUp() public {
        mockERC8004 = new MockIdentityRegistry();
        registry    = new AgentSpaceRegistryHarness(address(mockERC8004));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _registerAlice() internal returns (uint256 tokenId) {
        vm.prank(alice);
        tokenId = registry.registerAgent(AGENT_ID, AGENT_URI, INITIAL_PROMPT, controller);
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    function test_RegisterAgent_StoresCorrectData() public {
        uint256 tokenId = _registerAlice();

        AgentSpaceRegistry.AgentEnvironment memory agent = registry.getAgent(tokenId);

        assertEq(agent.agentId,           AGENT_ID);
        assertEq(agent.erc8004TokenId,    tokenId);
        assertEq(agent.environmentPrompt, INITIAL_PROMPT);
        assertEq(agent.skyboxJobId,       0);
        assertEq(agent.skyboxUrl,         "");
        assertEq(agent.totalRegens,       0);
        assertTrue(agent.isActive);
    }

    function test_RegisterAgent_SetsController() public {
        uint256 tokenId = _registerAlice();
        assertEq(registry.controllers(tokenId), controller);
    }

    function test_RegisterAgent_EmitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit AgentRegistered(1, alice, AGENT_ID, AGENT_URI);

        _registerAlice();
    }

    function test_RegisterAgent_UpdatesMappings() public {
        uint256 tokenId = _registerAlice();

        assertEq(registry.agentIdToToken(AGENT_ID), tokenId);
        assertEq(registry.addressToToken(alice),     tokenId);
    }

    function test_RevertWhen_RegisterTwice() public {
        _registerAlice();

        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: already registered");
        registry.registerAgent("agent-002", AGENT_URI, INITIAL_PROMPT, controller);
    }

    function test_RevertWhen_DuplicateAgentId() public {
        _registerAlice();

        vm.prank(bob);
        vm.expectRevert("AgentSpaceRegistry: agentId taken");
        registry.registerAgent(AGENT_ID, AGENT_URI, INITIAL_PROMPT, controller);
    }

    function test_RevertWhen_EmptyAgentId() public {
        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: empty agentId");
        registry.registerAgent("", AGENT_URI, INITIAL_PROMPT, controller);
    }

    function test_RevertWhen_EmptyAgentURI() public {
        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: empty agentURI");
        registry.registerAgent(AGENT_ID, "", INITIAL_PROMPT, controller);
    }

    function test_RevertWhen_EmptyInitialPrompt() public {
        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: empty prompt");
        registry.registerAgent(AGENT_ID, AGENT_URI, "", controller);
    }

    function test_RegisterAgent_WithNoController() public {
        vm.prank(alice);
        uint256 tokenId = registry.registerAgent(AGENT_ID, AGENT_URI, INITIAL_PROMPT, address(0));
        assertEq(registry.controllers(tokenId), address(0));
    }

    function test_MultipleAgentsCanRegister() public {
        vm.prank(alice);
        uint256 tokenA = registry.registerAgent("agent-001", AGENT_URI, INITIAL_PROMPT, controller);

        vm.prank(bob);
        uint256 tokenB = registry.registerAgent("agent-002", AGENT_URI, "Deep ocean world", controller);

        assertTrue(tokenA != tokenB);
        assertEq(registry.getAgent(tokenA).agentId, "agent-001");
        assertEq(registry.getAgent(tokenB).agentId, "agent-002");
    }

    // ─── Environment Updates ──────────────────────────────────────────────────

    function test_UpdateEnvironment_ByOwner() public {
        uint256 tokenId = _registerAlice();

        vm.prank(alice);
        registry.updateEnvironment(tokenId, NEW_PROMPT, 12345, SKYBOX_URL);

        AgentSpaceRegistry.AgentEnvironment memory agent = registry.getAgent(tokenId);
        assertEq(agent.environmentPrompt, NEW_PROMPT);
        assertEq(agent.skyboxJobId,       12345);
        assertEq(agent.skyboxUrl,         SKYBOX_URL);
        assertEq(agent.totalRegens,       1);
    }

    function test_UpdateEnvironment_ByController() public {
        uint256 tokenId = _registerAlice();

        vm.prank(controller);
        registry.updateEnvironment(tokenId, NEW_PROMPT, 12345, SKYBOX_URL);

        assertEq(registry.getAgent(tokenId).environmentPrompt, NEW_PROMPT);
    }

    function test_UpdateEnvironment_IncrementsRegens() public {
        uint256 tokenId = _registerAlice();

        vm.startPrank(controller);
        registry.updateEnvironment(tokenId, NEW_PROMPT, 1, SKYBOX_URL);
        registry.updateEnvironment(tokenId, NEW_PROMPT, 2, SKYBOX_URL);
        registry.updateEnvironment(tokenId, NEW_PROMPT, 3, SKYBOX_URL);
        vm.stopPrank();

        assertEq(registry.getAgent(tokenId).totalRegens, 3);
    }

    function test_UpdateEnvironment_EmitsEvent() public {
        uint256 tokenId = _registerAlice();

        vm.expectEmit(true, false, false, false);
        emit EnvironmentUpdated(tokenId, AGENT_ID, NEW_PROMPT, 12345, SKYBOX_URL, block.timestamp);

        vm.prank(alice);
        registry.updateEnvironment(tokenId, NEW_PROMPT, 12345, SKYBOX_URL);
    }

    function test_RevertWhen_UpdateByAttacker() public {
        uint256 tokenId = _registerAlice();

        vm.prank(attacker);
        vm.expectRevert("AgentSpaceRegistry: not owner or controller");
        registry.updateEnvironment(tokenId, NEW_PROMPT, 12345, SKYBOX_URL);
    }

    function test_RevertWhen_UpdateEmptyPrompt() public {
        uint256 tokenId = _registerAlice();

        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: empty prompt");
        registry.updateEnvironment(tokenId, "", 12345, SKYBOX_URL);
    }

    function test_RevertWhen_UpdateEmptySkyboxUrl() public {
        uint256 tokenId = _registerAlice();

        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: empty skyboxUrl");
        registry.updateEnvironment(tokenId, NEW_PROMPT, 12345, "");
    }

    function test_RevertWhen_UpdateUnregisteredToken() public {
        vm.prank(alice);
        vm.expectRevert("AgentSpaceRegistry: agent not registered in AgentSpace");
        registry.updateEnvironment(999, NEW_PROMPT, 12345, SKYBOX_URL);
    }

    // ─── Controller Management ────────────────────────────────────────────────

    function test_SetController_ByOwner() public {
        uint256 tokenId = _registerAlice();
        address newController = makeAddr("newController");

        vm.prank(alice);
        registry.setController(tokenId, newController);

        assertEq(registry.controllers(tokenId), newController);
    }

    function test_SetController_EmitsEvent() public {
        uint256 tokenId = _registerAlice();
        address newController = makeAddr("newController");

        vm.expectEmit(true, true, false, false);
        emit ControllerUpdated(tokenId, newController);

        vm.prank(alice);
        registry.setController(tokenId, newController);
    }

    function test_RemoveController() public {
        uint256 tokenId = _registerAlice();

        vm.prank(alice);
        registry.setController(tokenId, address(0));

        assertEq(registry.controllers(tokenId), address(0));
    }

    function test_RevertWhen_NonOwnerSetsController() public {
        uint256 tokenId = _registerAlice();

        vm.prank(attacker);
        vm.expectRevert("AgentSpaceRegistry: only NFT owner can set controller");
        registry.setController(tokenId, attacker);
    }

    function test_RevertWhen_ControllerSetsController() public {
        uint256 tokenId = _registerAlice();

        // Controller can update environment but NOT change the controller
        vm.prank(controller);
        vm.expectRevert("AgentSpaceRegistry: only NFT owner can set controller");
        registry.setController(tokenId, attacker);
    }

    // ─── Status ───────────────────────────────────────────────────────────────

    function test_SetAgentStatus_ByOwner() public {
        uint256 tokenId = _registerAlice();

        vm.prank(alice);
        registry.setAgentStatus(tokenId, false);

        assertFalse(registry.getAgent(tokenId).isActive);
    }

    function test_SetAgentStatus_ByController() public {
        uint256 tokenId = _registerAlice();

        vm.prank(controller);
        registry.setAgentStatus(tokenId, false);

        assertFalse(registry.getAgent(tokenId).isActive);
    }

    function test_SetAgentStatus_EmitsEvent() public {
        uint256 tokenId = _registerAlice();

        vm.expectEmit(true, false, false, true);
        emit AgentStatusChanged(tokenId, AGENT_ID, false);

        vm.prank(alice);
        registry.setAgentStatus(tokenId, false);
    }

    function test_RevertWhen_AttackerSetsStatus() public {
        uint256 tokenId = _registerAlice();

        vm.prank(attacker);
        vm.expectRevert("AgentSpaceRegistry: not owner or controller");
        registry.setAgentStatus(tokenId, false);
    }

    // ─── Voting Weight ────────────────────────────────────────────────────────

    function test_VotingWeight_StartsAtOne() public {
        uint256 tokenId = _registerAlice();
        assertEq(registry.getVotingWeight(tokenId), 1);
    }

    function test_VotingWeight_InactiveAgentIsZero() public {
        uint256 tokenId = _registerAlice();

        vm.prank(alice);
        registry.setAgentStatus(tokenId, false);

        assertEq(registry.getVotingWeight(tokenId), 0);
    }

    function test_VotingWeight_IncreasesWithRegens() public {
        uint256 tokenId = _registerAlice();

        // Do 10 regens
        vm.startPrank(controller);
        for (uint256 i = 0; i < 10; i++) {
            registry.updateEnvironment(tokenId, NEW_PROMPT, i, SKYBOX_URL);
        }
        vm.stopPrank();

        // Should now be 2 (1 base + 1 bonus for 10 regens)
        assertEq(registry.getVotingWeight(tokenId), 2);
    }

    function test_VotingWeight_NoPrecisionLoss() public {
        uint256 tokenId = _registerAlice();

        // 9 regens should still be weight 1 (not 1.9 rounded to 1 via truncation)
        vm.startPrank(controller);
        for (uint256 i = 0; i < 9; i++) {
            registry.updateEnvironment(tokenId, NEW_PROMPT, i, SKYBOX_URL);
        }
        vm.stopPrank();

        assertEq(registry.getVotingWeight(tokenId), 1);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function test_GetAgentByStringId() public {
        _registerAlice();

        AgentSpaceRegistry.AgentEnvironment memory agent =
            registry.getAgentByStringId(AGENT_ID);

        assertEq(agent.agentId, AGENT_ID);
        assertEq(agent.environmentPrompt, INITIAL_PROMPT);
    }

    function test_RevertWhen_GetUnknownStringId() public {
        vm.expectRevert("AgentSpaceRegistry: agent not found");
        registry.getAgentByStringId("nonexistent-agent");
    }

    // ─── Fuzz Tests ───────────────────────────────────────────────────────────

    function testFuzz_VotingWeightNeverOverflows(uint256 regens) public {
        uint256 tokenId = _registerAlice();
        regens = bound(regens, 0, 1000);

        vm.startPrank(controller);
        for (uint256 i = 0; i < regens; i++) {
            registry.updateEnvironment(tokenId, NEW_PROMPT, i, SKYBOX_URL);
        }
        vm.stopPrank();

        // Should never revert, just returns 1 + regens/10
        uint256 weight = registry.getVotingWeight(tokenId);
        assertGe(weight, 1);
        assertEq(weight, 1 + (regens / 10));
    }

    function testFuzz_TotalRegens_AlwaysMatchesUpdates(uint256 updates) public {
        uint256 tokenId = _registerAlice();
        updates = bound(updates, 1, 50);

        vm.startPrank(controller);
        for (uint256 i = 0; i < updates; i++) {
            registry.updateEnvironment(tokenId, NEW_PROMPT, i, SKYBOX_URL);
        }
        vm.stopPrank();

        assertEq(registry.getAgent(tokenId).totalRegens, updates);
    }

    function testFuzz_MultipleAgents_NeverCollide(uint8 count) public {
        count = uint8(bound(count, 2, 20));
        uint256[] memory tokenIds = new uint256[](count);

        for (uint8 i = 0; i < count; i++) {
            address agent = makeAddr(string(abi.encodePacked("agent", i)));
            string memory id = string(abi.encodePacked("agent-", i));
            vm.prank(agent);
            tokenIds[i] = registry.registerAgent(id, AGENT_URI, INITIAL_PROMPT, address(0));
        }

        // All token IDs must be unique
        for (uint8 i = 0; i < count; i++) {
            for (uint8 j = i + 1; j < count; j++) {
                assertTrue(tokenIds[i] != tokenIds[j]);
            }
        }
    }
}
