// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {LaunchTermsV3} from "./LaunchTermsV3.sol";
/// @dev Local tests only. Never part of the deployment bundle.
contract LaunchTermsHarness {
    function calculate(uint256 openingCapRwi,uint256 reserveCap) external pure returns(LaunchTermsV3.Terms memory){
        return LaunchTermsV3.calculate(openingCapRwi,reserveCap);
    }
}
