// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/// @title Numina USD — an unissued contract candidate, not evidence of USD reserves.
/// @notice Explicit constructor issuance up to the cap. Starts paused after issuance.
/// No oracle, fiat redemption, bridge, or upgrade proxy.
/// @dev Custom code has not received an independent security audit. A reserve reference is only
/// an issuer assertion linking to off-chain evidence; this contract cannot verify that evidence.
contract NuminaUSD is ERC20, ERC20Burnable, ERC20Capped, ERC20Pausable, AccessControlDefaultAdminRules {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint48 public constant MAX_AUTHORIZATION_LIFETIME = 7 days;

    /// @notice Hash of the approved issuer/terms document. Not an attestation of legal status or backing.
    bytes32 public immutable issuerPolicyHash;
    uint256 public authorizedSupply;

    enum IssuanceStatus { Unused, Authorized, Minted, Cancelled, Expired }
    struct Issuance {
        address recipient;
        uint256 amount;
        uint48 expiresAt;
        IssuanceStatus status;
    }
    mapping(bytes32 reserveReference => Issuance) public issuances;

    error InvalidConfiguration();
    error InvalidIssuance();
    error IssuanceReferenceAlreadyUsed(bytes32 reserveReference);
    error IssuanceNotAuthorized(bytes32 reserveReference);
    error IssuanceExpired(bytes32 reserveReference);
    error IssuanceNotExpired(bytes32 reserveReference);
    error SupplyReservationExceedsCap(uint256 requested, uint256 available);
    error PrivilegedRoleConflict(address account);
    error UnsupportedRole(bytes32 role);
    error NotAuthorizedToCancel(address account);

    event IssuanceAuthorized(bytes32 indexed reserveReference, address indexed recipient, uint256 amount, uint48 expiresAt);
    event IssuanceMinted(bytes32 indexed reserveReference, address indexed recipient, uint256 amount);
    event IssuanceCancelled(bytes32 indexed reserveReference, uint256 amount);
    event IssuanceAuthorizationExpired(bytes32 indexed reserveReference, uint256 amount);

    constructor(
        uint256 supplyCapBaseUnits,
        uint256 initialSupplyBaseUnits,
        address initialRecipient,
        address admin,
        address issuer,
        address minter,
        address pauser,
        uint48 adminDelaySeconds,
        bytes32 approvedIssuerPolicyHash
    ) ERC20("Numina USD", "NUSD") ERC20Capped(supplyCapBaseUnits)
      AccessControlDefaultAdminRules(adminDelaySeconds, admin) {
        if (initialRecipient == address(0) || initialSupplyBaseUnits > supplyCapBaseUnits ||
            approvedIssuerPolicyHash == bytes32(0)) {
            revert InvalidConfiguration();
        }
        issuerPolicyHash = approvedIssuerPolicyHash;
        _grantRole(ISSUER_ROLE, issuer);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(PAUSER_ROLE, pauser);
        // Constructor issuance is explicitly approved in deployment data; it does not consume
        // an issuer/minter authorization or prove reserves. No recipient is inferred.
        // Mint before pausing so all post-construction token movement remains paused.
        if (initialSupplyBaseUnits != 0) _mint(initialRecipient, initialSupplyBaseUnits);
        _pause();
    }

    /// @notice Amounts are integer micro-units: 1 NUSD = 1,000,000 base units.
    /// @dev This denomination does not establish a USD price or redemption right.
    function decimals() public pure override returns (uint8) { return 6; }

    /// @notice An issuer authorizes a bounded issuance after its independent off-chain checks.
    /// @dev Never include personal data or a bank account number in the public reference.
    function authorizeIssuance(bytes32 reserveReference, address recipient, uint256 amount, uint48 expiresAt)
        external onlyRole(ISSUER_ROLE) whenNotPaused {
        if (reserveReference == bytes32(0) || recipient == address(0) || amount == 0 ||
            expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_AUTHORIZATION_LIFETIME) {
            revert InvalidIssuance();
        }
        if (issuances[reserveReference].status != IssuanceStatus.Unused) {
            revert IssuanceReferenceAlreadyUsed(reserveReference);
        }
        uint256 available = cap() - totalSupply() - authorizedSupply;
        if (amount > available) revert SupplyReservationExceedsCap(amount, available);
        authorizedSupply += amount;
        issuances[reserveReference] = Issuance(recipient, amount, expiresAt, IssuanceStatus.Authorized);
        emit IssuanceAuthorized(reserveReference, recipient, amount, expiresAt);
    }

    /// @notice A distinct minter executes the exact recipient/amount approved by the issuer, once.
    function mintAuthorized(bytes32 reserveReference) external onlyRole(MINTER_ROLE) whenNotPaused {
        Issuance storage issuance = issuances[reserveReference];
        if (issuance.status != IssuanceStatus.Authorized) revert IssuanceNotAuthorized(reserveReference);
        if (block.timestamp >= issuance.expiresAt) revert IssuanceExpired(reserveReference);
        issuance.status = IssuanceStatus.Minted;
        authorizedSupply -= issuance.amount;
        _mint(issuance.recipient, issuance.amount);
        emit IssuanceMinted(reserveReference, issuance.recipient, issuance.amount);
    }

    /// @notice Cancels an unexecuted issuance, even during an emergency pause. References remain spent.
    function cancelIssuance(bytes32 reserveReference) external {
        if (!hasRole(ISSUER_ROLE, msg.sender) && !hasRole(PAUSER_ROLE, msg.sender) &&
            !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotAuthorizedToCancel(msg.sender);
        Issuance storage issuance = issuances[reserveReference];
        if (issuance.status != IssuanceStatus.Authorized) revert IssuanceNotAuthorized(reserveReference);
        issuance.status = IssuanceStatus.Cancelled;
        authorizedSupply -= issuance.amount;
        emit IssuanceCancelled(reserveReference, issuance.amount);
    }

    /// @notice Anyone may release a reservation after expiry. It cannot then be reused or minted.
    function expireIssuance(bytes32 reserveReference) external {
        Issuance storage issuance = issuances[reserveReference];
        if (issuance.status != IssuanceStatus.Authorized) revert IssuanceNotAuthorized(reserveReference);
        if (block.timestamp < issuance.expiresAt) revert IssuanceNotExpired(reserveReference);
        issuance.status = IssuanceStatus.Expired;
        authorizedSupply -= issuance.amount;
        emit IssuanceAuthorizationExpired(reserveReference, issuance.amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    /// @notice Governance must review outstanding authorizations before resuming after an incident.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /// @dev Address separation is enforced; independence of people controlling those addresses is not.
    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (role != DEFAULT_ADMIN_ROLE && role != ISSUER_ROLE && role != MINTER_ROLE && role != PAUSER_ROLE) {
            revert UnsupportedRole(role);
        }
        if (account == address(0)) revert InvalidConfiguration();
        if ((role != DEFAULT_ADMIN_ROLE && hasRole(DEFAULT_ADMIN_ROLE, account)) ||
            (role != ISSUER_ROLE && hasRole(ISSUER_ROLE, account)) ||
            (role != MINTER_ROLE && hasRole(MINTER_ROLE, account)) ||
            (role != PAUSER_ROLE && hasRole(PAUSER_ROLE, account))) {
            revert PrivilegedRoleConflict(account);
        }
        return super._grantRole(role, account);
    }

    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Capped, ERC20Pausable) {
        super._update(from, to, value);
    }
}
