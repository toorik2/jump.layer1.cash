// Source: Chainlink
// Price Feed Aggregator - provides reliable off-chain data
// https://github.com/smartcontractkit/chainlink

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Note: Simplified implementation based on Chainlink's AggregatorV3Interface

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);

    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract ChainlinkAggregator is AggregatorV3Interface {
    struct Round {
        int256 answer;
        uint64 startedAt;
        uint64 updatedAt;
        uint80 answeredInRound;
    }

    uint8 public constant override decimals = 8;
    string public override description;
    uint256 public constant override version = 4;

    uint32 public latestAggregatorRoundId;
    mapping(uint32 => Round) internal rounds;

    uint256 public minSubmissionCount;
    uint256 public maxSubmissionCount;
    uint32 public restartDelay;
    uint32 public timeout;

    address[] private oracles;
    mapping(address => bool) private oracleEnabled;
    mapping(uint32 => mapping(address => bool)) private submissions;

    address public owner;
    address public validator;

    int192 public minSubmissionValue;
    int192 public maxSubmissionValue;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event NewRound(uint256 indexed roundId, address indexed startedBy, uint256 startedAt);
    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOracle() {
        require(oracleEnabled[msg.sender], "Not authorized oracle");
        _;
    }

    constructor(
        string memory _description,
        uint256 _minSubmissionCount,
        uint256 _maxSubmissionCount,
        int192 _minSubmissionValue,
        int192 _maxSubmissionValue
    ) {
        owner = msg.sender;
        description = _description;
        minSubmissionCount = _minSubmissionCount;
        maxSubmissionCount = _maxSubmissionCount;
        minSubmissionValue = _minSubmissionValue;
        maxSubmissionValue = _maxSubmissionValue;
        timeout = 1 hours;
    }

    function getRoundData(uint80 _roundId)
        public
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        Round memory r = rounds[uint32(_roundId)];
        require(r.updatedAt > 0, "No data for round");

        return (
            _roundId,
            r.answer,
            r.startedAt,
            r.updatedAt,
            r.answeredInRound
        );
    }

    function latestRoundData()
        public
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return getRoundData(latestAggregatorRoundId);
    }

    function latestAnswer() external view returns (int256) {
        return rounds[latestAggregatorRoundId].answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return rounds[latestAggregatorRoundId].updatedAt;
    }

    function latestRound() external view returns (uint256) {
        return latestAggregatorRoundId;
    }

    function getAnswer(uint256 _roundId) external view returns (int256) {
        return rounds[uint32(_roundId)].answer;
    }

    function getTimestamp(uint256 _roundId) external view returns (uint256) {
        return rounds[uint32(_roundId)].updatedAt;
    }

    function submit(uint256 _roundId, int256 _submission) external onlyOracle {
        require(_submission >= minSubmissionValue, "Value below min");
        require(_submission <= maxSubmissionValue, "Value above max");

        uint32 roundId = uint32(_roundId);
        require(!submissions[roundId][msg.sender], "Already submitted");
        submissions[roundId][msg.sender] = true;

        if (rounds[roundId].startedAt == 0) {
            _initializeRound(roundId);
        }

        rounds[roundId].answer = _submission;
        rounds[roundId].updatedAt = uint64(block.timestamp);
        rounds[roundId].answeredInRound = uint80(roundId);

        if (roundId > latestAggregatorRoundId) {
            latestAggregatorRoundId = roundId;
        }

        emit AnswerUpdated(_submission, roundId, block.timestamp);
    }

    function _initializeRound(uint32 _roundId) private {
        rounds[_roundId].startedAt = uint64(block.timestamp);
        emit NewRound(_roundId, msg.sender, block.timestamp);
    }

    function addOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        require(!oracleEnabled[_oracle], "Oracle exists");

        oracleEnabled[_oracle] = true;
        oracles.push(_oracle);

        emit OracleAdded(_oracle);
    }

    function removeOracle(address _oracle) external onlyOwner {
        require(oracleEnabled[_oracle], "Oracle not found");

        oracleEnabled[_oracle] = false;

        for (uint256 i = 0; i < oracles.length; i++) {
            if (oracles[i] == _oracle) {
                oracles[i] = oracles[oracles.length - 1];
                oracles.pop();
                break;
            }
        }

        emit OracleRemoved(_oracle);
    }

    function oracleCount() external view returns (uint256) {
        return oracles.length;
    }

    function getOracles() external view returns (address[] memory) {
        return oracles;
    }

    function setValidator(address _validator) external onlyOwner {
        validator = _validator;
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Invalid owner");
        owner = _newOwner;
    }
}
