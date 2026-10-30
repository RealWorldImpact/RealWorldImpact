// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IRwiUsdOracle} from "./IRwiUsdOracle.sol";
import {CurveEconomics} from "./CurveEconomics.sol";
import {RWILaunchV4} from "./RWILaunchV4.sol";

/// @dev TEST ONLY. Anyone can change this source. Never a production price adapter.
contract MockRwiOracle is IRwiUsdOracle {
    address public constant asset=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    Quote private quote;
    uint256 public mode;
    function set(Quote calldata q,uint256 mode_) external {quote=q;mode=mode_;}
    function latestQuote() external view returns(Quote memory){
        require(mode!=1,"Unavailable test source");
        if(mode==2){while(gasleft()>50){assembly{pop(keccak256(0,0))}}revert();}
        return quote;
    }
}
contract EconomicsHarness {
    function terms(uint256 price) external pure returns(uint256,uint256){return CurveEconomics.terms(price);}
    function eligible(uint256 p,uint256 q,uint256 t,uint256 usd) external pure returns(bool){return CurveEconomics.eligible(p,q,t,usd);}
    function buy(uint256 p,uint256 q,uint256 t,uint16 tax,uint256 gross,uint256 usd) external pure returns(uint256,uint256){return CurveEconomics.buy(p,q,t,tax,gross,usd);}
    function fdv(uint256 p,uint256 q,uint256 t,uint256 usd) external pure returns(uint256){return CurveEconomics.fdv(p,q,t,usd);}
}

/// @dev TEST ONLY. Exercises failed ETH payouts and reentrant reward claims.
contract CreatorProbe {
    RWILaunchV4 public factory;
    address public token;
    bool public rejectEth;
    bool public attempted;
    bool public reentered;
    bytes4 public rejection;
    constructor(address factory_){factory=RWILaunchV4(factory_);}
    function create(uint256 price,bytes32 salt) external {
        RWILaunchV4.Metadata memory m=RWILaunchV4.Metadata("Creator probe","PROBE","","","","","");
        token=factory.launch(m,price,price,300,salt,block.timestamp+120);
    }
    function setReject(bool value) external {rejectEth=value;}
    function claim() external {factory.claimRewards(token,1,block.timestamp+120);}
    receive() external payable {
        require(!rejectEth,"Reject test payout");
        attempted=true;
        bytes memory reason;
        (reentered,reason)=address(factory).call(abi.encodeCall(factory.claimRewards,(token,1,block.timestamp+120)));
        if(reason.length>=4)rejection=bytes4(reason);
    }
}
