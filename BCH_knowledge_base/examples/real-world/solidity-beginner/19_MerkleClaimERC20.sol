// Source: Anish Agnihotri - Merkle Airdrop Starter
// ERC20 token claimable via Merkle proof (for airdrops)
// https://github.com/Anish-Agnihotri/merkle-airdrop-starter

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.8.0;

/**
 * @title MerkleClaimERC20
 * @notice ERC20 claimable by members of a merkle tree
 * @author Anish Agnihotri <contact@anishagnihotri.com>
 *
 * Note: This is a simplified version. The original imports ERC20 from Solmate
 * and MerkleProof from OpenZeppelin.
 */
contract MerkleClaimERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    bytes32 public immutable merkleRoot;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public hasClaimed;

    error AlreadyClaimed();
    error NotInMerkle();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Claim(address indexed to, uint256 amount);

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        bytes32 _merkleRoot
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        merkleRoot = _merkleRoot;
    }

    function claim(address to, uint256 amount, bytes32[] calldata proof) external {
        if (hasClaimed[to]) revert AlreadyClaimed();

        // Verify merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(to, amount));
        bool isValidLeaf = _verify(proof, merkleRoot, leaf);
        if (!isValidLeaf) revert NotInMerkle();

        hasClaimed[to] = true;
        _mint(to, amount);

        emit Claim(to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    // Simplified Merkle verification
    function _verify(bytes32[] memory proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }
        return computedHash == root;
    }
}
