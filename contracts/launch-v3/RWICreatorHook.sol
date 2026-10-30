// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Fixed RWI-side fees, held as PoolManager credits until an ETH reward claim.
/// @dev Only enabled callbacks are implemented; every other selector reverts.
contract RWICreatorHook {
    IPoolManager public constant manager=IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address public constant RWI=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    address public factory;
    mapping(address=>bool) public registered;
    mapping(address=>uint16) public creatorTaxBps;
    mapping(address=>uint256) public rewards;
    bool private withdrawing;
    error Unauthorized();
    error InvalidPool();
    error InvalidFee();
    constructor(){
        // beforeInitialize, beforeSwap, afterSwap and both swap return deltas.
        if(uint160(address(this))&0x3fff!=0x20cc) revert InvalidPool();
        factory=msg.sender;
    }
    modifier onlyFactory(){if(msg.sender!=factory)revert Unauthorized();_;}
    modifier onlyManager(){if(msg.sender!=address(manager))revert Unauthorized();_;}
    function register(address token,uint16 tax) external onlyFactory {
        if(registered[token]||token==address(0)||token==RWI||tax>300||tax%100!=0)revert InvalidPool();
        registered[token]=true;creatorTaxBps[token]=tax;
    }
    function tokenFor(PoolKey calldata key) private view returns(address token){
        address c0=Currency.unwrap(key.currency0);address c1=Currency.unwrap(key.currency1);
        token=c0==RWI?c1:c0;
        if((c0!=RWI&&c1!=RWI)||c0>=c1||!registered[token]||key.fee!=0||key.tickSpacing!=200||address(key.hooks)!=address(this))revert InvalidPool();
    }
    function beforeInitialize(address sender,PoolKey calldata key,uint160) external view onlyManager returns(bytes4){
        tokenFor(key);if(sender!=factory)revert Unauthorized();return IHooks.beforeInitialize.selector;
    }
    function specifiedIsRwi(PoolKey calldata key,SwapParams calldata p) private pure returns(bool){
        return Currency.unwrap((p.amountSpecified<0)==p.zeroForOne?key.currency0:key.currency1)==RWI;
    }
    function fee(address token,uint256 amount,bool grossUp) private view returns(uint256){
        uint256 tax=creatorTaxBps[token];
        return grossUp?Math.mulDiv(amount,100+tax,10000-100-tax,Math.Rounding.Ceil):amount/100+Math.mulDiv(amount,tax,10000);
    }
    function accrue(address token,uint256 amount) private returns(int128){
        if(amount>uint256(uint128(type(int128).max)))revert InvalidFee();
        if(amount!=0){rewards[token]+=amount;manager.mint(address(this),uint256(uint160(RWI)),amount);}
        return int128(uint128(amount));
    }
    function beforeSwap(address,PoolKey calldata key,SwapParams calldata p,bytes calldata) external onlyManager returns(bytes4,BeforeSwapDelta,uint24){
        address token=tokenFor(key);int128 charge;
        if(specifiedIsRwi(key,p)){
            if(p.amountSpecified==type(int256).min)revert InvalidFee();
            uint256 amount=uint256(p.amountSpecified<0?-p.amountSpecified:p.amountSpecified);
            charge=accrue(token,fee(token,amount,p.amountSpecified>0));
        }
        return (IHooks.beforeSwap.selector,toBeforeSwapDelta(charge,0),0);
    }
    function afterSwap(address,PoolKey calldata key,SwapParams calldata p,BalanceDelta delta,bytes calldata) external onlyManager returns(bytes4,int128){
        address token=tokenFor(key);int128 charge;
        if(!specifiedIsRwi(key,p)){
            int128 rwiDelta=Currency.unwrap(key.currency0)==RWI?delta.amount0():delta.amount1();
            uint256 amount=uint256(rwiDelta<0?-int256(rwiDelta):int256(rwiDelta));
            charge=accrue(token,fee(token,amount,rwiDelta<0));
        }
        return (IHooks.afterSwap.selector,charge);
    }
    function withdrawRewards(address token) external onlyFactory returns(uint256 amount){
        amount=rewards[token];if(amount==0)return 0;
        rewards[token]=0;withdrawing=true;
        manager.unlock(abi.encode(amount));withdrawing=false;
    }
    function unlockCallback(bytes calldata data) external onlyManager returns(bytes memory){
        if(!withdrawing)revert Unauthorized();
        uint256 amount=abi.decode(data,(uint256));
        manager.burn(address(this),uint256(uint160(RWI)),amount);
        manager.take(Currency.wrap(RWI),factory,amount);
        return bytes("");
    }
}
