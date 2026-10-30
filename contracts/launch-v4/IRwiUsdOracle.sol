// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Required interface for a separately reviewed production price adapter.
/// @dev These fields do NOT make an untrusted source trustworthy. No production
/// adapter is supplied in this research build. A spot-price wrapper is unsuitable.
interface IRwiUsdOracle {
    struct Quote {
        uint256 price; // USD per whole RWI, 18 decimals; reference for new launches.
        uint256 lower; // Conservative USD valuation used for irreversible graduation.
        uint256 upper;
        uint64 observedAt; // Underlying observation time, never wrapper-call time.
        uint32 window; // Time covered by the manipulation-resistant observation.
    }
    function asset() external view returns (address);
    function latestQuote() external view returns (Quote memory);
}
