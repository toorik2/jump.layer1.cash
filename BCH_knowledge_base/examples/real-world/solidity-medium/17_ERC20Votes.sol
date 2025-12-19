// Source: OpenZeppelin Contracts v5.5.0
// ERC20 with voting and delegation support (Compound-like)
// https://github.com/OpenZeppelin/openzeppelin-contracts

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Note: Simplified version. Original imports ERC20, Votes, Checkpoints.

interface IVotes {
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes);

    function getVotes(address account) external view returns (uint256);
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256);
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256);
    function delegates(address account) external view returns (address);
    function delegate(address delegatee) external;
    function delegateBySig(address delegatee, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external;
}

abstract contract ERC20Votes is IVotes {
    struct Checkpoint {
        uint48 fromBlock;
        uint208 votes;
    }

    string private _name;
    string private _symbol;
    uint256 private _totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => address) private _delegates;
    mapping(address => Checkpoint[]) private _checkpoints;
    Checkpoint[] private _totalSupplyCheckpoints;
    mapping(address => uint256) private _nonces;

    bytes32 private constant DELEGATION_TYPEHASH = keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private immutable _hashedName;
    bytes32 private immutable _hashedVersion;

    error ERC20ExceededSafeSupply(uint256 increasedSupply, uint256 cap);
    error VotesExpiredSignature(uint256 expiry);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
        _hashedName = keccak256(bytes(name_));
        _hashedVersion = keccak256(bytes("1"));
    }

    function name() public view virtual returns (string memory) {
        return _name;
    }

    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    function _maxSupply() internal view virtual returns (uint256) {
        return type(uint208).max;
    }

    function getVotes(address account) public view virtual override returns (uint256) {
        Checkpoint[] storage ckpts = _checkpoints[account];
        uint256 pos = ckpts.length;
        return pos == 0 ? 0 : ckpts[pos - 1].votes;
    }

    function getPastVotes(address account, uint256 timepoint) public view virtual override returns (uint256) {
        require(timepoint < block.number, "Votes: future lookup");
        return _checkpointsLookup(_checkpoints[account], timepoint);
    }

    function getPastTotalSupply(uint256 timepoint) public view virtual override returns (uint256) {
        require(timepoint < block.number, "Votes: future lookup");
        return _checkpointsLookup(_totalSupplyCheckpoints, timepoint);
    }

    function delegates(address account) public view virtual override returns (address) {
        return _delegates[account];
    }

    function delegate(address delegatee) public virtual override {
        _delegate(msg.sender, delegatee);
    }

    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override {
        if (block.timestamp > expiry) {
            revert VotesExpiredSignature(expiry);
        }

        address signer = _recoverSigner(
            keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry)),
            v, r, s
        );

        require(_nonces[signer]++ == nonce, "Votes: invalid nonce");
        _delegate(signer, delegatee);
    }

    function numCheckpoints(address account) public view virtual returns (uint32) {
        return uint32(_checkpoints[account].length);
    }

    function checkpoints(address account, uint32 pos) public view virtual returns (Checkpoint memory) {
        return _checkpoints[account][pos];
    }

    function _delegate(address account, address delegatee) internal virtual {
        address oldDelegate = delegates(account);
        _delegates[account] = delegatee;

        emit DelegateChanged(account, oldDelegate, delegatee);

        _moveVotingPower(oldDelegate, delegatee, _getVotingUnits(account));
    }

    function _moveVotingPower(address from, address to, uint256 amount) private {
        if (from != to && amount > 0) {
            if (from != address(0)) {
                (uint256 oldValue, uint256 newValue) = _writeCheckpoint(
                    _checkpoints[from],
                    _subtract,
                    amount
                );
                emit DelegateVotesChanged(from, oldValue, newValue);
            }
            if (to != address(0)) {
                (uint256 oldValue, uint256 newValue) = _writeCheckpoint(
                    _checkpoints[to],
                    _add,
                    amount
                );
                emit DelegateVotesChanged(to, oldValue, newValue);
            }
        }
    }

    function _transferVotingUnits(address from, address to, uint256 amount) internal virtual {
        if (from == address(0)) {
            (uint256 oldValue, uint256 newValue) = _writeCheckpoint(_totalSupplyCheckpoints, _add, amount);
            uint256 supply = oldValue + amount;
            uint256 cap = _maxSupply();
            if (supply > cap) {
                revert ERC20ExceededSafeSupply(supply, cap);
            }
        }
        if (to == address(0)) {
            _writeCheckpoint(_totalSupplyCheckpoints, _subtract, amount);
        }
        _moveVotingPower(delegates(from), delegates(to), amount);
    }

    function _writeCheckpoint(
        Checkpoint[] storage ckpts,
        function(uint256, uint256) view returns (uint256) op,
        uint256 delta
    ) private returns (uint256 oldWeight, uint256 newWeight) {
        uint256 pos = ckpts.length;

        Checkpoint memory oldCkpt = pos == 0 ? Checkpoint(0, 0) : ckpts[pos - 1];

        oldWeight = oldCkpt.votes;
        newWeight = op(oldWeight, delta);

        if (pos > 0 && oldCkpt.fromBlock == block.number) {
            ckpts[pos - 1].votes = uint208(newWeight);
        } else {
            ckpts.push(Checkpoint({fromBlock: uint48(block.number), votes: uint208(newWeight)}));
        }
    }

    function _checkpointsLookup(Checkpoint[] storage ckpts, uint256 timepoint) private view returns (uint256) {
        uint256 length = ckpts.length;

        uint256 low = 0;
        uint256 high = length;

        if (length > 5) {
            uint256 mid = length - 1 - (length - 1) / 10;
            if (ckpts[mid].fromBlock > timepoint) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (ckpts[mid].fromBlock > timepoint) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return low == 0 ? 0 : ckpts[low - 1].votes;
    }

    function _getVotingUnits(address account) internal view virtual returns (uint256) {
        return _balances[account];
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }

    function _subtract(uint256 a, uint256 b) private pure returns (uint256) {
        return a - b;
    }

    function _recoverSigner(bytes32 structHash, uint8 v, bytes32 r, bytes32 s) private view returns (address) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, _hashedName, _hashedVersion, block.chainid, address(this))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        return ecrecover(digest, v, r, s);
    }

    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            _totalSupply += value;
        } else {
            uint256 fromBalance = _balances[from];
            require(fromBalance >= value, "ERC20: insufficient balance");
            unchecked {
                _balances[from] = fromBalance - value;
            }
        }

        if (to == address(0)) {
            unchecked {
                _totalSupply -= value;
            }
        } else {
            unchecked {
                _balances[to] += value;
            }
        }

        emit Transfer(from, to, value);

        _transferVotingUnits(from, to, value);
    }
}
