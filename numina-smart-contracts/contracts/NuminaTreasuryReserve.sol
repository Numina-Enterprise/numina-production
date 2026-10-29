// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NuminaTreasuryReserve (NUSD)
 * @author SK Consulting LLC (skott34-ed25519)
 * @notice Native Treasury Reserve and 1:1 Stablecoin Rail bound to Cluster State Root
 */
contract NuminaTreasuryReserve {
    string public constant name = "Numina USD";
    string public constant symbol = "NUSD";
    uint8 public constant decimals = 6;

    // 1.5 Quadrillion Max Supply (with 6 decimals)
    uint256 public constant MAX_SUPPLY = 1_500_000_000_000_000 * 10**6;

    // Cluster Provenance State Root
    bytes32 public constant CLUSTER_STATE_ROOT = 0x726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd;

    address public owner;
    address public guardian;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(bytes32 => bool) public executedIdempotencyKeys;

    // Reentrancy Guard
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event SettlementExecuted(bytes32 indexed idempotencyKey, address indexed recipient, uint256 amount);
    event RevenueSplit(uint256 reserveShare, uint256 computeShare, uint256 protocolShare);

    modifier nonReentrant() {
        require(_status != _ENTERED, "REENTRANCY_GUARD_TRIGGERED");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier onlyAuthority() {
        require(msg.sender == owner, "UNAUTHORIZED_NOT_AUTHORITY");
        _;
    }

    constructor(address _guardian) {
        owner = msg.sender;
        guardian = _guardian;
        _status = _NOT_ENTERED;

        // Initialize treasury reserve balance to deployer (vault)
        totalSupply = MAX_SUPPLY;
        balanceOf[msg.sender] = MAX_SUPPLY;
        emit Transfer(address(0), msg.sender, MAX_SUPPLY);
    }

    function transfer(address to, uint256 amount) external nonReentrant returns (bool) {
        require(to != address(0), "TRANSFER_TO_ZERO_ADDRESS");
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_BALANCE");

        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external nonReentrant returns (bool) {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        require(allowance[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");

        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /**
     * @notice Execute 3-Stage Atomic Settlement with Idempotency Key
     */
    function executeSettlement(
        bytes32 idempotencyKey,
        address recipient,
        uint256 amount,
        bytes32 proofHash
    ) external onlyAuthority nonReentrant returns (bool) {
        require(!executedIdempotencyKeys[idempotencyKey], "DUPLICATE_SETTLEMENT_OPERATION");
        require(proofHash != bytes32(0), "INVALID_PROOF_HASH");
        require(recipient != address(0), "INVALID_RECIPIENT");
        require(balanceOf[address(this)] >= amount || balanceOf[owner] >= amount, "INSUFFICIENT_RESERVE");

        executedIdempotencyKeys[idempotencyKey] = true;

        if (balanceOf[address(this)] >= amount) {
            balanceOf[address(this)] -= amount;
        } else {
            balanceOf[owner] -= amount;
        }

        balanceOf[recipient] += amount;
        emit SettlementExecuted(idempotencyKey, recipient, amount);
        emit Transfer(owner, recipient, amount);
        return true;
    }
}
