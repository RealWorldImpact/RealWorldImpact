// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CurveEconomics} from "./CurveEconomics.sol";
import {RWILaunchV5} from "./RWILaunchV5.sol";
contract EconomicsHarness {
    function terms(uint256 price) external pure returns(uint256,uint256,uint256,uint256){return CurveEconomics.terms(price);}
    function buy(uint256 p,uint256 q,uint256 t,uint256 floor,uint16 tax,uint256 gross) external pure returns(uint256,uint256){return CurveEconomics.buy(p,q,t,floor,tax,gross);}
}
/// @dev TEST ONLY: rejects ETH and attempts reentrant fee claims.
contract CreatorProbe {
    RWILaunchV5 public factory;
    address public token;
    bool public rejectEth;
    bool public attempted;
    bool public reentered;
    bytes4 public rejection;
    constructor(address factory_){factory=RWILaunchV5(factory_);}
    function create(uint256 price,bytes32 salt) external {
        RWILaunchV5.Metadata memory m=RWILaunchV5.Metadata("Creator probe","PROBE","","","","","");
        token=factory.launch(m,price,price,300,salt,block.timestamp+120);
    }
    function setReject(bool value) external {rejectEth=value;}
    function claim() external {factory.claimRewards(token,1,block.timestamp+120);}
    receive() external payable {
        require(!rejectEth,"Reject test payout");attempted=true;bytes memory reason;
        (reentered,reason)=address(factory).call(abi.encodeCall(factory.claimRewards,(token,1,block.timestamp+120)));
        if(reason.length>=4)rejection=bytes4(reason);
    }
}
