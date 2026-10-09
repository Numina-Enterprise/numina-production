// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Releases pre-funded native Base USDC after an authorized Numina lock attestation.
/// This vault never mints USDC and is dedicated to the Stripe Treasury recipient.
contract NuminaBaseUSDCVault is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant RELEASER_ROLE = keccak256("RELEASER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant REQUIRED_CHAIN_ID = 8453;
    address public constant NATIVE_BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant STRIPE_TREASURY = 0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e;

    IERC20 public immutable usdc;

    struct Release {
        bytes32 sourceTxHash;
        uint256 usdcAmount;
        bool completed;
    }
    mapping(bytes32 operationId => Release) public releases;

    error InvalidConfiguration();
    error InvalidOperation();
    error OperationMutation();
    error InsufficientLiquidity();
    error InexactTransfer();

    event Released(bytes32 indexed operationId, bytes32 indexed sourceTxHash,
        address indexed recipient, uint256 usdcAmount);
    constructor(address admin, address releaser, address pauser, uint48 adminDelaySeconds)
        AccessControlDefaultAdminRules(adminDelaySeconds, admin) {
        if (block.chainid != REQUIRED_CHAIN_ID || NATIVE_BASE_USDC.code.length == 0 ||
            IERC20Metadata(NATIVE_BASE_USDC).decimals() != 6 ||
            admin == address(0) || releaser == address(0) || pauser == address(0)) {
            revert InvalidConfiguration();
        }
        usdc = IERC20(NATIVE_BASE_USDC);
        _grantRole(RELEASER_ROLE, releaser);
        _grantRole(PAUSER_ROLE, pauser);
        _pause();
    }

    function release(bytes32 operationId, bytes32 sourceTxHash, uint256 usdcAmount)
        external onlyRole(RELEASER_ROLE) whenNotPaused nonReentrant returns (Release memory) {
        if (operationId == bytes32(0) || sourceTxHash == bytes32(0) || usdcAmount == 0) {
            revert InvalidOperation();
        }
        Release storage previous = releases[operationId];
        if (previous.completed) {
            if (previous.sourceTxHash != sourceTxHash || previous.usdcAmount != usdcAmount) {
                revert OperationMutation();
            }
            return previous;
        }
        if (usdc.balanceOf(address(this)) < usdcAmount) revert InsufficientLiquidity();

        uint256 beforeBalance = usdc.balanceOf(STRIPE_TREASURY);
        previous.sourceTxHash = sourceTxHash;
        previous.usdcAmount = usdcAmount;
        previous.completed = true;
        usdc.safeTransfer(STRIPE_TREASURY, usdcAmount);
        uint256 afterBalance = usdc.balanceOf(STRIPE_TREASURY);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != usdcAmount) {
            revert InexactTransfer();
        }
        emit Released(operationId, sourceTxHash, STRIPE_TREASURY, usdcAmount);
        return previous;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
