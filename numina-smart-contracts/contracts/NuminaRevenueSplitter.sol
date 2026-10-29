// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NuminaRevenueSplitter
 * @author SK Consulting LLC
 * @notice Automated revenue distribution rail for merchant processing & computational rewards
 * 70% Reserve Custody (1:1 backing expansion)
 * 20% Autonomous Agent Staking & Compute Pool
 * 10% Protocol Governance & Treasury Maintenance
 */
contract NuminaRevenueSplitter {
    address public immutable treasuryReserveVault;
    address public immutable agentStakingPool;
    address public immutable protocolGovernance;

    uint256 public constant RESERVE_BPS = 7000;  // 70%
    uint256 public constant STAKING_BPS = 2000;  // 20%
    uint256 public constant PROTOCOL_BPS = 1000; // 10%
    uint256 public constant TOTAL_BPS = 10000;

    event RevenueDistributed(uint256 totalAmount, uint256 reserveShare, uint256 stakingShare, uint256 protocolShare);

    constructor(
        address _treasuryReserveVault,
        address _agentStakingPool,
        address _protocolGovernance
    ) {
        require(_treasuryReserveVault != address(0), "INVALID_RESERVE_VAULT");
        require(_agentStakingPool != address(0), "INVALID_STAKING_POOL");
        require(_protocolGovernance != address(0), "INVALID_GOVERNANCE");

        treasuryReserveVault = _treasuryReserveVault;
        agentStakingPool = _agentStakingPool;
        protocolGovernance = _protocolGovernance;
    }

    receive() external payable {
        distributeRevenue();
    }

    function distributeRevenue() public payable {
        uint256 amount = msg.value;
        require(amount > 0, "ZERO_REVENUE");

        uint256 reserveShare = (amount * RESERVE_BPS) / TOTAL_BPS;
        uint256 stakingShare = (amount * STAKING_BPS) / TOTAL_BPS;
        uint256 protocolShare = amount - reserveShare - stakingShare; // exact remainder (zero roundoff loss)

        payable(treasuryReserveVault).transfer(reserveShare);
        payable(agentStakingPool).transfer(stakingShare);
        payable(protocolGovernance).transfer(protocolShare);

        emit RevenueDistributed(amount, reserveShare, stakingShare, protocolShare);
    }
}
