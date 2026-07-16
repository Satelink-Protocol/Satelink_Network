// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title RevenueVaultV2
 * @notice Permissionless USDT revenue vault. ANY wallet may call deposit();
 *         there is no DEPOSITOR_ROLE gate (the reason V1 could not be paid by
 *         autonomous machines). Withdrawals remain owner-only (treasury).
 *
 *         The Deposited(address indexed from, uint256 amount) event signature is
 *         byte-for-byte identical to RevenueVault (V1) so the existing
 *         deposit_listener.js keeps crediting api_credits with no ABI change —
 *         only REVENUE_VAULT_ADDRESS needs to point here.
 *
 *         Deliberately minimal and non-upgradeable: no proxy, no AccessControl,
 *         no pausing. Ownable + ReentrancyGuard + SafeERC20 only.
 */
contract RevenueVaultV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The USDT token this vault custodies. Immutable — set once at deploy.
    IERC20 public immutable usdt;

    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    /// @dev Same signature as RevenueVault V1 — the listener matches on this.
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    /**
     * @param _usdt  USDT token address (Polygon: 0xc2132D05D31c914a87C6611C10748AEb04B58e8F)
     * @param _owner Treasury address that may withdraw and transfer ownership.
     */
    constructor(address _usdt, address _owner) {
        require(_usdt != address(0), "RevenueVaultV2: zero usdt");
        require(_owner != address(0), "RevenueVaultV2: zero owner");
        usdt = IERC20(_usdt);
        // OZ v4 Ownable sets owner to msg.sender in its constructor; retarget to
        // the treasury so ownership is explicit regardless of the deployer EOA.
        _transferOwnership(_owner);
    }

    /**
     * @notice Deposit USDT into the vault. Permissionless — no role required.
     *         Caller must have approved this contract for `amount` first.
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "RevenueVaultV2: zero deposit");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw USDT to `to`. Owner (treasury) only.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "RevenueVaultV2: zero address");
        require(amount > 0, "RevenueVaultV2: zero withdrawal");
        totalWithdrawn += amount;
        usdt.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Current on-chain USDT balance held by the vault.
    function vaultBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
