// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title RevenueVaultV2
 * @notice Permissionless USDT revenue vault. Anyone may deposit (no role gate);
 *         only the owner may withdraw. Emits the same `Deposited(address,uint256)`
 *         event signature as RevenueVault (V1) so the off-chain deposit listener
 *         continues to work unchanged.
 */
contract RevenueVaultV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public usdt;
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    /// @dev Signature-identical to RevenueVault (V1) — do not change indexing/params.
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address _usdt, address _owner) {
        require(_usdt != address(0), "RevenueVaultV2: zero usdt");
        require(_owner != address(0), "RevenueVaultV2: zero owner");
        usdt = IERC20(_usdt);
        _transferOwnership(_owner);
    }

    /// @notice Permissionless deposit — anyone can pay USDT into the vault.
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "RevenueVaultV2: zero deposit");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Owner-only withdraw of vault USDT to an arbitrary address.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "RevenueVaultV2: zero address");
        require(amount > 0, "RevenueVaultV2: zero withdrawal");
        totalWithdrawn += amount;
        usdt.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Current vault USDT balance.
    function vaultBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
