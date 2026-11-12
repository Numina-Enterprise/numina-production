// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NuminaTreasuryReserve (proposed hardening)
 * @notice PROPOSED SOURCE ONLY. This file does not replace
 *         numina-smart-contracts/contracts/NuminaTreasuryReserve.sol.
 *         It was not compiled, deployed, or bytecode-compared here.
 * @dev Retains the reference variant: 6 decimals and
 *      MAX_SUPPLY = 1_500_000_000_000_000 * 10**6.
 *      This is not the receipt-bound 18-decimal NuminaUSD source and is not
 *      evidence of reserves, deployment identity, or source equivalence.
 *      The contract does not verify cash, USDC, bank balances, or a 1:1 rail.
 */
contract NuminaTreasuryReserve {
    string public constant name = "Numina USD";
    string public constant symbol = "NUSD";
    uint8 public constant decimals = 6;

    // Retained 6-decimal reference cap. Not rescaled to 18 decimals.
    uint256 public constant MAX_SUPPLY = 1_500_000_000_000_000 * 10**6;

    // Recorded label only. This contract does not read or prove cluster state.
    bytes32 public constant CLUSTER_STATE_ROOT = 0x726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd;

    /// @notice Always false. A name or constant is not external reserve verification.
    bool public constant externalBackingVerified = false;

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 idempotencyKey,address recipient,uint256 amount,bytes32 proofHash,address debitFrom,uint48 deadline)"
    );
    bytes32 private constant ENABLE_TYPEHASH = keccak256(
        "EnableSettlementExecution(uint256 nonce)"
    );
    bytes32 private constant SECP256K1_HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    address public owner;
    address public guardian;
    uint256 public totalSupply;
    uint256 public executionAuthorizationNonce;
    bool public settlementExecutionEnabled;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(bytes32 => bool) public executedIdempotencyKeys;

    struct Preparation {
        address recipient;
        uint256 amount;
        bytes32 proofHash;
        address debitFrom;
        uint48 deadline;
        bool exists;
        bool executed;
        bool cancelled;
    }
    mapping(bytes32 => Preparation) public preparations;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event SettlementPrepared(bytes32 indexed idempotencyKey, address indexed recipient, uint256 amount, address debitFrom);
    event SettlementPreparationCancelled(bytes32 indexed idempotencyKey, address indexed caller);
    event SettlementExecuted(bytes32 indexed idempotencyKey, address indexed recipient, uint256 amount, address debitFrom);
    event SettlementExecutionEnabled(address indexed authority, uint256 nonce);
    event SettlementExecutionDisabled(address indexed caller, uint256 nonce);

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
        require(_guardian != address(0), "INVALID_GUARDIAN");
        require(_guardian != msg.sender, "GUARDIAN_MUST_BE_DISTINCT");
        owner = msg.sender;
        guardian = _guardian;
        _status = _NOT_ENTERED;
        // Retained reference behavior. This mint is not proof of backing.
        totalSupply = MAX_SUPPLY;
        balanceOf[msg.sender] = MAX_SUPPLY;
        emit Transfer(address(0), msg.sender, MAX_SUPPLY);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("NuminaTreasuryReserve")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
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
        require(to != address(0), "TRANSFER_TO_ZERO_ADDRESS");
        require(from != address(0), "TRANSFER_FROM_ZERO_ADDRESS");
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        require(allowance[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /// @notice Records a settlement intent. Does not move balances.
    /// @dev A nonzero proofHash is only a preparation label. It does not authorize execution.
    function prepareSettlement(
        bytes32 idempotencyKey,
        address recipient,
        uint256 amount,
        bytes32 proofHash,
        address debitFrom,
        uint48 deadline
    ) external onlyAuthority returns (bool) {
        Preparation storage existing = preparations[idempotencyKey];
        require(!existing.exists, "DUPLICATE_SETTLEMENT_OPERATION");
        require(recipient != address(0), "INVALID_RECIPIENT");
        require(amount > 0, "ZERO_SETTLEMENT_AMOUNT");
        require(proofHash != bytes32(0), "INVALID_PROOF_HASH");
        require(debitFrom == address(this) || debitFrom == owner, "INVALID_DEBIT_ACCOUNT");
        require(deadline > block.timestamp, "INVALID_DEADLINE");
        preparations[idempotencyKey] = Preparation(
            recipient, amount, proofHash, debitFrom, deadline, true, false, false
        );
        emit SettlementPrepared(idempotencyKey, recipient, amount, debitFrom);
        return true;
    }

    /// @notice Marks a preparation cancelled. Does not move balances or recycle the key.
    function cancelPreparation(bytes32 idempotencyKey) external returns (bool) {
        require(msg.sender == owner || msg.sender == guardian, "UNAUTHORIZED_NOT_PREPARATION_ROLE");
        Preparation storage prep = preparations[idempotencyKey];
        require(prep.exists && !prep.executed && !prep.cancelled, "SETTLEMENT_NOT_CANCELABLE");
        prep.cancelled = true;
        emit SettlementPreparationCancelled(idempotencyKey, msg.sender);
        return true;
    }

    /// @notice Opens the execution path. Guardian must sign this domain-separated action.
    ///         Preparation does not call this function.
    function enableSettlementExecution(uint8 guardianV, bytes32 guardianR, bytes32 guardianS)
        external onlyAuthority returns (bool)
    {
        uint256 nonce = executionAuthorizationNonce;
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator(),
            keccak256(abi.encode(ENABLE_TYPEHASH, nonce))
        ));
        require(_recover(digest, guardianV, guardianR, guardianS) == guardian, "GUARDIAN_SIGNATURE_REQUIRED");
        executionAuthorizationNonce = nonce + 1;
        settlementExecutionEnabled = true;
        emit SettlementExecutionEnabled(msg.sender, nonce);
        return true;
    }

    /// @notice Closes execution and burns the current enablement signature. Does not move balances.
    function disableSettlementExecution() external returns (bool) {
        require(msg.sender == owner || msg.sender == guardian, "UNAUTHORIZED_NOT_PREPARATION_ROLE");
        require(settlementExecutionEnabled, "SETTLEMENT_EXECUTION_DISABLED");
        settlementExecutionEnabled = false;
        uint256 nonce = executionAuthorizationNonce;
        executionAuthorizationNonce = nonce + 1;
        emit SettlementExecutionDisabled(msg.sender, nonce);
        return true;
    }

    /// @notice Executes a previously prepared settlement.
    /// @dev Requires a stored preparation, a live deadline, owner submission, and distinct
    ///      owner and guardian EIP-712 signatures. proofHash is signed as a field; it is not a signature.
    function executeSettlement(
        bytes32 idempotencyKey,
        uint8 guardianV,
        bytes32 guardianR,
        bytes32 guardianS,
        uint8 authorityV,
        bytes32 authorityR,
        bytes32 authorityS
    ) external onlyAuthority nonReentrant returns (bool) {
        require(settlementExecutionEnabled, "SETTLEMENT_EXECUTION_DISABLED");
        Preparation storage prep = preparations[idempotencyKey];
        require(prep.exists && !prep.executed && !prep.cancelled, "SETTLEMENT_NOT_PREPARED");
        require(block.timestamp <= prep.deadline, "SETTLEMENT_DEADLINE_EXPIRED");
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            domainSeparator(),
            keccak256(abi.encode(
                SETTLEMENT_TYPEHASH,
                idempotencyKey,
                prep.recipient,
                prep.amount,
                prep.proofHash,
                prep.debitFrom,
                prep.deadline
            ))
        ));
        require(_recover(digest, guardianV, guardianR, guardianS) == guardian, "GUARDIAN_SIGNATURE_REQUIRED");
        require(_recover(digest, authorityV, authorityR, authorityS) == owner, "AUTHORITY_SIGNATURE_REQUIRED");

        uint256 supplyBefore = totalSupply;
        address debitFrom = prep.debitFrom;
        address recipient = prep.recipient;
        uint256 amount = prep.amount;
        uint256 debitBalance = balanceOf[debitFrom];
        require(debitBalance >= amount, "INSUFFICIENT_RESERVE");
        prep.executed = true;
        executedIdempotencyKeys[idempotencyKey] = true;
        balanceOf[debitFrom] = debitBalance - amount;
        balanceOf[recipient] += amount;
        require(totalSupply == supplyBefore, "SUPPLY_CHANGED");
        emit SettlementExecuted(idempotencyKey, recipient, amount, debitFrom);
        emit Transfer(debitFrom, recipient, amount);
        return true;
    }

    function _recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) private pure returns (address) {
        require(uint256(s) <= uint256(SECP256K1_HALF_N), "INVALID_SIGNATURE");
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "INVALID_SIGNATURE");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "INVALID_SIGNATURE");
        return signer;
    }
}
