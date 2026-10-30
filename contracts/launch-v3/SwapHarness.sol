// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// LOCAL TEST HELPER ONLY. Excluded from public deployment artifacts.
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract SwapHarness {
 IPoolManager public constant manager=IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
 function swap(PoolKey calldata key,bool zeroForOne,int256 amount) external payable returns(int128,int128){
  uint256 beforeBalance=address(this).balance-msg.value;
  bytes memory result=manager.unlock(abi.encode(key,msg.sender,zeroForOne,amount));
  uint256 refund=address(this).balance-beforeBalance;if(refund!=0){(bool ok,)=msg.sender.call{value:refund}("");require(ok);}
  return abi.decode(result,(int128,int128));
 }
 function unlockCallback(bytes calldata data) external returns(bytes memory){
  require(msg.sender==address(manager));(PoolKey memory key,address payer,bool zeroForOne,int256 amount)=abi.decode(data,(PoolKey,address,bool,int256));
  BalanceDelta d=manager.swap(key,SwapParams(zeroForOne,amount,zeroForOne?TickMath.MIN_SQRT_PRICE+1:TickMath.MAX_SQRT_PRICE-1),bytes(""));
  settle(key.currency0,payer,d.amount0());settle(key.currency1,payer,d.amount1());return abi.encode(d.amount0(),d.amount1());
 }
 function settle(Currency c,address payer,int128 amount) private {
  if(amount<0){uint256 due=uint256(-int256(amount));manager.sync(c);if(Currency.unwrap(c)==address(0))manager.settle{value:due}();else{require(IERC20(Currency.unwrap(c)).transferFrom(payer,address(manager),due));manager.settle();}}
  else if(amount>0)manager.take(c,payer,uint256(uint128(amount)));
 }
}
