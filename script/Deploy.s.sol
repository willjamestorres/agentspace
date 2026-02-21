// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {AgentSpaceRegistry} from "../src/AgentSpaceRegistry.sol";

contract Deploy is Script {
    // ERC-8004 production address (same on all chains)
    address constant ERC8004 = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        AgentSpaceRegistry registry = new AgentSpaceRegistry(ERC8004);
        
        vm.stopBroadcast();
    }
}