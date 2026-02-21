// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentSpaceRegistry
 * @notice On-chain registry that pairs ERC-8004 agent identities with
 *         mutable 3-D environment state (skybox prompt, generation URL,
 *         regen counter) and a delegated controller model.
 */

interface IERC8004Registry {
    function register(string calldata agentURI, bytes calldata data)
        external
        returns (uint256 agentId);

    function ownerOf(uint256 agentId) external view returns (address);
}

contract AgentSpaceRegistry {
    // ─── Types ───────────────────────────────────────────────────────────────────

    struct AgentEnvironment {
        string  agentId;
        uint256 erc8004TokenId;
        string  environmentPrompt;
        uint256 skyboxJobId;
        string  skyboxUrl;
        uint256 totalRegens;
        bool    isActive;
    }

    // ─── Events ──────────────────────────────────────────────────────────────────

    event AgentRegistered(
        uint256 indexed erc8004TokenId,
        address indexed owner,
        string  agentId,
        string  agentURI
    );

    event EnvironmentUpdated(
        uint256 indexed erc8004TokenId,
        string  agentId,
        string  newPrompt,
        uint256 skyboxJobId,
        string  skyboxUrl,
        uint256 timestamp
    );

    event ControllerUpdated(
        uint256 indexed erc8004TokenId,
        address indexed controller
    );

    event AgentStatusChanged(
        uint256 indexed erc8004TokenId,
        string  agentId,
        bool    isActive
    );

    // ─── State ───────────────────────────────────────────────────────────────────

    IERC8004Registry public immutable erc8004Registry;

    mapping(uint256 => AgentEnvironment) private _agents;
    mapping(uint256 => address)          private _owners;
    mapping(uint256 => address)          public  controllers;
    mapping(string  => uint256)          public  agentIdToToken;
    mapping(address => uint256[])         private _ownerTokens;

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(address _erc8004Registry) {
        erc8004Registry = IERC8004Registry(_erc8004Registry);
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyOwnerOrController(uint256 tokenId) {
        require(
            msg.sender == _owners[tokenId] || msg.sender == controllers[tokenId],
            "AgentSpaceRegistry: not owner or controller"
        );
        _;
    }

    modifier onlyNFTOwner(uint256 tokenId) {
        require(
            msg.sender == _owners[tokenId],
            "AgentSpaceRegistry: only NFT owner can set controller"
        );
        _;
    }

    modifier agentExists(uint256 tokenId) {
        require(
            bytes(_agents[tokenId].agentId).length > 0,
            "AgentSpaceRegistry: agent not registered in AgentSpace"
        );
        _;
    }

    // ─── Registration ────────────────────────────────────────────────────────────

    function registerAgent(
        string calldata agentId,
        string calldata agentURI,
        string calldata initialPrompt,
        address _controller
    ) external returns (uint256 tokenId) {
        require(bytes(agentId).length > 0,       "AgentSpaceRegistry: empty agentId");
        require(bytes(agentURI).length > 0,      "AgentSpaceRegistry: empty agentURI");
        require(bytes(initialPrompt).length > 0, "AgentSpaceRegistry: empty prompt");
        require(agentIdToToken[agentId] == 0,    "AgentSpaceRegistry: agentId taken");

        tokenId = erc8004Registry.register(agentURI, "");

        _agents[tokenId] = AgentEnvironment({
            agentId:           agentId,
            erc8004TokenId:    tokenId,
            environmentPrompt: initialPrompt,
            skyboxJobId:       0,
            skyboxUrl:         "",
            totalRegens:       0,
            isActive:          true
        });

        _owners[tokenId]           = msg.sender;
        controllers[tokenId]       = _controller;
        agentIdToToken[agentId]    = tokenId;
        _ownerTokens[msg.sender].push(tokenId);

        emit AgentRegistered(tokenId, msg.sender, agentId, agentURI);
    }

    // ─── Environment ─────────────────────────────────────────────────────────────

    function updateEnvironment(
        uint256 tokenId,
        string calldata newPrompt,
        uint256 _skyboxJobId,
        string calldata _skyboxUrl
    ) external agentExists(tokenId) onlyOwnerOrController(tokenId) {
        require(bytes(newPrompt).length > 0,  "AgentSpaceRegistry: empty prompt");
        require(bytes(_skyboxUrl).length > 0, "AgentSpaceRegistry: empty skyboxUrl");

        AgentEnvironment storage agent = _agents[tokenId];
        agent.environmentPrompt = newPrompt;
        agent.skyboxJobId       = _skyboxJobId;
        agent.skyboxUrl         = _skyboxUrl;
        agent.totalRegens      += 1;

        emit EnvironmentUpdated(
            tokenId,
            agent.agentId,
            newPrompt,
            _skyboxJobId,
            _skyboxUrl,
            block.timestamp
        );
    }

    // ─── Controller ──────────────────────────────────────────────────────────────

    function setController(uint256 tokenId, address newController)
        external
        onlyNFTOwner(tokenId)
    {
        controllers[tokenId] = newController;
        emit ControllerUpdated(tokenId, newController);
    }

    // ─── Status ──────────────────────────────────────────────────────────────────

    function setAgentStatus(uint256 tokenId, bool _isActive)
        external
        agentExists(tokenId)
        onlyOwnerOrController(tokenId)
    {
        _agents[tokenId].isActive = _isActive;
        emit AgentStatusChanged(tokenId, _agents[tokenId].agentId, _isActive);
    }

    // ─── Views ───────────────────────────────────────────────────────────────────

    function getAgent(uint256 tokenId)
        external
        view
        returns (AgentEnvironment memory)
    {
        return _agents[tokenId];
    }

    function getAgentByStringId(string calldata agentId)
        external
        view
        returns (AgentEnvironment memory)
    {
        uint256 tokenId = agentIdToToken[agentId];
        require(tokenId != 0, "AgentSpaceRegistry: agent not found");
        return _agents[tokenId];
    }

    function getTokensByOwner(address owner)
        external
        view
        returns (uint256[] memory)
    {
        return _ownerTokens[owner];
    }

    function getVotingWeight(uint256 tokenId)
        external
        view
        returns (uint256)
    {
        AgentEnvironment storage agent = _agents[tokenId];
        if (!agent.isActive) return 0;
        return 1 + (agent.totalRegens / 10);
    }
}
