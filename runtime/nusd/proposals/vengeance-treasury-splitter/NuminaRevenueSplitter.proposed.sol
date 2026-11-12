// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NuminaRevenueSplitter (proposed hardening)
 * @notice PROPOSED SOURCE ONLY. This file does not replace
 *         numina-smart-contracts/contracts/NuminaRevenueSplitter.sol.
 *         It was not compiled, deployed, or bytecode-compared here.
 * @dev Retains 70/20/10. Integer division remainder stays with protocol.
 *      Inbound native value is escrowed. It is not forwarded.
 */
contract NuminaRevenueSplitter {
    address public immutable treasuryReserveVault;
    address public immutable agentStakingPool;
    address public immutable protocolGovernance;
    address public immutable distributor;

    uint256 public constant RESERVE_BPS = 7000;
    uint256 public constant STAKING_BPS = 2000;
    uint256 public constant PROTOCOL_BPS = 1000;
    uint256 public constant TOTAL_BPS = 10000;

    uint256 public escrowed;
    uint256 public totalClaimable;
    bool public distributionEnabled;
    mapping(address => uint256) public claimable;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event RevenueReceived(address indexed payer, uint256 amount);
    event RevenueDistributed(uint256 totalAmount, uint256 reserveShare, uint256 stakingShare, uint256 protocolShare);
    event RevenueClaimed(address indexed account, uint256 amount);
    event DistributionEnabled(address indexed distributor);
    event DistributionDisabled(address indexed caller);

    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANCY_GUARD_TRIGGERED");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyDistributor() {
        require(msg.sender == distributor, "UNAUTHORIZED_NOT_DISTRIBUTOR");
        _;
    }

    constructor(
        address _treasuryReserveVault,
        address _agentStakingPool,
        address _protocolGovernance,
        address _distributor
    ) {
        require(_treasuryReserveVault != address(0), "INVALID_RESERVE_VAULT");
        require(_agentStakingPool != address(0), "INVALID_STAKING_POOL");
        require(_protocolGovernance != address(0), "INVALID_GOVERNANCE");
        require(_distributor != address(0), "INVALID_DISTRIBUTOR");
        require(_treasuryReserveVault != address(this) && _agentStakingPool != address(this) &&
            _protocolGovernance != address(this) && _distributor != address(this), "RECIPIENT_IS_SPLITTER");
        require(RESERVE_BPS + STAKING_BPS + PROTOCOL_BPS == TOTAL_BPS, "BPS_NOT_CONSERVED");
        treasuryReserveVault = _treasuryReserveVault;
        agentStakingPool = _agentStakingPool;
        protocolGovernance = _protocolGovernance;
        distributor = _distributor;
        _status = _NOT_ENTERED;
    }

    /// @notice Preparation only. Value stays in this contract.
    receive() external payable {
        require(msg.value > 0, "ZERO_REVENUE");
        escrowed += msg.value;
        emit RevenueReceived(msg.sender, msg.value);
    }

    function enableDistribution() external onlyDistributor returns (bool) {
        distributionEnabled = true;
        emit DistributionEnabled(msg.sender);
        return true;
    }

    function disableDistribution() external returns (bool) {
        require(msg.sender == distributor || msg.sender == protocolGovernance, "UNAUTHORIZED_NOT_DISTRIBUTOR");
        require(distributionEnabled, "DISTRIBUTION_DISABLED");
        distributionEnabled = false;
        emit DistributionDisabled(msg.sender);
        return true;
    }

    /// @notice Accounts a previously escrowed amount. Does not transfer native value.
    function executeDistribution(uint256 amount) external onlyDistributor nonReentrant returns (bool) {
        require(distributionEnabled, "DISTRIBUTION_DISABLED");
        require(amount > 0 && amount <= escrowed, "AMOUNT_EXCEEDS_ESCROW");
        uint256 reserveShare = (amount * RESERVE_BPS) / TOTAL_BPS;
        uint256 stakingShare = (amount * STAKING_BPS) / TOTAL_BPS;
        uint256 protocolShare = amount - reserveShare - stakingShare;
        require(reserveShare + stakingShare + protocolShare == amount, "SPLIT_NOT_CONSERVED");
        escrowed -= amount;
        totalClaimable += amount;
        claimable[treasuryReserveVault] += reserveShare;
        claimable[agentStakingPool] += stakingShare;
        claimable[protocolGovernance] += protocolShare;
        emit RevenueDistributed(amount, reserveShare, stakingShare, protocolShare);
        return true;
    }

    /// @notice A creditor pulls its own accounted share. State is reduced before the call.
    function claim() external nonReentrant returns (bool) {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "ZERO_CLAIM");
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "CLAIM_TRANSFER_FAILED");
        emit RevenueClaimed(msg.sender, amount);
        return true;
    }
}
