// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed 1:1 whole-unit exchange of existing 6-decimal NUSD and 6-decimal USDC on the same chain.
/// Output liquidity must already be held here. No mint, bridge or fiat transfer is performed.
/// @dev Token identity and issuer risks require independent verification. Decimal scaling preserves whole-unit parity
/// but does not authenticate Circle USDC. This candidate is unaudited and starts paused.
contract NuminaUSDCConversion is AccessControlDefaultAdminRules, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes32 public constant LIQUIDITY_ROLE = keccak256("LIQUIDITY_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant PARTICIPANT_ROLE = keccak256("PARTICIPANT_ROLE");
    uint256 public constant RATE_NUMERATOR = 1;
    uint256 public constant RATE_DENOMINATOR = 1;
    uint8 public constant NUSD_DECIMALS = 6;
    uint8 public constant USDC_DECIMALS = 6;
    uint256 public constant NUSD_PER_USDC_BASE_UNIT = 1;
    IERC20 public immutable nusd;
    IERC20 public immutable usdc;

    struct Conversion { bool completed; bool nusdToUsdc; address recipient; uint256 inputAmount; uint256 outputAmount; }
    mapping(address participant => mapping(bytes32 operationId => Conversion)) public conversions;

    error InvalidConfiguration();
    error InvalidOperation();
    error OperationMutation();
    error InsufficientLiquidity();
    error InexactTransfer();
    error UnsupportedRole();
    error RoleConflict();

    event Converted(address indexed participant, bytes32 indexed operationId, address indexed recipient,
        bool nusdToUsdc, uint256 inputAmount, uint256 outputAmount);
    event LiquidityAdded(address indexed token, address indexed provider, uint256 amount);
    event LiquidityRemoved(address indexed token, address indexed recipient, uint256 amount);

    constructor(address nusdToken, address usdcToken, address admin, address liquidityManager,
        address pauser, uint48 adminDelaySeconds)
        AccessControlDefaultAdminRules(adminDelaySeconds, admin) {
        if (nusdToken == usdcToken || nusdToken.code.length == 0 || usdcToken.code.length == 0 ||
            IERC20Metadata(nusdToken).decimals() != NUSD_DECIMALS || IERC20Metadata(usdcToken).decimals() != USDC_DECIMALS) {
            revert InvalidConfiguration();
        }
        nusd = IERC20(nusdToken);
        usdc = IERC20(usdcToken);
        _grantRole(LIQUIDITY_ROLE, liquidityManager);
        _grantRole(PAUSER_ROLE, pauser);
        _pause();
    }

    /// @notice No rounding and no contract fee: 1 whole NUSD exchanges for 1 whole USDC.
    /// @dev Input amounts use the input token's native base units. Both tokens use six decimals, so base-unit parity is exact.
    function quote(bool nusdToUsdc, uint256 inputAmount) public pure returns (uint256 outputAmount) {
        if (inputAmount == 0) revert InvalidOperation();
        if (nusdToUsdc) {
            if (inputAmount % NUSD_PER_USDC_BASE_UNIT != 0) revert InvalidOperation();
            return inputAmount / NUSD_PER_USDC_BASE_UNIT;
        }
        if (inputAmount > type(uint256).max / NUSD_PER_USDC_BASE_UNIT) revert InvalidOperation();
        return inputAmount * NUSD_PER_USDC_BASE_UNIT;
    }

    /// @notice Both transfers succeed atomically, or neither does. IDs belong to the caller.
    function convert(bytes32 operationId, bool nusdToUsdc, uint256 inputAmount, address recipient)
        external onlyRole(PARTICIPANT_ROLE) whenNotPaused nonReentrant returns (Conversion memory) {
        if (operationId == bytes32(0) || inputAmount == 0 || recipient == address(0) || recipient == address(this)) {
            revert InvalidOperation();
        }
        uint256 outputAmount = quote(nusdToUsdc, inputAmount);
        Conversion storage previous = conversions[msg.sender][operationId];
        if (previous.completed) {
            if (previous.nusdToUsdc != nusdToUsdc || previous.inputAmount != inputAmount ||
                previous.outputAmount != outputAmount || previous.recipient != recipient) {
                revert OperationMutation();
            }
            return previous;
        }
        IERC20 input = nusdToUsdc ? nusd : usdc;
        IERC20 output = nusdToUsdc ? usdc : nusd;
        if (output.balanceOf(address(this)) < outputAmount) revert InsufficientLiquidity();
        previous.completed = true;
        previous.nusdToUsdc = nusdToUsdc;
        previous.recipient = recipient;
        previous.inputAmount = inputAmount;
        previous.outputAmount = outputAmount;
        _receiveExact(input, msg.sender, inputAmount);
        _sendExact(output, recipient, outputAmount);
        emit Converted(msg.sender, operationId, recipient, nusdToUsdc, inputAmount, outputAmount);
        return previous;
    }

    /// @notice Liquidity is inventory, not a token mint or proof of backing for all NUSD supply.
    function addLiquidity(bool isUsdc, uint256 amount) external onlyRole(LIQUIDITY_ROLE) nonReentrant {
        if (amount == 0) revert InvalidOperation();
        IERC20 token = isUsdc ? usdc : nusd;
        _receiveExact(token, msg.sender, amount);
        emit LiquidityAdded(address(token), msg.sender, amount);
    }

    /// @notice Only paused inventory can be withdrawn. No outstanding conversion is asynchronous.
    /// Operator withdrawals reduce available liquidity; no guaranteed redemption capacity is implied.
    function removeLiquidity(bool isUsdc, uint256 amount, address recipient)
        external onlyRole(LIQUIDITY_ROLE) whenPaused nonReentrant {
        if (amount == 0 || recipient == address(0) || recipient == address(this)) revert InvalidOperation();
        IERC20 token = isUsdc ? usdc : nusd;
        _sendExact(token, recipient, amount);
        emit LiquidityRemoved(address(token), recipient, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _receiveExact(IERC20 token, address sender, uint256 amount) private {
        uint256 beforeFrom = token.balanceOf(sender); uint256 beforeTo = token.balanceOf(address(this));
        token.safeTransferFrom(sender, address(this), amount);
        uint256 afterFrom = token.balanceOf(sender); uint256 afterTo = token.balanceOf(address(this));
        if (afterFrom > beforeFrom || beforeFrom - afterFrom != amount ||
            afterTo < beforeTo || afterTo - beforeTo != amount) revert InexactTransfer();
    }

    function _sendExact(IERC20 token, address recipient, uint256 amount) private {
        uint256 beforeFrom = token.balanceOf(address(this)); uint256 beforeTo = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        uint256 afterFrom = token.balanceOf(address(this)); uint256 afterTo = token.balanceOf(recipient);
        if (afterFrom > beforeFrom || beforeFrom - afterFrom != amount ||
            afterTo < beforeTo || afterTo - beforeTo != amount) revert InexactTransfer();
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (account == address(0) || account == address(this)) revert InvalidConfiguration();
        if (role != DEFAULT_ADMIN_ROLE && role != LIQUIDITY_ROLE && role != PAUSER_ROLE && role != PARTICIPANT_ROLE) {
            revert UnsupportedRole();
        }
        if (role != PARTICIPANT_ROLE &&
            ((role != DEFAULT_ADMIN_ROLE && hasRole(DEFAULT_ADMIN_ROLE, account)) ||
             (role != LIQUIDITY_ROLE && hasRole(LIQUIDITY_ROLE, account)) ||
             (role != PAUSER_ROLE && hasRole(PAUSER_ROLE, account)))) revert RoleConflict();
        return super._grantRole(role, account);
    }
}
