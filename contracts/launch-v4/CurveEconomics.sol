// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Constant product in RWI; dollar thresholds are evaluated separately.
library CurveEconomics {
    uint256 internal constant WAD = 1 ether;
    uint256 internal constant SUPPLY = 1_000_000_000 ether;
    uint256 internal constant START_USD = 5_000 ether;
    uint256 internal constant TARGET_USD = 50_000 ether;
    uint256 internal constant MIN_POOL_USD = 5_000 ether;
    // One cent of quote-side rounding headroom. Actual minted funding is checked.
    uint256 internal constant SEED_QUOTE_USD = 2_500.01 ether;
    uint256 internal constant MIN_PRICE = 1e9; // $0.000000001/RWI
    uint256 internal constant MAX_PRICE = 1_000_000 ether;
    error InvalidEconomics();

    function terms(uint256 price) internal pure returns (uint256 phantom, uint256 inventory) {
        if (price < MIN_PRICE || price > MAX_PRICE) revert InvalidEconomics();
        uint256 sqrtTen = Math.sqrt(10 * WAD * WAD);
        uint256 virtualUsd = Math.mulDiv(SEED_QUOTE_USD, WAD, sqrtTen - WAD);
        inventory = Math.mulDiv(virtualUsd, SUPPLY, START_USD);
        // Round up by at most one RWI wei; creation cannot understate its price.
        uint256 openingRwi = Math.mulDiv(START_USD, WAD, price, Math.Rounding.Ceil);
        phantom = Math.mulDiv(openingRwi, inventory, SUPPLY, Math.Rounding.Ceil);
    }

    function fees(uint256 gross, uint16 tax) internal pure returns (uint256) {
        // Preserve the published V2/V3 fee policy: 1% base plus 0/1/2/3%, creator-owned.
        // One rounding operation makes net(gross) monotone. Two separate floors
        // can both increment on the same wei and break the final-fill search.
        return Math.mulDiv(gross, 100 + uint256(tax), 10_000);
    }

    function output(uint256 input, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        return Math.mulDiv(input, reserveOut, reserveIn + input);
    }

    function fdv(uint256 phantom, uint256 quote, uint256 tokens, uint256 lowerUsd) internal pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(phantom + quote, SUPPLY, tokens), lowerUsd, WAD);
    }

    function eligible(uint256 phantom, uint256 quote, uint256 tokens, uint256 lowerUsd) internal pure returns (bool) {
        return tokens != 0 && Math.mulDiv(quote, lowerUsd, WAD) >= SEED_QUOTE_USD
            && fdv(phantom, quote, tokens, lowerUsd) >= TARGET_USD;
    }

    /// @dev Exact fee-aware minimal final fill. No floating point or inverse-fee approximation.
    function buy(uint256 phantom, uint256 quote, uint256 tokens, uint16 tax, uint256 gross, uint256 lowerUsd)
        internal pure returns (uint256 out, uint256 spent)
    {
        spent = gross;
        uint256 net = gross - fees(gross, tax);
        out = output(net, phantom + quote, tokens);
        if (eligible(phantom, quote + net, tokens - out, lowerUsd)) {
            uint256 low;
            uint256 high = gross;
            while (high - low > 1) {
                uint256 middle = low + (high - low) / 2;
                uint256 n = middle - fees(middle, tax);
                uint256 t = output(n, phantom + quote, tokens);
                if (eligible(phantom, quote + n, tokens - t, lowerUsd)) high = middle;
                else low = middle;
            }
            spent = high;
            out = output(spent - fees(spent, tax), phantom + quote, tokens);
        }
        if (spent == 0 || out == 0 || out >= tokens) revert InvalidEconomics();
    }
}
