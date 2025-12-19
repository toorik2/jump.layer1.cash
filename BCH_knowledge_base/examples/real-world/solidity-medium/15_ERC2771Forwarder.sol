// Source: OpenZeppelin Contracts v5.5.0
// Meta-transaction forwarder for gasless transactions
// https://github.com/OpenZeppelin/openzeppelin-contracts

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Note: Simplified version. Original imports ECDSA, EIP712, Nonces.

interface IERC2771Context {
    function isTrustedForwarder(address forwarder) external view returns (bool);
}

contract ERC2771Forwarder {
    struct ForwardRequestData {
        address from;
        address to;
        uint256 value;
        uint256 gas;
        uint48 deadline;
        bytes data;
        bytes signature;
    }

    bytes32 private constant FORWARD_REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    string private _name;
    bytes32 private immutable _hashedName;
    bytes32 private immutable _hashedVersion;

    mapping(address => uint256) private _nonces;

    event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success);

    error ERC2771ForwarderInvalidSigner(address signer, address from);
    error ERC2771ForwarderMismatchedValue(uint256 requestedValue, uint256 msgValue);
    error ERC2771ForwarderExpiredRequest(uint48 deadline);
    error ERC2771UntrustfulTarget(address target, address forwarder);
    error FailedCall();

    constructor(string memory name_) {
        _name = name_;
        _hashedName = keccak256(bytes(name_));
        _hashedVersion = keccak256(bytes("1"));
    }

    function nonces(address owner) public view virtual returns (uint256) {
        return _nonces[owner];
    }

    function verify(ForwardRequestData calldata request) public view virtual returns (bool) {
        (bool isTrustedForwarder, bool active, bool signerMatch, ) = _validate(request);
        return isTrustedForwarder && active && signerMatch;
    }

    function execute(ForwardRequestData calldata request) public payable virtual {
        if (msg.value != request.value) {
            revert ERC2771ForwarderMismatchedValue(request.value, msg.value);
        }

        if (!_execute(request, true)) {
            revert FailedCall();
        }
    }

    function executeBatch(
        ForwardRequestData[] calldata requests,
        address payable refundReceiver
    ) public payable virtual {
        bool atomic = refundReceiver == address(0);

        uint256 requestsValue;
        uint256 refundValue;

        for (uint256 i; i < requests.length; ++i) {
            requestsValue += requests[i].value;
            bool success = _execute(requests[i], atomic);
            if (!success) {
                refundValue += requests[i].value;
            }
        }

        if (requestsValue != msg.value) {
            revert ERC2771ForwarderMismatchedValue(requestsValue, msg.value);
        }

        if (refundValue != 0) {
            (bool sent, ) = refundReceiver.call{value: refundValue}("");
            require(sent, "Failed to send refund");
        }
    }

    function _validate(ForwardRequestData calldata request)
        internal
        view
        virtual
        returns (bool isTrustedForwarder, bool active, bool signerMatch, address signer)
    {
        (bool isValid, address recovered) = _recoverForwardRequestSigner(request);

        return (
            _isTrustedByTarget(request.to),
            request.deadline >= block.timestamp,
            isValid && recovered == request.from,
            recovered
        );
    }

    function _recoverForwardRequestSigner(ForwardRequestData calldata request)
        internal
        view
        virtual
        returns (bool isValid, address signer)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_REQUEST_TYPEHASH,
                request.from,
                request.to,
                request.value,
                request.gas,
                _nonces[request.from],
                request.deadline,
                keccak256(request.data)
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), structHash)
        );

        address recovered = _recover(digest, request.signature);
        return (recovered != address(0), recovered);
    }

    function _execute(ForwardRequestData calldata request, bool requireValidRequest)
        internal
        virtual
        returns (bool success)
    {
        (bool isTrustedForwarder, bool active, bool signerMatch, address signer) = _validate(request);

        if (requireValidRequest) {
            if (!isTrustedForwarder) {
                revert ERC2771UntrustfulTarget(request.to, address(this));
            }
            if (!active) {
                revert ERC2771ForwarderExpiredRequest(request.deadline);
            }
            if (!signerMatch) {
                revert ERC2771ForwarderInvalidSigner(signer, request.from);
            }
        }

        if (isTrustedForwarder && signerMatch && active) {
            uint256 currentNonce = _nonces[signer]++;

            bytes memory payload = abi.encodePacked(request.data, request.from);

            uint256 reqGas = request.gas;
            address to = request.to;
            uint256 value = request.value;

            assembly {
                success := call(reqGas, to, value, add(payload, 0x20), mload(payload), 0x00, 0x00)
            }

            emit ExecutedForwardRequest(signer, currentNonce, success);
        }
    }

    function _isTrustedByTarget(address target) internal view virtual returns (bool) {
        bytes memory encodedParams = abi.encodeWithSelector(
            IERC2771Context.isTrustedForwarder.selector,
            address(this)
        );

        bool success;
        uint256 returnSize;
        uint256 returnValue;
        assembly {
            success := staticcall(gas(), target, add(encodedParams, 0x20), mload(encodedParams), 0x00, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0x00)
        }

        return success && returnSize >= 0x20 && returnValue > 0;
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                _hashedName,
                _hashedVersion,
                block.chainid,
                address(this)
            )
        );
    }

    function _recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        if (v < 27) {
            v += 27;
        }

        if (v != 27 && v != 28) {
            return address(0);
        }

        return ecrecover(hash, v, r, s);
    }
}
