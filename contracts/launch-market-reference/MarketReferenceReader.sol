// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IV3ReferencePool {
    function factory() external view returns(address);
    function token0() external view returns(address);
    function token1() external view returns(address);
    function fee() external view returns(uint24);
    function liquidity() external view returns(uint128);
    function slot0() external view returns(uint160,int24,uint16,uint16,uint16,uint8,bool);
    function observe(uint32[] calldata) external view returns(int56[] memory,uint160[] memory);
}
interface IV3ReferenceFactory {function getPool(address,address,uint24) external view returns(address);}
interface IEthUsdFeed {
    function decimals() external view returns(uint8);
    function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80);
}

/// @notice RESEARCH ONLY: reads genuine cumulative market history without a custom RWI reporter.
/// @dev Deliberately does NOT implement IRwiUsdOracle. Depth, sequencer recovery and
/// aggregate-exposure policy must be reviewed before any launch integration.
contract MarketReferenceReader {
    address public constant RWI=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    address public constant WETH=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant V3_FACTORY=0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant ETH_USD=0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    uint32 public constant LONG_WINDOW=1800;
    uint32 public constant SHORT_WINDOW=300;
    uint256 public constant ETH_HEARTBEAT=86400;
    IV3ReferencePool public immutable pool;
    struct Reading {
        uint256 price30m;
        uint256 price5m;
        uint256 spot;
        uint256 conservative;
        uint128 harmonicLiquidity30m;
        uint128 currentLiquidity;
        uint64 marketWindowEnd;
        uint64 ethUpdatedAt;
        bool withinTwoPercent;
    }
    error InvalidSource();
    error InvalidEthPrice();
    error NoLiquidity();
    constructor(address pool_) {
        if(block.chainid!=4663||pool_.code.length==0)revert InvalidSource();
        IV3ReferencePool p=IV3ReferencePool(pool_);
        if(p.factory()!=V3_FACTORY||p.token0()!=WETH||p.token1()!=RWI
            ||IV3ReferenceFactory(V3_FACTORY).getPool(WETH,RWI,p.fee())!=pool_
            ||IEthUsdFeed(ETH_USD).decimals()!=8)revert InvalidSource();
        pool=p;
    }
    function meanTick(int56 delta,uint32 period) private pure returns(int24 tick) {
        int56 divisor=int56(uint56(period));tick=int24(delta/divisor);
        // RWI is token1, so the USD quote is the inverse tick price. Round the
        // mean tick UP to avoid overstating RWI's value by one tick.
        if(delta>0&&delta%divisor!=0)tick++;
    }
    function dollars(uint160 sqrtPrice,uint256 ethUsd) private pure returns(uint256) {
        // WETH is token0, RWI token1. This quotient avoids squaring into 256-bit overflow.
        uint256 ratioX128=Math.mulDiv(uint256(sqrtPrice),sqrtPrice,1<<64);
        if(ratioX128==0)revert InvalidSource();
        return Math.mulDiv(ethUsd,1<<128,ratioX128);
    }
    function read() external view returns(Reading memory r) {
        (uint80 round,int256 answer,,uint256 updated,uint80 answered)=IEthUsdFeed(ETH_USD).latestRoundData();
        if(round==0||answer<=0||answered<round||updated==0||updated>block.timestamp||block.timestamp-updated>ETH_HEARTBEAT)revert InvalidEthPrice();
        uint256 usd=uint256(answer)*1e10;
        uint32[] memory ago=new uint32[](3);ago[0]=LONG_WINDOW;ago[1]=SHORT_WINDOW;
        (int56[] memory ticks,uint160[] memory secondsPerLiquidity)=pool.observe(ago);
        int56 longDelta;int56 shortDelta;uint160 liquidityDelta;
        unchecked {longDelta=ticks[2]-ticks[0];shortDelta=ticks[2]-ticks[1];liquidityDelta=secondsPerLiquidity[2]-secondsPerLiquidity[0];}
        r.currentLiquidity=pool.liquidity();
        if(r.currentLiquidity==0||liquidityDelta==0)revert NoLiquidity();
        // Uniswap OracleLibrary's harmonic-liquidity calculation, preserving its rounding.
        r.harmonicLiquidity30m=uint128((uint192(LONG_WINDOW)*type(uint160).max)/(uint192(liquidityDelta)<<32));
        (uint160 spotSqrt,,,,,,bool unlocked)=pool.slot0();if(!unlocked)revert InvalidSource();
        r.price30m=dollars(TickMath.getSqrtPriceAtTick(meanTick(longDelta,LONG_WINDOW)),usd);
        r.price5m=dollars(TickMath.getSqrtPriceAtTick(meanTick(shortDelta,SHORT_WINDOW)),usd);
        r.spot=dollars(spotSqrt,usd);
        r.conservative=Math.min(r.spot,Math.min(r.price30m,r.price5m));
        uint256 upper=Math.max(r.spot,Math.max(r.price30m,r.price5m));
        r.withinTwoPercent=r.conservative>0&&upper-r.conservative<=r.conservative/50;
        // This is the end of an actual cumulative market-history interval. The
        // independent ETH/USD component retains its OWN underlying timestamp.
        r.marketWindowEnd=uint64(block.timestamp);r.ethUpdatedAt=uint64(updated);
    }
}
