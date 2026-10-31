// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IEthUsdReference {
    function decimals() external view returns(uint8);
    function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80);
}
interface IRwiMarketState {
    function getSlot0(bytes32) external view returns(uint160,int24,uint24,uint24);
    function getLiquidity(bytes32) external view returns(uint128);
}
/// @notice Creation-time market reference only. Never consulted by swaps or graduation.
/// @dev This is an executable-market spot reference, NOT a manipulation-resistant RWI oracle.
library OpeningReference {
    address internal constant ETH_USD=0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address internal constant STATE=0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    bytes32 internal constant RWI_POOL=0xa72a9de2c6e3db34308a8ae61e927ceffea630218ca1e712b70b61341c3e99a1;
    uint256 internal constant ETH_MAX_AGE=86400;
    error OpeningPriceUnavailable();
    function read() internal view returns(uint256 rwiUsd,uint64 ethUpdatedAt) {
        IEthUsdReference feed=IEthUsdReference(ETH_USD);
        (uint80 round,int256 answer,,uint256 updated,uint80 answered)=feed.latestRoundData();
        if(feed.decimals()!=8||round==0||answer<=0||answered<round||updated==0||updated>block.timestamp||block.timestamp-updated>ETH_MAX_AGE)revert OpeningPriceUnavailable();
        (uint160 sqrtPrice,,,)=IRwiMarketState(STATE).getSlot0(RWI_POOL);
        if(sqrtPrice==0||IRwiMarketState(STATE).getLiquidity(RWI_POOL)==0)revert OpeningPriceUnavailable();
        uint256 ratioX128=Math.mulDiv(uint256(sqrtPrice),sqrtPrice,1<<64);
        if(ratioX128==0)revert OpeningPriceUnavailable();
        rwiUsd=Math.mulDiv(uint256(answer)*1e10,1<<128,ratioX128);ethUpdatedAt=uint64(updated);
    }
}
