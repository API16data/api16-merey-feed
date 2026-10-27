// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

/// @title API16PriceFeed
/// @notice Monthly average crude price feed (e.g. MEREY16/USD, BRENT/USD) published by API16.
///         Read it like a Chainlink price feed: latestRoundData() / getRoundData().
///         Every round also stores the month it covers, whether the figure was
///         reported or derived, and a link to its public source.
/// @dev    Single publisher (owner). One round per month; months must increase.
///         DRAFT v0.1, not audited. Do not use to secure value.
contract API16PriceFeed is AggregatorV3Interface {
    enum DataType {
        Reported, // published as-is by the source
        Derived   // calculated from changes the source reported
    }

    struct Round {
        int256 answer;      // price with `decimals` decimals
        uint32 period;      // month covered, as YYYYMM (e.g. 202609)
        DataType dataType;
        uint64 updatedAt;   // block time when published
        string source;      // URL of the public source
    }

    uint8 public immutable override decimals;
    string public override description;
    uint256 public constant override version = 1;

    address public owner;
    address public pendingOwner;

    uint80 public latestRound;               // 0 = no data yet
    mapping(uint80 => Round) private rounds;  // roundId => Round
    mapping(uint32 => uint80) public roundOfPeriod; // YYYYMM => roundId

    event AnswerPublished(uint80 indexed roundId, uint32 indexed period, int256 answer, DataType dataType, string source);
    event AnswerCorrected(uint80 indexed roundId, uint32 indexed period, int256 oldAnswer, int256 newAnswer, string reason);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error PeriodNotIncreasing(uint32 period, uint32 lastPeriod);
    error InvalidPeriod(uint32 period);
    error InvalidAnswer();
    error NoDataPresent();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint8 decimals_, string memory description_) {
        decimals = decimals_;
        description = description_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ------------------------------------------------------------------ publish

    /// @notice Publish the average for a new month.
    function publish(uint32 period, int256 answer, DataType dataType, string calldata source)
        external
        onlyOwner
        returns (uint80 roundId)
    {
        _checkPeriod(period);
        if (answer <= 0) revert InvalidAnswer();
        uint32 last = latestRound == 0 ? 0 : rounds[latestRound].period;
        if (period <= last) revert PeriodNotIncreasing(period, last);

        roundId = latestRound + 1;
        rounds[roundId] = Round(answer, period, dataType, uint64(block.timestamp), source);
        roundOfPeriod[period] = roundId;
        latestRound = roundId;
        emit AnswerPublished(roundId, period, answer, dataType, source);
    }

    /// @notice Correct a month already published (e.g. the source revised it).
    ///         The correction is public through AnswerCorrected.
    function correct(uint80 roundId, int256 answer, DataType dataType, string calldata source, string calldata reason)
        external
        onlyOwner
    {
        Round storage r = rounds[roundId];
        if (r.period == 0) revert NoDataPresent();
        if (answer <= 0) revert InvalidAnswer();
        int256 old = r.answer;
        r.answer = answer;
        r.dataType = dataType;
        r.source = source;
        r.updatedAt = uint64(block.timestamp);
        emit AnswerCorrected(roundId, r.period, old, answer, reason);
    }

    // ------------------------------------------------- Chainlink-compatible reads

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return getRoundData(latestRound);
    }

    function getRoundData(uint80 roundId)
        public
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        Round storage r = rounds[roundId];
        if (r.period == 0) revert NoDataPresent();
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    // ------------------------------------------------------------ API16 extras

    /// @notice Full detail of a round: month, data type and source.
    function getRoundDetail(uint80 roundId) external view returns (Round memory) {
        Round memory r = rounds[roundId];
        if (r.period == 0) revert NoDataPresent();
        return r;
    }

    // ---------------------------------------------------------------- ownership

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ----------------------------------------------------------------- internal

    function _checkPeriod(uint32 period) private pure {
        uint32 month = period % 100;
        uint32 year = period / 100;
        if (month == 0 || month > 12 || year < 2000 || year > 2200) revert InvalidPeriod(period);
    }
}
