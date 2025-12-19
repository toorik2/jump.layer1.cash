// Source: OpenZeppelin Contracts v5.1.0
// Merkle tree proof verification library
// https://github.com/OpenZeppelin/openzeppelin-contracts

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Library for verification of Merkle Tree proofs.
 *
 * The tree and proofs can be generated using OpenZeppelin's JavaScript library.
 * https://github.com/OpenZeppelin/merkle-tree
 *
 * WARNING: Avoid using leaf values that are 64 bytes long prior to hashing,
 * or use a hash function other than keccak256 for hashing leaves.
 * This is because the concatenation of a sorted pair of internal nodes in
 * the Merkle tree could be reinterpreted as a leaf value.
 */
library MerkleProof {
    error MerkleProofInvalidMultiproof();

    /**
     * @dev Returns true if a `leaf` can be proved to be a part of a Merkle tree
     * defined by `root`. For this, a `proof` must be provided, containing
     * sibling hashes on the branch from the leaf to the root of the tree.
     */
    function verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        return processProof(proof, leaf) == root;
    }

    /**
     * @dev Returns the rebuilt hash obtained by traversing a Merkle tree up
     * from `leaf` using `proof`. A `proof` is valid if and only if the rebuilt
     * hash matches the root of the tree.
     */
    function processProof(bytes32[] memory proof, bytes32 leaf) internal pure returns (bytes32) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
        return computedHash;
    }

    /**
     * @dev Calldata version of {verify}
     */
    function verifyCalldata(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        return processProofCalldata(proof, leaf) == root;
    }

    /**
     * @dev Calldata version of {processProof}
     */
    function processProofCalldata(bytes32[] calldata proof, bytes32 leaf) internal pure returns (bytes32) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
        return computedHash;
    }

    /**
     * @dev Returns true if the `leaves` can be simultaneously proven to be a part of a Merkle tree
     * defined by `root`, according to `proof` and `proofFlags`.
     *
     * CAUTION: Not all Merkle trees admit multiproofs. See {processMultiProof} for details.
     */
    function multiProofVerify(
        bytes32[] memory proof,
        bool[] memory proofFlags,
        bytes32 root,
        bytes32[] memory leaves
    ) internal pure returns (bool) {
        return processMultiProof(proof, proofFlags, leaves) == root;
    }

    /**
     * @dev Returns the root of a tree reconstructed from `leaves` and sibling nodes in `proof`.
     * The reconstruction proceeds by incrementally reconstructing all inner nodes by combining
     * a leaf/inner node with either another leaf/inner node or a proof sibling node.
     *
     * CAUTION: Not all Merkle trees admit multiproofs. To use multiproofs, it is sufficient to ensure that:
     * 1) the tree is complete (but not necessarily perfect),
     * 2) the leaves to be proven are in the opposite order they are in the tree.
     */
    function processMultiProof(
        bytes32[] memory proof,
        bool[] memory proofFlags,
        bytes32[] memory leaves
    ) internal pure returns (bytes32 merkleRoot) {
        uint256 leavesLen = leaves.length;
        uint256 proofFlagsLen = proofFlags.length;

        if (leavesLen + proof.length != proofFlagsLen + 1) {
            revert MerkleProofInvalidMultiproof();
        }

        if (proofFlagsLen > 0) {
            bytes32[] memory hashes = new bytes32[](proofFlagsLen);
            uint256 leafPos = 0;
            uint256 hashPos = 0;
            uint256 proofPos = 0;

            for (uint256 i = 0; i < proofFlagsLen; i++) {
                bytes32 a = leafPos < leavesLen ? leaves[leafPos++] : hashes[hashPos++];
                bytes32 b = proofFlags[i]
                    ? (leafPos < leavesLen ? leaves[leafPos++] : hashes[hashPos++])
                    : proof[proofPos++];
                hashes[i] = _hashPair(a, b);
            }

            if (proofPos != proof.length) {
                revert MerkleProofInvalidMultiproof();
            }

            unchecked {
                return hashes[proofFlagsLen - 1];
            }
        } else if (leavesLen > 0) {
            return leaves[0];
        } else {
            return proof[0];
        }
    }

    /**
     * @dev Calldata version of {multiProofVerify}
     */
    function multiProofVerifyCalldata(
        bytes32[] calldata proof,
        bool[] calldata proofFlags,
        bytes32 root,
        bytes32[] memory leaves
    ) internal pure returns (bool) {
        return processMultiProofCalldata(proof, proofFlags, leaves) == root;
    }

    /**
     * @dev Calldata version of {processMultiProof}
     */
    function processMultiProofCalldata(
        bytes32[] calldata proof,
        bool[] calldata proofFlags,
        bytes32[] memory leaves
    ) internal pure returns (bytes32 merkleRoot) {
        uint256 leavesLen = leaves.length;
        uint256 proofFlagsLen = proofFlags.length;

        if (leavesLen + proof.length != proofFlagsLen + 1) {
            revert MerkleProofInvalidMultiproof();
        }

        if (proofFlagsLen > 0) {
            bytes32[] memory hashes = new bytes32[](proofFlagsLen);
            uint256 leafPos = 0;
            uint256 hashPos = 0;
            uint256 proofPos = 0;

            for (uint256 i = 0; i < proofFlagsLen; i++) {
                bytes32 a = leafPos < leavesLen ? leaves[leafPos++] : hashes[hashPos++];
                bytes32 b = proofFlags[i]
                    ? (leafPos < leavesLen ? leaves[leafPos++] : hashes[hashPos++])
                    : proof[proofPos++];
                hashes[i] = _hashPair(a, b);
            }

            if (proofPos != proof.length) {
                revert MerkleProofInvalidMultiproof();
            }

            unchecked {
                return hashes[proofFlagsLen - 1];
            }
        } else if (leavesLen > 0) {
            return leaves[0];
        } else {
            return proof[0];
        }
    }

    /**
     * @dev Sorts the pair (a, b) and hashes the result.
     * Commutative hashing ensures H(a,b) == H(b,a).
     */
    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? _efficientHash(a, b) : _efficientHash(b, a);
    }

    /**
     * @dev Gas-efficient implementation of keccak256(abi.encodePacked(a, b))
     */
    function _efficientHash(bytes32 a, bytes32 b) private pure returns (bytes32 value) {
        assembly {
            mstore(0x00, a)
            mstore(0x20, b)
            value := keccak256(0x00, 0x40)
        }
    }
}
