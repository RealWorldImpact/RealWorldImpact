// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// Local fork test helper only. Never included in deployment artifacts or the site.
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract SwapTest is IUnlockCallback {
    IPoolManager public manager;
    constructor(address m){manager=IPoolManager(m);}
    function swap(PoolKey calldata key,bool zeroForOne,uint256 amount) external {
        manager.unlock(abi.encode(key,msg.sender,zeroForOne,amount));
    }
    function unlockCallback(bytes calldata data) external returns(bytes memory){
        require(msg.sender==address(manager));
        (PoolKey memory key,address payer,bool zeroForOne,uint256 amount)=abi.decode(data,(PoolKey,address,bool,uint256));
        BalanceDelta delta=manager.swap(key,SwapParams(zeroForOne,-int256(amount),zeroForOne?uint160(4295128740):uint160(1461446703485210103287273052203988822378723970341)),bytes(""));
        int128 a=delta.amount0();int128 b=delta.amount1();
        settle(key.currency0,payer,a);settle(key.currency1,payer,b);
        return bytes("");
    }
    function settle(Currency c,address payer,int128 amount) private {
        if(amount<0){manager.sync(c);require(IERC20(Currency.unwrap(c)).transferFrom(payer,address(manager),uint256(-int256(amount))));manager.settle();}
        else if(amount>0)manager.take(c,payer,uint256(uint128(amount)));
    }
}
