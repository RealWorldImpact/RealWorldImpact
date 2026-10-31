// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pons-style constant product and fixed sellable allocation, denominated in RWI.
/// @dev USD values calibrate the opening terms only. They are NOT live graduation gates.
library CurveEconomics {
    uint256 internal constant WAD=1 ether;
    uint256 internal constant SUPPLY=1_000_000_000 ether;
    uint256 internal constant START_REFERENCE_USD=5_000 ether;
    uint256 internal constant GRADUATION_REFERENCE_USD=40_000 ether;
    uint256 internal constant SEED_REFERENCE_USD=2_500.01 ether;
    uint256 internal constant MIN_PRICE=1e9;
    uint256 internal constant MAX_PRICE=1_000_000 ether;
    error InvalidEconomics();

    function terms(uint256 openingRwiUsd) internal pure returns(uint256 phantom,uint256 inventory,uint256 reserved,uint256 referenceQuote) {
        if(openingRwiUsd<MIN_PRICE||openingRwiUsd>MAX_PRICE)revert InvalidEconomics();
        uint256 growth=Math.sqrt(Math.mulDiv(GRADUATION_REFERENCE_USD,WAD*WAD,START_REFERENCE_USD));
        uint256 virtualUsd=Math.mulDiv(SEED_REFERENCE_USD,WAD,growth-WAD);
        inventory=Math.mulDiv(virtualUsd,SUPPLY,START_REFERENCE_USD);
        uint256 openingFdvRwi=Math.mulDiv(START_REFERENCE_USD,WAD,openingRwiUsd,Math.Rounding.Ceil);
        phantom=Math.mulDiv(openingFdvRwi,inventory,SUPPLY,Math.Rounding.Ceil);
        referenceQuote=Math.mulDiv(SEED_REFERENCE_USD,WAD,openingRwiUsd,Math.Rounding.Ceil);
        reserved=Math.mulDiv(inventory,phantom,phantom+referenceQuote);
        if(reserved==0||reserved>=inventory)revert InvalidEconomics();
    }
    function fees(uint256 gross,uint16 tax) internal pure returns(uint256) {
        return Math.mulDiv(gross,100+uint256(tax),10_000);
    }
    function output(uint256 input,uint256 reserveIn,uint256 reserveOut) internal pure returns(uint256) {
        return Math.mulDiv(input,reserveOut,reserveIn+input);
    }
    function ready(uint256 tokens,uint256 reserved) internal pure returns(bool) {return tokens==reserved;}
    function buy(uint256 phantom,uint256 quote,uint256 tokens,uint256 reserved,uint16 tax,uint256 gross)
        internal pure returns(uint256 out,uint256 spent)
    {
        if(gross==0||tokens<=reserved)revert InvalidEconomics();
        uint256 available=tokens-reserved;
        spent=gross;out=output(gross-fees(gross,tax),phantom+quote,tokens);
        if(out>=available){
            // Find the smallest fee-aware input that exhausts the sellable allocation.
            uint256 lo;uint256 hi=gross;
            while(hi-lo>1){
                uint256 mid=lo+(hi-lo)/2;
                if(output(mid-fees(mid,tax),phantom+quote,tokens)>=available)hi=mid;else lo=mid;
            }
            spent=hi;out=available;
        }
        if(out==0||spent==0)revert InvalidEconomics();
    }
}
