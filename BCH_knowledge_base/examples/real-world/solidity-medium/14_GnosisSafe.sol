// Source: Gnosis Safe v1.5.0
// Multi-signature wallet with modular security
// Deployed at 0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552 (Ethereum)
// https://github.com/safe-global/safe-smart-account

// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity >=0.7.0 <0.9.0;

// Note: Simplified version. Original imports multiple base contracts.

interface ISignatureValidator {
    function isValidSignature(bytes memory _data, bytes memory _signature) external view returns (bytes4);
}

contract GnosisSafe {
    event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler);
    event ApproveHash(bytes32 indexed approvedHash, address indexed owner);
    event SignMsg(bytes32 indexed msgHash);
    event ExecutionFailure(bytes32 indexed txHash, uint256 payment);
    event ExecutionSuccess(bytes32 indexed txHash, uint256 payment);
    event EnabledModule(address indexed module);
    event DisabledModule(address indexed module);
    event ExecutionFromModuleSuccess(address indexed module);
    event ExecutionFromModuleFailure(address indexed module);
    event AddedOwner(address indexed owner);
    event RemovedOwner(address indexed owner);
    event ChangedThreshold(uint256 threshold);

    address internal constant SENTINEL_OWNERS = address(0x1);
    address internal constant SENTINEL_MODULES = address(0x1);

    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    bytes32 private constant SAFE_TX_TYPEHASH = 0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8;

    mapping(address => address) internal owners;
    uint256 internal ownerCount;
    uint256 internal threshold;

    mapping(address => address) internal modules;
    address internal fallbackHandler;

    uint256 public nonce;
    bytes32 private _deprecatedDomainSeparator;
    mapping(bytes32 => uint256) public signedMessages;
    mapping(address => mapping(bytes32 => uint256)) public approvedHashes;

    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address to,
        bytes calldata data,
        address fallbackHandler_,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external {
        require(threshold == 0, "GS200");
        require(_threshold <= _owners.length, "GS201");
        require(_threshold >= 1, "GS202");

        address currentOwner = SENTINEL_OWNERS;
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0) && owner != SENTINEL_OWNERS && owner != address(this) && currentOwner != owner, "GS203");
            require(owners[owner] == address(0), "GS204");
            owners[currentOwner] = owner;
            currentOwner = owner;
        }
        owners[currentOwner] = SENTINEL_OWNERS;
        ownerCount = _owners.length;
        threshold = _threshold;

        if (fallbackHandler_ != address(0)) {
            fallbackHandler = fallbackHandler_;
        }

        if (to != address(0)) {
            (bool success,) = to.delegatecall(data);
            require(success, "GS000");
        }

        if (payment > 0) {
            _handlePayment(payment, 0, 1, paymentToken, paymentReceiver);
        }

        emit SafeSetup(msg.sender, _owners, _threshold, to, fallbackHandler_);
    }

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) public payable virtual returns (bool success) {
        bytes32 txHash;
        {
            bytes memory txHashData = encodeTransactionData(
                to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce
            );
            nonce++;
            txHash = keccak256(txHashData);
            checkSignatures(txHash, signatures);
        }

        require(gasleft() >= ((safeTxGas * 64) / 63) + baseGas, "GS010");

        {
            uint256 gasUsed = gasleft();
            success = _execute(to, value, data, operation, safeTxGas == 0 ? gasleft() : safeTxGas);
            gasUsed = gasUsed - gasleft();

            require(success || safeTxGas != 0 || gasPrice != 0, "GS013");

            uint256 payment = 0;
            if (gasPrice > 0) {
                payment = _handlePayment(gasUsed + baseGas, baseGas, gasPrice, gasToken, refundReceiver);
            }

            if (success) emit ExecutionSuccess(txHash, payment);
            else emit ExecutionFailure(txHash, payment);
        }
    }

    function checkSignatures(bytes32 dataHash, bytes memory signatures) public view {
        checkNSignatures(msg.sender, dataHash, signatures, threshold);
    }

    function checkNSignatures(address executor, bytes32 dataHash, bytes memory signatures, uint256 requiredSignatures) public view {
        require(signatures.length >= requiredSignatures * 65, "GS020");
        address lastOwner = address(0);
        address currentOwner;
        uint8 v;
        bytes32 r;
        bytes32 s;

        for (uint256 i = 0; i < requiredSignatures; i++) {
            (v, r, s) = signatureSplit(signatures, i);
            if (v == 0) {
                currentOwner = address(uint160(uint256(r)));
                require(executor == currentOwner || approvedHashes[currentOwner][dataHash] != 0, "GS025");
            } else if (v == 1) {
                currentOwner = address(uint160(uint256(r)));
                bytes32 messageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash));
                require(ISignatureValidator(currentOwner).isValidSignature(abi.encode(messageHash), "") == bytes4(0x20c13b0b), "GS024");
            } else if (v > 30) {
                currentOwner = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash)), v - 4, r, s);
            } else {
                currentOwner = ecrecover(dataHash, v, r, s);
            }
            require(currentOwner > lastOwner && owners[currentOwner] != address(0) && currentOwner != SENTINEL_OWNERS, "GS026");
            lastOwner = currentOwner;
        }
    }

    function approveHash(bytes32 hashToApprove) external {
        require(owners[msg.sender] != address(0), "GS030");
        approvedHashes[msg.sender][hashToApprove] = 1;
        emit ApproveHash(hashToApprove, msg.sender);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, address(this)));
    }

    function encodeTransactionData(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes memory) {
        bytes32 safeTxHash = keccak256(
            abi.encode(
                SAFE_TX_TYPEHASH,
                to,
                value,
                keccak256(data),
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                _nonce
            )
        );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash);
    }

    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(encodeTransactionData(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, _nonce));
    }

    function addOwnerWithThreshold(address owner, uint256 _threshold) public {
        require(msg.sender == address(this), "GS031");
        require(owner != address(0) && owner != SENTINEL_OWNERS && owner != address(this) && owners[owner] == address(0), "GS203");
        owners[owner] = owners[SENTINEL_OWNERS];
        owners[SENTINEL_OWNERS] = owner;
        ownerCount++;
        emit AddedOwner(owner);
        if (threshold != _threshold) {
            changeThreshold(_threshold);
        }
    }

    function removeOwner(address prevOwner, address owner, uint256 _threshold) public {
        require(msg.sender == address(this), "GS031");
        require(ownerCount - 1 >= _threshold, "GS201");
        require(owner != address(0) && owner != SENTINEL_OWNERS, "GS203");
        require(owners[prevOwner] == owner, "GS205");
        owners[prevOwner] = owners[owner];
        owners[owner] = address(0);
        ownerCount--;
        emit RemovedOwner(owner);
        if (threshold != _threshold) {
            changeThreshold(_threshold);
        }
    }

    function changeThreshold(uint256 _threshold) public {
        require(msg.sender == address(this), "GS031");
        require(_threshold <= ownerCount, "GS201");
        require(_threshold >= 1, "GS202");
        threshold = _threshold;
        emit ChangedThreshold(threshold);
    }

    function getThreshold() public view returns (uint256) {
        return threshold;
    }

    function isOwner(address owner) public view returns (bool) {
        return owner != SENTINEL_OWNERS && owners[owner] != address(0);
    }

    function getOwners() public view returns (address[] memory) {
        address[] memory array = new address[](ownerCount);
        uint256 index = 0;
        address currentOwner = owners[SENTINEL_OWNERS];
        while (currentOwner != SENTINEL_OWNERS) {
            array[index] = currentOwner;
            currentOwner = owners[currentOwner];
            index++;
        }
        return array;
    }

    function _execute(address to, uint256 value, bytes memory data, uint8 operation, uint256 txGas) internal returns (bool success) {
        if (operation == 0) {
            assembly {
                success := call(txGas, to, value, add(data, 0x20), mload(data), 0, 0)
            }
        } else {
            assembly {
                success := delegatecall(txGas, to, add(data, 0x20), mload(data), 0, 0)
            }
        }
    }

    function _handlePayment(
        uint256 gasUsed,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver
    ) private returns (uint256 payment) {
        payment = gasUsed + baseGas;
        payment = payment * (gasPrice > 0 ? gasPrice : tx.gasprice);
        address payable receiver = refundReceiver == address(0) ? payable(tx.origin) : refundReceiver;
        if (gasToken == address(0)) {
            (bool success,) = receiver.call{value: payment}("");
            require(success, "GS011");
        } else {
            (bool success, bytes memory data) = gasToken.call(abi.encodeWithSignature("transfer(address,uint256)", receiver, payment));
            require(success && (data.length == 0 || abi.decode(data, (bool))), "GS012");
        }
    }

    function signatureSplit(bytes memory signatures, uint256 pos) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        assembly {
            let signaturePos := mul(0x41, pos)
            r := mload(add(signatures, add(signaturePos, 0x20)))
            s := mload(add(signatures, add(signaturePos, 0x40)))
            v := byte(0, mload(add(signatures, add(signaturePos, 0x60))))
        }
    }

    receive() external payable {}
}
