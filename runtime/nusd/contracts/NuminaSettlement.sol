// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Numina NUSD token settlement candidate.
/// @notice Moves an existing NUSD token balance from the caller to an explicit recipient.
/// No issuance, USD/USDC conversion, bank deposit, reserve verification or fiat redemption.
/// @dev The constructor token identity must be independently checked before deployment.
/// Custom code has not received an independent security audit.
contract NuminaSettlement is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable nusd;

    struct Settlement {
        address recipient;
        uint256 amount;
        bool completed;
    }
    mapping(address payer => mapping(bytes32 operationId => Settlement)) public settlements;

    error InvalidToken();
    error InvalidSettlement();
    error OperationMutation(address payer, bytes32 operationId);
    error InexactTokenReceipt(uint256 expected, uint256 beforeBalance, uint256 afterBalance);

    event Settled(address indexed payer, bytes32 indexed operationId, address indexed recipient, uint256 amount);

    constructor(address nusdToken) {
        if (nusdToken == address(0) || nusdToken.code.length == 0) revert InvalidToken();
        nusd = IERC20(nusdToken);
    }

    /// @notice An exact retry returns its existing result without another token movement or event.
    /// @dev IDs are scoped to the caller. Failed transfers leave no completed record; all effects revert.
    /// Amounts are the configured token's base units, not a declared valuation or external asset balance.
    function settle(bytes32 operationId, address recipient, uint256 amount)
        external nonReentrant returns (Settlement memory) {
        if (operationId == bytes32(0) || recipient == address(0) || recipient == msg.sender ||
            recipient == address(this) || amount == 0) revert InvalidSettlement();
        Settlement storage previous = settlements[msg.sender][operationId];
        if (previous.completed) {
            if (previous.recipient != recipient || previous.amount != amount) {
                revert OperationMutation(msg.sender, operationId);
            }
            return previous;
        }

        uint256 beforeBalance = nusd.balanceOf(recipient);
        nusd.safeTransferFrom(msg.sender, recipient, amount);
        uint256 afterBalance = nusd.balanceOf(recipient);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {
            revert InexactTokenReceipt(amount, beforeBalance, afterBalance);
        }
        previous.recipient = recipient;
        previous.amount = amount;
        previous.completed = true;
        emit Settled(msg.sender, operationId, recipient, amount);
        return previous;
    }
}
