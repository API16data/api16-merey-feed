// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

interface IAPI16Feed is AggregatorV3Interface {
    function latestRound() external view returns (uint80);
    function roundOfPeriod(uint32 period) external view returns (uint80);
}

/// @title API16SpreadReader
/// @notice Reads two API16 feeds (e.g. BRENT/USD and MEREY16/USD) and returns
///         the discount for the same month: benchmark − crude.
///         Shows how other contracts can build on the feeds. DRAFT v0.1.
contract API16SpreadReader {
    IAPI16Feed public immutable benchmark; // e.g. BRENT/USD
    IAPI16Feed public immutable crude;     // e.g. MEREY16/USD

    error DecimalsMismatch();
    error MissingPeriod(uint32 period);

    constructor(IAPI16Feed benchmark_, IAPI16Feed crude_) {
        if (benchmark_.decimals() != crude_.decimals()) revert DecimalsMismatch();
        benchmark = benchmark_;
        crude = crude_;
    }

    /// @notice Spread for a given month (YYYYMM), with the feeds' decimals.
    function spreadOf(uint32 period) public view returns (int256) {
        uint80 b = benchmark.roundOfPeriod(period);
        uint80 c = crude.roundOfPeriod(period);
        if (b == 0 || c == 0) revert MissingPeriod(period);
        (, int256 bp,,,) = benchmark.getRoundData(b);
        (, int256 cp,,,) = crude.getRoundData(c);
        return bp - cp;
    }
}
