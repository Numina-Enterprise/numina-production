// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract NusdBridgeEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable nusd;
    uint256 public nextNonce = 1;

    struct Lock {
        address sender;
        address recipient;
        uint256 nusdAmount;
        uint256 usdcAmount;
        bytes32 messageHash;
    }

    mapping(uint256 => Lock) public locks;

    event NusdLocked(
        uint256 indexed nonce,
        address indexed sender,
        address indexed recipient,
        uint256 nusdAmount,
        uint256 usdcAmount,
        uint256 destinationChainId,
        bytes32 messageHash
    );

    error InvalidOperation();
    error InexactTransfer();

    constructor(address nusdToken) {
        if (nusdToken == address(0) || nusdToken.code.length == 0) revert InvalidOperation();
        nusd = IERC20(nusdToken);
    }

    function lockForBase(address recipient, uint256 nusdAmount)
        external
        nonReentrant
        returns (uint256 nonce, bytes32 messageHash)
    {
        if (recipient == address(0) || nusdAmount == 0 || nusdAmount % 1e12 != 0) revert InvalidOperation();
        uint256 usdcAmount = nusdAmount / 1e12;
        nonce = nextNonce++;
        messageHash = keccak256(abi.encode(
            block.chainid,
            address(this),
            nonce,
            msg.sender,
            recipient,
            nusdAmount,
            usdcAmount,
            uint256(8453)
        ));

        uint256 beforeBalance = nusd.balanceOf(address(this));
        nusd.safeTransferFrom(msg.sender, address(this), nusdAmount);
        uint256 afterBalance = nusd.balanceOf(address(this));
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != nusdAmount) revert InexactTransfer();

        locks[nonce] = Lock(msg.sender, recipient, nusdAmount, usdcAmount, messageHash);
        emit NusdLocked(nonce, msg.sender, recipient, nusdAmount, usdcAmount, 8453, messageHash);
    }
}
