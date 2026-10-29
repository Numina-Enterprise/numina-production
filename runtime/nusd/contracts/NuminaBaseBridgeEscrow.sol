// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Locks 18-decimal NUSD on Numina for a corresponding Base USDC release.
/// This contract never mints USDC and cannot verify Base by itself.
contract NuminaBaseBridgeEscrow is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant PARTICIPANT_ROLE = keccak256("PARTICIPANT_ROLE");
    uint256 public constant BASE_CHAIN_ID = 8453;
    uint256 public constant NUSD_PER_USDC_BASE_UNIT = 1_000_000_000_000;
    IERC20 public immutable nusd;

    enum Status { None, Pending, Released, Failed, Refunded }
    struct Deposit {
        address sender;
        address baseRecipient;
        uint256 nusdAmount;
        uint256 usdcAmount;
        bytes32 baseTxHash;
        Status status;
    }
    mapping(bytes32 operationId => Deposit) public deposits;

    error InvalidConfiguration();
    error InvalidOperation();
    error OperationMutation();
    error InexactTransfer();
    error InvalidState();

    event Locked(bytes32 indexed operationId, address indexed sender, address indexed baseRecipient,
        uint256 nusdAmount, uint256 usdcAmount, uint256 destinationChainId);
    event BaseReleaseAttested(bytes32 indexed operationId, bytes32 indexed baseTxHash);
    event Failed(bytes32 indexed operationId, bytes32 indexed evidenceHash);
    event Refunded(bytes32 indexed operationId, address indexed sender, uint256 nusdAmount);

    constructor(address nusdToken, address admin, address operator, address pauser, uint48 adminDelaySeconds)
        AccessControlDefaultAdminRules(adminDelaySeconds, admin) {
        if (nusdToken.code.length == 0 || IERC20Metadata(nusdToken).decimals() != 18 ||
            admin == address(0) || operator == address(0) || pauser == address(0)) revert InvalidConfiguration();
        nusd = IERC20(nusdToken);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(PAUSER_ROLE, pauser);
        _pause();
    }

    function quoteUsdc(uint256 nusdAmount) public pure returns (uint256) {
        if (nusdAmount == 0 || nusdAmount % NUSD_PER_USDC_BASE_UNIT != 0) revert InvalidOperation();
        return nusdAmount / NUSD_PER_USDC_BASE_UNIT;
    }
    function lock(bytes32 operationId, uint256 nusdAmount, address baseRecipient)
        external onlyRole(PARTICIPANT_ROLE) whenNotPaused nonReentrant returns (Deposit memory) {
        if (operationId == bytes32(0) || baseRecipient == address(0)) revert InvalidOperation();
        uint256 usdcAmount = quoteUsdc(nusdAmount);
        Deposit storage d = deposits[operationId];
        if (d.status != Status.None) {
            if (d.sender != msg.sender || d.baseRecipient != baseRecipient ||
                d.nusdAmount != nusdAmount || d.usdcAmount != usdcAmount) revert OperationMutation();
            return d;
        }
        uint256 beforeBalance = nusd.balanceOf(address(this));
        nusd.safeTransferFrom(msg.sender, address(this), nusdAmount);
        uint256 afterBalance = nusd.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != nusdAmount) revert InexactTransfer();
        d.sender = msg.sender;
        d.baseRecipient = baseRecipient;
        d.nusdAmount = nusdAmount;
        d.usdcAmount = usdcAmount;
        d.status = Status.Pending;
        emit Locked(operationId, msg.sender, baseRecipient, nusdAmount, usdcAmount, BASE_CHAIN_ID);
        return d;
    }

    function attestBaseRelease(bytes32 operationId, bytes32 baseTxHash)
        external onlyRole(OPERATOR_ROLE) nonReentrant {
        Deposit storage d = deposits[operationId];
        if (d.status == Status.Released && d.baseTxHash == baseTxHash) return;
        if (d.status != Status.Pending || baseTxHash == bytes32(0)) revert InvalidState();
        d.baseTxHash = baseTxHash;
        d.status = Status.Released;
        emit BaseReleaseAttested(operationId, baseTxHash);
    }

    function attestFailure(bytes32 operationId, bytes32 evidenceHash)
        external onlyRole(OPERATOR_ROLE) whenPaused {
        Deposit storage d = deposits[operationId];
        if (d.status != Status.Pending || evidenceHash == bytes32(0)) revert InvalidState();
        d.baseTxHash = evidenceHash;
        d.status = Status.Failed;
        emit Failed(operationId, evidenceHash);
    }

    function refund(bytes32 operationId) external whenPaused nonReentrant {
        Deposit storage d = deposits[operationId];
        if (d.status != Status.Failed || d.sender != msg.sender) revert InvalidState();
        d.status = Status.Refunded;
        uint256 beforeBalance = nusd.balanceOf(msg.sender);
        nusd.safeTransfer(msg.sender, d.nusdAmount);
        uint256 afterBalance = nusd.balanceOf(msg.sender);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != d.nusdAmount) revert InexactTransfer();
        emit Refunded(operationId, msg.sender, d.nusdAmount);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
