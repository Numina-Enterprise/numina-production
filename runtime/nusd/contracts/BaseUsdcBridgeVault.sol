// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BaseUsdcBridgeVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    IERC20 public immutable usdc;
    uint256 public constant EXPECTED_CHAIN_ID = 8453;
    mapping(bytes32 => bool) public consumedMessages;

    event UsdcReleased(
        bytes32 indexed messageHash,
        uint256 indexed sourceNonce,
        address indexed recipient,
        uint256 usdcAmount
    );

    error InvalidConfiguration();
    error InvalidOperation();
    error WrongChain();
    error InsufficientLiquidity();
    error InexactTransfer();
    error MessageAlreadyConsumed();

    constructor(address usdcToken, address admin, address operator) {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain();
        if (usdcToken == address(0) || usdcToken.code.length == 0 || admin == address(0) || operator == address(0)) {
            revert InvalidConfiguration();
        }
        usdc = IERC20(usdcToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _pause();
    }

    function release(
        uint256 sourceChainId,
        address sourceEscrow,
        uint256 sourceNonce,
        address sourceSender,
        address recipient,
        uint256 nusdAmount,
        uint256 usdcAmount,
        bytes32 messageHash
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused nonReentrant {
        if (sourceChainId != 962421430 || sourceEscrow == address(0) || sourceNonce == 0 ||
            sourceSender == address(0) || recipient == address(0) || nusdAmount == 0 ||
            usdcAmount == 0 || nusdAmount / 1e12 != usdcAmount || nusdAmount % 1e12 != 0) revert InvalidOperation();

        bytes32 expected = keccak256(abi.encode(
            sourceChainId,
            sourceEscrow,
            sourceNonce,
            sourceSender,
            recipient,
            nusdAmount,
            usdcAmount,
            EXPECTED_CHAIN_ID
        ));
        if (expected != messageHash) revert InvalidOperation();
        if (consumedMessages[messageHash]) revert MessageAlreadyConsumed();
        if (usdc.balanceOf(address(this)) < usdcAmount) revert InsufficientLiquidity();

        consumedMessages[messageHash] = true;
        uint256 beforeRecipient = usdc.balanceOf(recipient);
        usdc.safeTransfer(recipient, usdcAmount);
        uint256 afterRecipient = usdc.balanceOf(recipient);
        if (afterRecipient < beforeRecipient || afterRecipient - beforeRecipient != usdcAmount) revert InexactTransfer();

        emit UsdcReleased(messageHash, sourceNonce, recipient, usdcAmount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
