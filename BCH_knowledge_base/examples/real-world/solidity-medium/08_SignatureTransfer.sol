// Source: Uniswap Permit2 - SignatureTransfer
// One-time signature-based token transfers without persistent approvals
// https://github.com/Uniswap/permit2

// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// Note: Simplified version. Original imports from solmate and internal libraries.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ISignatureTransfer {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    struct PermitBatchTransferFrom {
        TokenPermissions[] permitted;
        uint256 nonce;
        uint256 deadline;
    }

    error SignatureExpired(uint256 deadline);
    error InvalidAmount(uint256 maxAmount);
    error InvalidNonce();
    error LengthMismatch();

    event UnorderedNonceInvalidation(address indexed owner, uint256 word, uint256 mask);
}

contract SignatureTransfer is ISignatureTransfer {
    bytes32 public constant DOMAIN_SEPARATOR = keccak256(
        abi.encode(
            keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
            keccak256("Permit2"),
            block.chainid,
            address(this)
        )
    );

    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external {
        _permitTransferFrom(permit, transferDetails, owner, _hashPermit(permit), signature);
    }

    function _permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes32 dataHash,
        bytes calldata signature
    ) private {
        uint256 requestedAmount = transferDetails.requestedAmount;

        if (block.timestamp > permit.deadline) revert SignatureExpired(permit.deadline);
        if (requestedAmount > permit.permitted.amount) revert InvalidAmount(permit.permitted.amount);

        _useUnorderedNonce(owner, permit.nonce);

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, dataHash));
        _verifySignature(digest, signature, owner);

        IERC20(permit.permitted.token).transferFrom(owner, transferDetails.to, requestedAmount);
    }

    function permitTransferFrom(
        PermitBatchTransferFrom memory permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external {
        _permitBatchTransferFrom(permit, transferDetails, owner, _hashBatchPermit(permit), signature);
    }

    function _permitBatchTransferFrom(
        PermitBatchTransferFrom memory permit,
        SignatureTransferDetails[] calldata transferDetails,
        address owner,
        bytes32 dataHash,
        bytes calldata signature
    ) private {
        uint256 numPermitted = permit.permitted.length;

        if (block.timestamp > permit.deadline) revert SignatureExpired(permit.deadline);
        if (numPermitted != transferDetails.length) revert LengthMismatch();

        _useUnorderedNonce(owner, permit.nonce);

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, dataHash));
        _verifySignature(digest, signature, owner);

        unchecked {
            for (uint256 i = 0; i < numPermitted; ++i) {
                TokenPermissions memory permitted = permit.permitted[i];
                uint256 requestedAmount = transferDetails[i].requestedAmount;

                if (requestedAmount > permitted.amount) revert InvalidAmount(permitted.amount);

                if (requestedAmount != 0) {
                    IERC20(permitted.token).transferFrom(owner, transferDetails[i].to, requestedAmount);
                }
            }
        }
    }

    function invalidateUnorderedNonces(uint256 wordPos, uint256 mask) external {
        nonceBitmap[msg.sender][wordPos] |= mask;
        emit UnorderedNonceInvalidation(msg.sender, wordPos, mask);
    }

    function _useUnorderedNonce(address from, uint256 nonce) internal {
        (uint256 wordPos, uint256 bitPos) = _bitmapPositions(nonce);
        uint256 bit = 1 << bitPos;
        uint256 flipped = nonceBitmap[from][wordPos] ^= bit;
        if (flipped & bit == 0) revert InvalidNonce();
    }

    function _bitmapPositions(uint256 nonce) private pure returns (uint256 wordPos, uint256 bitPos) {
        wordPos = uint248(nonce >> 8);
        bitPos = uint8(nonce);
    }

    function _hashPermit(PermitTransferFrom memory permit) private pure returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"),
            keccak256(abi.encode(
                keccak256("TokenPermissions(address token,uint256 amount)"),
                permit.permitted.token,
                permit.permitted.amount
            )),
            msg.sender,
            permit.nonce,
            permit.deadline
        ));
    }

    function _hashBatchPermit(PermitBatchTransferFrom memory permit) private pure returns (bytes32) {
        bytes32[] memory tokenPermissionHashes = new bytes32[](permit.permitted.length);
        for (uint256 i = 0; i < permit.permitted.length; ++i) {
            tokenPermissionHashes[i] = keccak256(abi.encode(
                keccak256("TokenPermissions(address token,uint256 amount)"),
                permit.permitted[i].token,
                permit.permitted[i].amount
            ));
        }
        return keccak256(abi.encode(
            keccak256("PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"),
            keccak256(abi.encodePacked(tokenPermissionHashes)),
            msg.sender,
            permit.nonce,
            permit.deadline
        ));
    }

    function _verifySignature(bytes32 digest, bytes calldata signature, address expectedSigner) private pure {
        require(signature.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == expectedSigner, "Invalid signature");
    }
}
