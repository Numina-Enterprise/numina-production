// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INuminaBurnable { function burn(uint256 amount) external; }

/// @notice Escrows NUSD for an operator-handled bank payout at 1 NUSD = 1 USD gross.
/// @dev This contract cannot send USD or verify a bank. A distinct confirmer attests an
/// external outcome; its hash is a reference, not cryptographic proof of bank settlement.
/// No automatic timeout releases a processing claim. Candidate is unaudited and starts paused.
contract NuminaUSDRedemption is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CONFIRMER_ROLE = keccak256("CONFIRMER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant HOLDER_ROLE = keccak256("HOLDER_ROLE");
    uint256 public constant NUSD_UNITS_PER_USD_CENT = 10_000;
    uint256 public constant RATE_NUMERATOR = 1;
    uint256 public constant RATE_DENOMINATOR = 1;
    IERC20 public immutable nusd;
    uint256 public totalEscrowedNusd;

    enum Status { Unused, Requested, Processing, PaidAttested, Refundable, Refunded, Cancelled }
    struct Redemption {
        uint256 amountNusd;
        uint256 usdCents;
        bytes32 destinationCommitment;
        bytes32 paymentReference;
        bytes32 evidenceHash;
        Status status;
    }
    mapping(address holder => mapping(bytes32 operationId => Redemption)) public redemptions;
    mapping(bytes32 paymentReference => bool) public usedPaymentReferences;
    mapping(bytes32 evidenceHash => bool) public usedEvidenceHashes;

    error InvalidConfiguration();
    error InvalidRequest();
    error OperationMutation();
    error InvalidState();
    error ReferenceAlreadyUsed();
    error InexactTokenMovement();
    error UnsupportedRole();
    error RoleConflict();

    event RedemptionRequested(address indexed holder, bytes32 indexed operationId, uint256 amountNusd,
        uint256 usdCents, bytes32 destinationCommitment);
    event PaymentProcessing(address indexed holder, bytes32 indexed operationId, bytes32 indexed paymentReference);
    event BankOutcomeAttested(address indexed holder, bytes32 indexed operationId, bytes32 indexed paymentReference,
        bytes32 evidenceHash, uint256 usdCents, bool paid);
    event TokensReturned(address indexed holder, bytes32 indexed operationId, uint256 amountNusd, Status status);

    constructor(address nusdToken, address admin, address operator, address confirmer,
        address pauser, uint48 adminDelaySeconds)
        AccessControlDefaultAdminRules(adminDelaySeconds, admin) {
        if (nusdToken.code.length == 0 || IERC20Metadata(nusdToken).decimals() != 6) revert InvalidConfiguration();
        nusd = IERC20(nusdToken);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(CONFIRMER_ROLE, confirmer);
        _grantRole(PAUSER_ROLE, pauser);
        _pause();
    }

    /// @notice Rejects sub-cent amounts rather than rounding a holder's claim down.
    function quoteUsdCents(uint256 amountNusd) public pure returns (uint256) {
        if (amountNusd == 0 || amountNusd % NUSD_UNITS_PER_USD_CENT != 0) revert InvalidRequest();
        return amountNusd / NUSD_UNITS_PER_USD_CENT;
    }

    /// @dev Use a salted opaque commitment mapped to validated private bank instructions.
    /// Never put account numbers or personal information directly in on-chain fields.
    function requestRedemption(bytes32 operationId, uint256 amountNusd, bytes32 destinationCommitment)
        external onlyRole(HOLDER_ROLE) whenNotPaused nonReentrant returns (Redemption memory) {
        uint256 cents = quoteUsdCents(amountNusd);
        if (operationId == bytes32(0) || destinationCommitment == bytes32(0)) revert InvalidRequest();
        Redemption storage item = redemptions[msg.sender][operationId];
        if (item.status != Status.Unused) {
            if (item.amountNusd != amountNusd || item.destinationCommitment != destinationCommitment) {
                revert OperationMutation();
            }
            return item;
        }
        item.amountNusd = amountNusd;
        item.usdCents = cents;
        item.destinationCommitment = destinationCommitment;
        item.status = Status.Requested;
        totalEscrowedNusd += amountNusd;
        uint256 beforeFrom = nusd.balanceOf(msg.sender); uint256 beforeTo = nusd.balanceOf(address(this));
        nusd.safeTransferFrom(msg.sender, address(this), amountNusd);
        uint256 afterFrom = nusd.balanceOf(msg.sender); uint256 afterTo = nusd.balanceOf(address(this));
        if (afterFrom > beforeFrom || beforeFrom - afterFrom != amountNusd ||
            afterTo < beforeTo || afterTo - beforeTo != amountNusd) revert InexactTokenMovement();
        emit RedemptionRequested(msg.sender, operationId, amountNusd, cents, destinationCommitment);
        return item;
    }

    /// @notice Holder cancellation is allowed only before the operator starts the bank attempt.
    function cancel(bytes32 operationId) external nonReentrant {
        Redemption storage item = redemptions[msg.sender][operationId];
        if (item.status == Status.Cancelled) return;
        if (item.status != Status.Requested) revert InvalidState();
        _returnTokens(item, operationId, Status.Cancelled);
    }

    /// @notice Records a durable attempt reference before the separate bank submission.
    /// This call does not submit that payment. Its reference must drive the bank adapter's idempotency.
    function beginPayment(address holder, bytes32 operationId, bytes32 paymentReference)
        external onlyRole(OPERATOR_ROLE) whenNotPaused {
        Redemption storage item = redemptions[holder][operationId];
        if (paymentReference == bytes32(0)) revert InvalidRequest();
        if (item.status == Status.Processing && item.paymentReference == paymentReference) return;
        if (item.status != Status.Requested) revert InvalidState();
        if (usedPaymentReferences[paymentReference]) revert ReferenceAlreadyUsed();
        usedPaymentReferences[paymentReference] = true;
        item.paymentReference = paymentReference;
        item.status = Status.Processing;
        emit PaymentProcessing(holder, operationId, paymentReference);
    }

    /// @notice A distinct role records the bank's confirmed final outcome for the exact gross amount.
    /// Paid NUSD is burned only here. Failure makes it refundable; it does not silently cancel a claim.
    /// @dev The confirmer is a trust boundary, not a bank oracle. Do not attest uncertain outcomes,
    /// submission acceptance, pending payments, or an operator's own declaration as bank settlement.
    function attestBankOutcome(address holder, bytes32 operationId, bytes32 paymentReference,
        bytes32 evidenceHash, uint256 usdCents, bool paid)
        external onlyRole(CONFIRMER_ROLE) whenNotPaused nonReentrant {
        Redemption storage item = redemptions[holder][operationId];
        if (paymentReference == bytes32(0) || evidenceHash == bytes32(0) || usdCents != item.usdCents) {
            revert InvalidRequest();
        }
        if ((paid && item.status == Status.PaidAttested) ||
            (!paid && (item.status == Status.Refundable || item.status == Status.Refunded))) {
            if (item.paymentReference != paymentReference || item.evidenceHash != evidenceHash) revert OperationMutation();
            return;
        }
        if (item.status != Status.Processing || item.paymentReference != paymentReference) revert InvalidState();
        if (usedEvidenceHashes[evidenceHash]) revert ReferenceAlreadyUsed();
        usedEvidenceHashes[evidenceHash] = true;
        item.evidenceHash = evidenceHash;
        item.status = paid ? Status.PaidAttested : Status.Refundable;
        if (paid) {
            totalEscrowedNusd -= item.amountNusd;
            uint256 beforeBalance = nusd.balanceOf(address(this)); uint256 beforeSupply = nusd.totalSupply();
            INuminaBurnable(address(nusd)).burn(item.amountNusd);
            uint256 afterBalance = nusd.balanceOf(address(this)); uint256 afterSupply = nusd.totalSupply();
            if (afterBalance > beforeBalance || beforeBalance - afterBalance != item.amountNusd ||
                afterSupply > beforeSupply || beforeSupply - afterSupply != item.amountNusd) revert InexactTokenMovement();
        }
        emit BankOutcomeAttested(holder, operationId, paymentReference, evidenceHash, usdCents, paid);
    }

    /// @notice Revoking holder eligibility or pausing this escrow does not revoke an approved refund.
    /// The underlying token must still permit movement; failed transfers leave the claim intact.
    function claimRefund(bytes32 operationId) external nonReentrant {
        Redemption storage item = redemptions[msg.sender][operationId];
        if (item.status == Status.Refunded) return;
        if (item.status != Status.Refundable) revert InvalidState();
        _returnTokens(item, operationId, Status.Refunded);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _returnTokens(Redemption storage item, bytes32 operationId, Status terminal) private {
        item.status = terminal;
        totalEscrowedNusd -= item.amountNusd;
        uint256 beforeFrom = nusd.balanceOf(address(this)); uint256 beforeTo = nusd.balanceOf(msg.sender);
        nusd.safeTransfer(msg.sender, item.amountNusd);
        uint256 afterFrom = nusd.balanceOf(address(this)); uint256 afterTo = nusd.balanceOf(msg.sender);
        if (afterFrom > beforeFrom || beforeFrom - afterFrom != item.amountNusd ||
            afterTo < beforeTo || afterTo - beforeTo != item.amountNusd) revert InexactTokenMovement();
        emit TokensReturned(msg.sender, operationId, item.amountNusd, terminal);
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (account == address(0) || account == address(this)) revert InvalidConfiguration();
        if (role != DEFAULT_ADMIN_ROLE && role != OPERATOR_ROLE && role != CONFIRMER_ROLE &&
            role != PAUSER_ROLE && role != HOLDER_ROLE) revert UnsupportedRole();
        if (role != HOLDER_ROLE &&
            ((role != DEFAULT_ADMIN_ROLE && hasRole(DEFAULT_ADMIN_ROLE, account)) ||
             (role != OPERATOR_ROLE && hasRole(OPERATOR_ROLE, account)) ||
             (role != CONFIRMER_ROLE && hasRole(CONFIRMER_ROLE, account)) ||
             (role != PAUSER_ROLE && hasRole(PAUSER_ROLE, account)))) revert RoleConflict();
        return super._grantRole(role, account);
    }
}
