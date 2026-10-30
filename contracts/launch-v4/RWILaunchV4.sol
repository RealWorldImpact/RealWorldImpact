// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId,PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {PonsV2GraduationMath as GraduationMath} from "../launch-v3/vendor/PonsV2GraduationMath.sol";
import {CurveEconomics as Economics} from "./CurveEconomics.sol";
import {IRwiUsdOracle} from "./IRwiUsdOracle.sol";
import {RWICreatorHookV4} from "./RWICreatorHookV4.sol";

interface IV4PositionManager {
    function poolManager() external view returns(address);
    function permit2() external view returns(address);
    function nextTokenId() external view returns(uint256);
    function ownerOf(uint256) external view returns(address);
    function getPositionLiquidity(uint256) external view returns(uint128);
    function modifyLiquidities(bytes calldata,uint256) external payable;
}
interface IV4Permit2 {function approve(address,address,uint160,uint48) external;}

contract RWICurveTokenV4 is ERC20 {
    string public logo;string public description;string public website;string public twitter;string public telegram;
    address public creator;
    constructor(string memory name_,string memory symbol_,string memory logo_,string memory description_,string memory website_,string memory twitter_,string memory telegram_,address creator_) ERC20(name_,symbol_){
        logo=logo_;description=description_;website=website_;twitter=twitter_;telegram=telegram_;creator=creator_;
        _mint(msg.sender,1_000_000_000 ether);
    }
}

/// @notice Research build: constant-product pricing with independently verified USD graduation.
/// @dev No owner, upgrades, launch fee, premine, liquidity withdrawal or arbitrary-call surface.
contract RWILaunchV4 is ReentrancyGuard,IERC721Receiver {
    using SafeERC20 for IERC20;using PoolIdLibrary for PoolKey;
    address public constant RWI=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    address public constant POSITION_MANAGER=0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address public constant POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address public constant PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant SUPPLY=1_000_000_000 ether;
    uint256 public constant BASE_FEE_BPS=100;
    uint256 public constant MAX_ORACLE_AGE=300;
    uint256 public constant MIN_ORACLE_WINDOW=1800;
    uint256 public constant GRADUATION_DELAY=300;
    IRwiUsdOracle public immutable oracle;
    struct Metadata {string name;string symbol;string logo;string description;string website;string twitter;string telegram;}
    // phase stays 0 during eligibility and failed graduation; redemption remains open.
    struct Launch {
        address creator; uint256 positionId; bytes32 poolId; uint256 phantomQuote;
        uint256 quoteReserve; uint256 tokenReserve; uint256 initialTokens;
        uint256 openingRwiUsd; uint256 seededQuote; uint256 seededTokens;
        uint64 launchedAt; uint64 readySince; uint64 readyObservation;
        uint16 creatorTaxBps; uint8 phase;
    }
    mapping(address=>Launch) public launches;
    mapping(address=>uint256) public curveRewards;
    address[] public launchedTokens;
    address public router;
    RWICreatorHookV4 public hook;
    bool private minting;
    event TokenLaunched(address indexed token,address indexed creator,uint256 phantomQuote,uint256 initialInventory,uint256 openingRwiUsd,uint16 creatorTaxBps);
    event EligibilityUpdated(address indexed token,bool ready,uint64 readySince);
    event CurveTrade(address indexed token,address indexed trader,bool buy,uint256 rwiAmount,uint256 tokenAmount,uint256 fee);
    event PoolGraduated(address indexed token,bytes32 indexed poolId,uint256 positionId,uint256 rwiSeed,uint256 tokenSeed,uint256 lockedExcess);
    event RewardsClaimed(address indexed token,address indexed creator,uint256 rwiConverted,uint256 ethPaid);
    error InvalidInput();error Unauthorized();error Expired();error Slippage();error ClosedCurve();error UnexpectedReceipt();
    error InvalidOracle();error GraduationReady();error NotReady();error UnfundableAtCurrentPrice();
    constructor(bytes32 hookSalt,address oracle_){
        if(oracle_.code.length==0||IRwiUsdOracle(oracle_).asset()!=RWI)revert InvalidOracle();
        oracle=IRwiUsdOracle(oracle_);readOracle();
        if(block.chainid!=4663||RWI.code.length==0||IV4PositionManager(POSITION_MANAGER).poolManager()!=POOL_MANAGER||IV4PositionManager(POSITION_MANAGER).permit2()!=PERMIT2)revert InvalidInput();
        hook=new RWICreatorHookV4{salt:hookSalt}();
        router=address(new RWILaunchRouterV4(address(this)));
    }
    modifier onlyRouter(){if(msg.sender!=router)revert Unauthorized();_;}
    function validDeadline(uint256 deadline) private view {if(block.timestamp>deadline||deadline>block.timestamp+1200)revert Expired();}
    function readOracle() public view returns(IRwiUsdOracle.Quote memory q){
        q=oracle.latestQuote{gas:100000}();
        if(q.lower<Economics.MIN_PRICE||q.upper>Economics.MAX_PRICE||q.lower>q.price||q.price>q.upper
            ||q.upper*10000>q.lower*10200||q.observedAt==0||q.observedAt>block.timestamp
            ||block.timestamp-q.observedAt>MAX_ORACLE_AGE||q.window<MIN_ORACLE_WINDOW
            ||q.window>q.observedAt)revert InvalidOracle();
    }
    function launch(Metadata calldata m,uint256 minRwiUsd,uint256 maxRwiUsd,uint16 tax,bytes32 salt,uint256 deadline) external nonReentrant returns(address token){
        validDeadline(deadline);
        if(bytes(m.name).length==0||bytes(m.name).length>128||bytes(m.symbol).length==0||bytes(m.symbol).length>40||bytes(m.logo).length>2048||bytes(m.description).length>1024||bytes(m.website).length>512||bytes(m.twitter).length>512||bytes(m.telegram).length>512||tax>300||tax%100!=0)revert InvalidInput();
        IRwiUsdOracle.Quote memory q=readOracle();
        if(minRwiUsd==0||minRwiUsd>maxRwiUsd||q.price<minRwiUsd||q.price>maxRwiUsd)revert Slippage();
        (uint256 phantom,uint256 inventory)=Economics.terms(q.price);
        ensureFundingPossible(phantom,0,inventory,q.lower);
        token=address(new RWICurveTokenV4{salt:keccak256(abi.encode(msg.sender,salt))}(m.name,m.symbol,m.logo,m.description,m.website,m.twitter,m.telegram,msg.sender));
        Launch storage l=launches[token];l.creator=msg.sender;l.phantomQuote=phantom;
        l.tokenReserve=inventory;l.initialTokens=inventory;l.openingRwiUsd=q.price;
        l.creatorTaxBps=tax;l.launchedAt=uint64(block.timestamp);
        launchedTokens.push(token);hook.register(token,tax);
        emit TokenLaunched(token,msg.sender,phantom,inventory,q.price,tax);
    }
    function previewTerms() external view returns(uint256 phantom,uint256 inventory,uint256 referenceUsd){
        IRwiUsdOracle.Quote memory q=readOracle();referenceUsd=q.price;
        (phantom,inventory)=Economics.terms(referenceUsd);
    }
    function phaseOf(address token) external view returns(uint8){if(launches[token].creator==address(0))revert InvalidInput();return launches[token].phase;}
    function launchCount() external view returns(uint256){return launchedTokens.length;}

    function rewardRwi(address token) external view returns(uint256){return curveRewards[token]+hook.rewards(token);}
    function keyFor(address token) public view returns(PoolKey memory){
        if(launches[token].creator==address(0))revert InvalidInput();
        bool token0=token<RWI;
        return PoolKey(Currency.wrap(token0?token:RWI),Currency.wrap(token0?RWI:token),0,200,IHooks(address(hook)));
    }
    function openCurve(address token) private view returns(Launch storage l){
        l=launches[token];if(l.creator==address(0)||l.phase!=0)revert ClosedCurve();
    }
    /// @dev A necessary upper-bound check, NOT a promise all RWI is liquid or available.
    /// Refuse new deposits when even the entire current supply could not graduate.
    function ensureFundingPossible(uint256 phantom,uint256 quote,uint256 tokens,uint256 lowerUsd) private view {
        uint256 total=IERC20(RWI).totalSupply();
        if(total<quote)revert UnfundableAtCurrentPrice();
        uint256 remaining=tokens-Economics.output(total-quote,phantom+quote,tokens);
        if(!Economics.eligible(phantom,total,remaining,lowerUsd))revert UnfundableAtCurrentPrice();
    }
    function graduationStatus(address token) external view returns(uint256 fdvUsd,uint256 quoteUsd,bool eligible,bool delayComplete){
        Launch storage l=openCurve(token);IRwiUsdOracle.Quote memory q=readOracle();
        fdvUsd=Economics.fdv(l.phantomQuote,l.quoteReserve,l.tokenReserve,q.lower);
        quoteUsd=Math.mulDiv(l.quoteReserve,q.lower,1 ether);
        eligible=Economics.eligible(l.phantomQuote,l.quoteReserve,l.tokenReserve,q.lower);
        delayComplete=eligible&&l.readySince!=0&&block.timestamp>=l.readySince+GRADUATION_DELAY&&q.observedAt>=l.readySince+GRADUATION_DELAY;
    }
    function syncEligibility(address token,Launch storage l,IRwiUsdOracle.Quote memory q) private {
        bool ready=Economics.eligible(l.phantomQuote,l.quoteReserve,l.tokenReserve,q.lower);
        if(ready&&l.readySince==0){l.readySince=uint64(block.timestamp);l.readyObservation=q.observedAt;emit EligibilityUpdated(token,true,l.readySince);}
        else if(!ready&&l.readySince!=0){clearEligibility(l);emit EligibilityUpdated(token,false,0);}
    }
    function clearEligibility(Launch storage l) private {l.readySince=0;l.readyObservation=0;}
    function checkpoint(address token) external nonReentrant {Launch storage l=openCurve(token);syncEligibility(token,l,readOracle());}
    function refreshEligibility(address token) external {if(msg.sender!=address(this))revert Unauthorized();Launch storage l=openCurve(token);syncEligibility(token,l,readOracle());}
    function quoteBuy(address token,uint256 rwiIn) public view returns(uint256 out,uint256 spent){
        Launch storage l=openCurve(token);if(rwiIn==0||rwiIn>uint256(uint128(type(int128).max)))revert InvalidInput();
        IRwiUsdOracle.Quote memory q=readOracle();
        if(Economics.eligible(l.phantomQuote,l.quoteReserve,l.tokenReserve,q.lower))revert GraduationReady();
        ensureFundingPossible(l.phantomQuote,l.quoteReserve,l.tokenReserve,q.lower);
        return Economics.buy(l.phantomQuote,l.quoteReserve,l.tokenReserve,l.creatorTaxBps,rwiIn,q.lower);
    }
    function quoteSell(address token,uint256 tokensIn) public view returns(uint256 out,uint256 charge){
        Launch storage l=openCurve(token);
        if(tokensIn==0||tokensIn>l.initialTokens-l.tokenReserve)revert InvalidInput();
        uint256 gross=Economics.output(tokensIn,l.tokenReserve,l.phantomQuote+l.quoteReserve);
        if(gross==0||gross>l.quoteReserve)revert InvalidInput();
        charge=Economics.fees(gross,l.creatorTaxBps);out=gross-charge;
        if(out==0)revert InvalidInput();
    }
    function buyCurve(address token,uint256 rwiIn,address trader) external onlyRouter nonReentrant returns(uint256 out,uint256 spent){
        (out,spent)=quoteBuy(token,rwiIn);Launch storage l=launches[token];uint256 charge=Economics.fees(spent,l.creatorTaxBps);
        uint256 beforeBalance=IERC20(RWI).balanceOf(address(this));IERC20(RWI).safeTransferFrom(msg.sender,address(this),spent);
        if(IERC20(RWI).balanceOf(address(this))-beforeBalance!=spent)revert InvalidInput();
        l.quoteReserve+=spent-charge;l.tokenReserve-=out;curveRewards[token]+=charge;
        IERC20(token).safeTransfer(trader,out);emit CurveTrade(token,trader,true,spent,out,charge);
        syncEligibility(token,l,readOracle());
    }
    function sellCurve(address token,uint256 amount,address trader) external onlyRouter nonReentrant returns(uint256 out){
        uint256 charge;(out,charge)=quoteSell(token,amount);Launch storage l=launches[token];
        IERC20(token).safeTransferFrom(msg.sender,address(this),amount);
        l.tokenReserve+=amount;l.quoteReserve-=out+charge;curveRewards[token]+=charge;
        // A failed, stale or gas-consuming price source must not freeze redemption.
        try this.refreshEligibility{gas:160000}(token){}catch{clearEligibility(l);}
        IERC20(RWI).safeTransfer(msg.sender,out);emit CurveTrade(token,trader,false,out,amount,charge);
    }
    function graduate(address token) external nonReentrant {this.executeGraduation(token);}
    /// @dev Graduation is atomic and permissionless. Any failure leaves the curve redeemable.
    function executeGraduation(address token) external {
        if(msg.sender!=address(this))revert Unauthorized();Launch storage l=openCurve(token);
        IRwiUsdOracle.Quote memory q=readOracle();
        if(l.readySince==0||block.timestamp<l.readySince+GRADUATION_DELAY||q.observedAt<l.readySince+GRADUATION_DELAY
            ||!Economics.eligible(l.phantomQuote,l.quoteReserve,l.tokenReserve,q.lower))revert NotReady();
        uint256 quote=l.quoteReserve;
        uint256 tokenSeed=Math.mulDiv(l.tokenReserve,quote,quote+l.phantomQuote);
        PoolKey memory key=keyFor(token);bool token0=token<RWI;
        uint256 a0=token0?tokenSeed:quote;uint256 a1=token0?quote:tokenSeed;
        if(a0==0||a1==0||a0>type(uint128).max||a1>type(uint128).max)revert InvalidInput();
        uint160 sqrtPrice=GraduationMath.sqrtPriceX96FromAmounts(a0,a1);
        int24 lower=TickMath.minUsableTick(200);int24 upper=TickMath.maxUsableTick(200);
        uint128 liquidity=LiquidityAmounts.getLiquidityForAmounts(sqrtPrice,TickMath.getSqrtPriceAtTick(lower),TickMath.getSqrtPriceAtTick(upper),a0,a1);
        if(liquidity==0)revert InvalidInput();
        IPoolManager(POOL_MANAGER).initialize(key,sqrtPrice);
        IERC20(token).forceApprove(PERMIT2,tokenSeed);IERC20(RWI).forceApprove(PERMIT2,quote);
        IV4Permit2(PERMIT2).approve(token,POSITION_MANAGER,uint160(tokenSeed),uint48(block.timestamp+600));
        IV4Permit2(PERMIT2).approve(RWI,POSITION_MANAGER,uint160(quote),uint48(block.timestamp+600));
        uint256 id=IV4PositionManager(POSITION_MANAGER).nextTokenId();bytes[] memory params=new bytes[](2);
        params[0]=abi.encode(key,lower,upper,uint256(liquidity),uint128(a0),uint128(a1),address(this),bytes(""));
        params[1]=abi.encode(key.currency0,key.currency1);
        uint256 beforeRwi=IERC20(RWI).balanceOf(address(this));
        uint256 beforeToken=IERC20(token).balanceOf(address(this));
        minting=true;IV4PositionManager(POSITION_MANAGER).modifyLiquidities(abi.encode(hex"020d",params),block.timestamp+600);minting=false;
        if(IV4PositionManager(POSITION_MANAGER).ownerOf(id)!=address(this)||IV4PositionManager(POSITION_MANAGER).getPositionLiquidity(id)!=liquidity)revert UnexpectedReceipt();
        uint256 actualQuote=beforeRwi-IERC20(RWI).balanceOf(address(this));
        uint256 actualTokens=beforeToken-IERC20(token).balanceOf(address(this));
        if(actualQuote>quote||actualTokens>tokenSeed||actualQuote==0||actualTokens==0)revert InvalidInput();
        uint256 tokenRwiValue=Math.mulDiv(actualTokens,l.phantomQuote+quote,l.tokenReserve);
        if(Math.mulDiv(actualQuote+tokenRwiValue,q.lower,1 ether)<Economics.MIN_POOL_USD)revert NotReady();
        l.seededQuote=actualQuote;l.seededTokens=actualTokens;
        IV4Permit2(PERMIT2).approve(token,POSITION_MANAGER,0,0);IV4Permit2(PERMIT2).approve(RWI,POSITION_MANAGER,0,0);
        IERC20(token).forceApprove(PERMIT2,0);IERC20(RWI).forceApprove(PERMIT2,0);
        l.positionId=id;l.poolId=PoolId.unwrap(key.toId());l.phase=2;
        emit PoolGraduated(token,l.poolId,id,l.seededQuote,l.seededTokens,SUPPLY-l.initialTokens+l.tokenReserve-l.seededTokens);
    }
    function claimRewards(address token,uint256 minEth,uint256 deadline) external nonReentrant returns(uint256 ethPaid){
        validDeadline(deadline);Launch storage l=launches[token];if(msg.sender!=l.creator||minEth==0)revert Unauthorized();
        uint256 amount=curveRewards[token]+hook.withdrawRewards(token);if(amount==0)revert InvalidInput();curveRewards[token]=0;
        IERC20(RWI).forceApprove(router,amount);
        ethPaid=RWILaunchRouterV4(payable(router)).convertRewards(amount,minEth,l.creator);
        IERC20(RWI).forceApprove(router,0);emit RewardsClaimed(token,l.creator,amount,ethPaid);
    }
    function onERC721Received(address,address,uint256,bytes calldata) external view returns(bytes4){
        if(msg.sender!=POSITION_MANAGER||!minting)revert UnexpectedReceipt();return IERC721Receiver.onERC721Received.selector;
    }
}

/// @notice ETH buys/sells through RWI, before and after graduation; no arbitrary path or recipient.
contract RWILaunchRouterV4 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public factory;
    address public constant RWI=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    address public constant RWI_HOOK=0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    IPoolManager public constant manager=IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    bool private executing;
    error InvalidTrade();error Slippage();error Unauthorized();
    event Trade(address indexed token,address indexed trader,bool buy,uint256 amountIn,uint256 amountOut,uint256 ethRefund);
    constructor(address factory_){factory=factory_;}
    receive() external payable {if(msg.sender!=address(manager))revert Unauthorized();}
    function validate(address token,uint256 amount,uint256 minimum,uint256 deadline) private view returns(uint8 phase){
        uint8 current=RWILaunchV4(factory).phaseOf(token);
        if(amount==0||amount>uint256(uint128(type(int128).max))||minimum==0||block.timestamp>deadline||deadline>block.timestamp+1200||current==1)revert InvalidTrade();
        return current;
    }
    function buy(address token,uint256 rwiWanted,uint256 minimum,uint256 deadline) external payable nonReentrant returns(uint256 out){
        uint8 phase=validate(token,msg.value,minimum,deadline);uint256 refund;
        if(phase==2){if(rwiWanted!=0)revert InvalidTrade();out=run(token,msg.sender,msg.value,2);}
        else{
            (,uint256 rwiNeeded)=RWILaunchV4(factory).quoteBuy(token,rwiWanted);
            uint256 ethSpent=run(token,address(this),rwiNeeded,0);
            IERC20(RWI).forceApprove(factory,rwiNeeded);uint256 used;
            (out,used)=RWILaunchV4(factory).buyCurve(token,rwiNeeded,msg.sender);
            if(used!=rwiNeeded)revert InvalidTrade();
            IERC20(RWI).forceApprove(factory,0);
            refund=msg.value-ethSpent;if(refund!=0)sendEth(msg.sender,refund);
        }
        // Absolute minimum: a smaller fill needs a fresh review rather than silently relaxing protection.
        if(out<minimum)revert Slippage();emit Trade(token,msg.sender,true,msg.value-refund,out,refund);
    }
    function sell(address token,uint256 amount,uint256 minimum,uint256 deadline) external nonReentrant returns(uint256 out){
        uint8 phase=validate(token,amount,minimum,deadline);
        IERC20(token).safeTransferFrom(msg.sender,address(this),amount);
        if(phase==2){out=run(token,msg.sender,amount,3);}
        else{
            IERC20(token).forceApprove(factory,amount);uint256 rwiOut=RWILaunchV4(factory).sellCurve(token,amount,msg.sender);
            IERC20(token).forceApprove(factory,0);out=run(token,msg.sender,rwiOut,1);
        }
        if(out<minimum)revert Slippage();emit Trade(token,msg.sender,false,amount,out,0);
    }
    function convertRewards(uint256 amount,uint256 minimum,address recipient) external nonReentrant returns(uint256 out){
        if(msg.sender!=factory||minimum==0)revert Unauthorized();
        IERC20(RWI).safeTransferFrom(factory,address(this),amount);out=run(address(0),recipient,amount,1);
        if(out<minimum)revert Slippage();
    }
    // Mode 0 buys an exact RWI amount within the caller's ETH ceiling, and returns ETH spent.
    // Other modes return output: 1 RWI->ETH, 2 ETH->RWI->token, 3 token->RWI->ETH.
    function run(address token,address recipient,uint256 amount,uint8 mode) private returns(uint256){
        executing=true;bytes memory result=manager.unlock(abi.encode(token,recipient,amount,mode,msg.value));executing=false;return abi.decode(result,(uint256));
    }
    function unlockCallback(bytes calldata data) external returns(bytes memory){
        if(msg.sender!=address(manager)||!executing)revert Unauthorized();
        (address token,address recipient,uint256 amount,uint8 mode,uint256 ethLimit)=abi.decode(data,(address,address,uint256,uint8,uint256));
        PoolKey memory rwiKey=PoolKey(Currency.wrap(address(0)),Currency.wrap(RWI),0,200,IHooks(RWI_HOOK));
        if(mode==0){
            if(amount==0||amount>uint256(uint128(type(int128).max)))revert InvalidTrade();
            BalanceDelta d=manager.swap(rwiKey,SwapParams(true,int256(amount),TickMath.MIN_SQRT_PRICE+1),bytes(""));
            if(d.amount0()>=0||d.amount1()<=0||uint256(uint128(d.amount1()))!=amount)revert InvalidTrade();
            uint256 spent=uint256(-int256(d.amount0()));if(spent>ethLimit)revert Slippage();
            manager.sync(Currency.wrap(address(0)));manager.settle{value:spent}();manager.take(Currency.wrap(RWI),recipient,amount);
            return abi.encode(spent);
        }
        uint256 out;Currency input;Currency output;
        if(mode==2){
            out=exactIn(rwiKey,true,amount);input=Currency.wrap(address(0));output=Currency.wrap(RWI);
            if(mode==2){out=exactIn(RWILaunchV4(factory).keyFor(token),token>RWI,out);output=Currency.wrap(token);}
        }else{
            uint256 intermediate=amount;input=Currency.wrap(RWI);
            if(mode==3){intermediate=exactIn(RWILaunchV4(factory).keyFor(token),token<RWI,amount);input=Currency.wrap(token);}
            out=exactIn(rwiKey,false,intermediate);output=Currency.wrap(address(0));
        }
        manager.sync(input);
        if(Currency.unwrap(input)==address(0))manager.settle{value:amount}();
        else{IERC20(Currency.unwrap(input)).safeTransfer(address(manager),amount);manager.settle();}
        manager.take(output,recipient,out);return abi.encode(out);
    }
    function exactIn(PoolKey memory key,bool zeroForOne,uint256 amount) private returns(uint256){
        if(amount==0||amount>uint256(uint128(type(int128).max)))revert InvalidTrade();
        BalanceDelta d=manager.swap(key,SwapParams(zeroForOne,-int256(amount),zeroForOne?TickMath.MIN_SQRT_PRICE+1:TickMath.MAX_SQRT_PRICE-1),bytes(""));
        int128 debit=zeroForOne?d.amount0():d.amount1();int128 credit=zeroForOne?d.amount1():d.amount0();
        if(debit>=0||uint256(-int256(debit))!=amount||credit<=0)revert InvalidTrade();return uint256(uint128(credit));
    }
    function sendEth(address to,uint256 amount) private { (bool ok,)=to.call{value:amount}("");if(!ok)revert InvalidTrade(); }
}
