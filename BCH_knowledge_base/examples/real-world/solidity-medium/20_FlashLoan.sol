// Source: Aave V3 Pool (simplified)
// Flash loan functionality - borrow and repay in same transaction
// https://github.com/aave/aave-v3-core

// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.10;

// Note: Simplified flash loan implementation based on Aave V3

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFlashLoanReceiver {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

contract FlashLoanPool {
    uint256 public constant FLASHLOAN_PREMIUM_TOTAL = 9; // 0.09%
    uint256 public constant PERCENTAGE_FACTOR = 10000;

    mapping(address => uint256) public reserves;
    mapping(address => bool) public supportedAssets;

    address public owner;

    event FlashLoan(
        address indexed target,
        address indexed initiator,
        address indexed asset,
        uint256 amount,
        uint256 premium
    );

    event Deposit(address indexed asset, address indexed user, uint256 amount);
    event Withdraw(address indexed asset, address indexed user, uint256 amount);

    error InvalidFlashLoanExecutor();
    error InvalidAmount();
    error AssetNotSupported();
    error InsufficientLiquidity();
    error FlashLoanRepaymentFailed();

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addSupportedAsset(address asset) external onlyOwner {
        supportedAssets[asset] = true;
    }

    function removeSupportedAsset(address asset) external onlyOwner {
        supportedAssets[asset] = false;
    }

    function deposit(address asset, uint256 amount) external {
        if (!supportedAssets[asset]) revert AssetNotSupported();
        if (amount == 0) revert InvalidAmount();

        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        reserves[asset] += amount;

        emit Deposit(asset, msg.sender, amount);
    }

    function withdraw(address asset, uint256 amount) external onlyOwner {
        if (amount > reserves[asset]) revert InsufficientLiquidity();

        reserves[asset] -= amount;
        IERC20(asset).transfer(msg.sender, amount);

        emit Withdraw(asset, msg.sender, amount);
    }

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params
    ) external {
        if (!supportedAssets[asset]) revert AssetNotSupported();
        if (amount == 0) revert InvalidAmount();

        uint256 availableLiquidity = IERC20(asset).balanceOf(address(this));
        if (amount > availableLiquidity) revert InsufficientLiquidity();

        uint256 premium = (amount * FLASHLOAN_PREMIUM_TOTAL) / PERCENTAGE_FACTOR;

        IERC20(asset).transfer(receiverAddress, amount);

        bool success = IFlashLoanSimpleReceiver(receiverAddress).executeOperation(
            asset,
            amount,
            premium,
            msg.sender,
            params
        );

        if (!success) revert InvalidFlashLoanExecutor();

        uint256 amountPlusPremium = amount + premium;
        IERC20(asset).transferFrom(receiverAddress, address(this), amountPlusPremium);

        reserves[asset] += premium;

        emit FlashLoan(receiverAddress, msg.sender, asset, amount, premium);
    }

    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        bytes calldata params
    ) external {
        require(assets.length == amounts.length, "Array length mismatch");

        uint256[] memory premiums = new uint256[](assets.length);

        for (uint256 i = 0; i < assets.length; i++) {
            if (!supportedAssets[assets[i]]) revert AssetNotSupported();
            if (amounts[i] == 0) revert InvalidAmount();

            uint256 availableLiquidity = IERC20(assets[i]).balanceOf(address(this));
            if (amounts[i] > availableLiquidity) revert InsufficientLiquidity();

            premiums[i] = (amounts[i] * FLASHLOAN_PREMIUM_TOTAL) / PERCENTAGE_FACTOR;
            IERC20(assets[i]).transfer(receiverAddress, amounts[i]);
        }

        bool success = IFlashLoanReceiver(receiverAddress).executeOperation(
            assets,
            amounts,
            premiums,
            msg.sender,
            params
        );

        if (!success) revert InvalidFlashLoanExecutor();

        for (uint256 i = 0; i < assets.length; i++) {
            uint256 amountPlusPremium = amounts[i] + premiums[i];
            IERC20(assets[i]).transferFrom(receiverAddress, address(this), amountPlusPremium);
            reserves[assets[i]] += premiums[i];

            emit FlashLoan(receiverAddress, msg.sender, assets[i], amounts[i], premiums[i]);
        }
    }

    function getAvailableLiquidity(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function calculatePremium(uint256 amount) external pure returns (uint256) {
        return (amount * FLASHLOAN_PREMIUM_TOTAL) / PERCENTAGE_FACTOR;
    }
}

abstract contract FlashLoanSimpleReceiverBase is IFlashLoanSimpleReceiver {
    FlashLoanPool public immutable POOL;

    constructor(address pool) {
        POOL = FlashLoanPool(pool);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external virtual override returns (bool);
}
