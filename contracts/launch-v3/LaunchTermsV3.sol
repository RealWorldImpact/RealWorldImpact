// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Opening FDV and graduation FDV are measured in RWI, with a fixed 10x ratio.
/// @dev Only the curve inventory is reduced. The rest of the fixed supply remains permanently locked.
library LaunchTermsV3 {
    uint256 internal constant SUPPLY=1_000_000_000 ether;
    struct Terms {uint256 phantomQuote;uint256 initialTokens;uint256 reservedTokens;uint256 graduationQuote;uint256 rwiReserveCap;}
    error InvalidTerms();
    function calculate(uint256 openingCapRwi,uint256 reserveCap) internal pure returns(Terms memory t){
        if(openingCapRwi<1e12||openingCapRwi>1e33||reserveCap<1e12||reserveCap>1e33)revert InvalidTerms();
        t=_forInventory(openingCapRwi,SUPPLY,reserveCap);
        if(t.graduationQuote+10<=reserveCap)return t;
        // Q = P * (sqrt(10) - 1). The conjugate gives floor(Pmax) without floating-point math.
        uint256 maxPhantom=(Math.sqrt(10*reserveCap*reserveCap)+reserveCap)/9;
        // Bound token-unit and phantom-unit rounding, plus final-fill fee rounding (up to 4%).
        uint256 margin=(openingCapRwi/SUPPLY+1)*32+100;
        if(maxPhantom<=margin)revert InvalidTerms();
        uint256 inventory=Math.mulDiv(maxPhantom-margin,SUPPLY,openingCapRwi);
        if(inventory==0||inventory>=SUPPLY)revert InvalidTerms();
        t=_forInventory(openingCapRwi,inventory,reserveCap);
        if(t.graduationQuote+10>reserveCap)revert InvalidTerms();
    }
    function _forInventory(uint256 openingCapRwi,uint256 inventory,uint256 reserveCap) private pure returns(Terms memory t){
        uint256 phantom=Math.mulDiv(openingCapRwi,inventory,SUPPLY,Math.Rounding.Ceil);
        uint256 reserved=Math.sqrt(inventory*inventory/10);
        if(reserved==0||reserved>=inventory)revert InvalidTerms();
        // Same inverse rounding as Pons' curve math: floor(input) + 1.
        uint256 threshold=Math.mulDiv(inventory-reserved,phantom,reserved)+1;
        return Terms(phantom,inventory,reserved,threshold,reserveCap);
    }
}
