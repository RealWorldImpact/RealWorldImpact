// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ILaunchPositionManager {
    function poolManager() external view returns (address);
    function permit2() external view returns (address);
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}
interface ILaunchPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

contract RWILaunchToken is ERC20 {
    string public logo;
    string public description;
    string public website;
    string public twitter;
    string public telegram;
    address public immutable creator;
    constructor(string memory name_, string memory symbol_, string memory logo_, string memory description_, string memory website_, string memory twitter_, string memory telegram_, address creator_)
        ERC20(name_, symbol_)
    {
        logo=logo_; description=description_; website=website_; twitter=twitter_; telegram=telegram_; creator=creator_;
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

/// @notice No launch fee, no creator quote deposit, no principal withdrawal path.
/// @dev A token-only range starts at its boundary. Buyers supply RWI through swaps.
contract RWILaunchFactory is ReentrancyGuard, IERC721Receiver {
    using PoolIdLibrary for PoolKey;
    address public constant RWI=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    address public constant POSITION_MANAGER=0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address public constant POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address public constant PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 public constant SUPPLY=1_000_000_000 ether;
    uint24 public constant POOL_FEE=10_000;
    int24 public constant TICK_SPACING=200;
    int24 public constant RANGE_TICKS=46_000;
    struct Metadata {string name;string symbol;string logo;string description;string website;string twitter;string telegram;}
    struct Launch {address creator;uint256 positionId;bytes32 poolId;int24 startTick;bool token0;uint64 launchedAt;}
    mapping(address=>Launch) public launches;
    address[] public launchedTokens;
    address public router;
    bool private minting;
    event TokenLaunched(address indexed token,address indexed creator,bytes32 indexed poolId,uint256 positionId,int24 startTick);
    event FeesClaimed(address indexed token,address indexed creator);
    error InvalidMetadata();
    error InvalidPrice();
    error WrongNetwork();
    error UnknownLaunch();
    error UnexpectedReceipt();
    error Expired();
    constructor(){
        if(block.chainid!=4663||RWI.code.length==0||ILaunchPositionManager(POSITION_MANAGER).poolManager()!=POOL_MANAGER||ILaunchPositionManager(POSITION_MANAGER).permit2()!=PERMIT2) revert WrongNetwork();
        router=address(new RWILaunchRouter(address(this)));
    }
    /// @param startTick Log price of one new token in RWI, rounded to 200 ticks.
    function launch(Metadata calldata m,int24 startTick,bytes32 salt,uint256 deadline) external nonReentrant returns(address token){
        if(block.timestamp>deadline||deadline>block.timestamp+1200) revert Expired();
        if(bytes(m.name).length==0||bytes(m.name).length>128||bytes(m.symbol).length==0||bytes(m.symbol).length>40||bytes(m.logo).length>2048||bytes(m.description).length>1024||bytes(m.website).length>512||bytes(m.twitter).length>512||bytes(m.telegram).length>512) revert InvalidMetadata();
        if(startTick%TICK_SPACING!=0||startTick< -800_000||startTick>800_000) revert InvalidPrice();
        token=address(new RWILaunchToken{salt:keccak256(abi.encode(msg.sender,salt))}(m.name,m.symbol,m.logo,m.description,m.website,m.twitter,m.telegram,msg.sender));
        bool token0=token<RWI;
        int24 boundary=token0?startTick:-startTick;
        int24 lower=token0?boundary:boundary-RANGE_TICKS;
        int24 upper=token0?boundary+RANGE_TICKS:boundary;
        PoolKey memory key=PoolKey(Currency.wrap(token0?token:RWI),Currency.wrap(token0?RWI:token),POOL_FEE,TICK_SPACING,IHooks(address(0)));
        uint160 sqrtLower=TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper=TickMath.getSqrtPriceAtTick(upper);
        uint128 liquidity=token0?LiquidityAmounts.getLiquidityForAmount0(sqrtLower,sqrtUpper,SUPPLY):LiquidityAmounts.getLiquidityForAmount1(sqrtLower,sqrtUpper,SUPPLY);
        if(liquidity==0) revert InvalidPrice();
        IPoolManager(POOL_MANAGER).initialize(key,token0?sqrtLower:sqrtUpper);
        RWILaunchToken(token).approve(PERMIT2,SUPPLY);
        ILaunchPermit2(PERMIT2).approve(token,POSITION_MANAGER,uint160(SUPPLY),uint48(block.timestamp+600));
        uint256 id=ILaunchPositionManager(POSITION_MANAGER).nextTokenId();
        bytes[] memory params=new bytes[](2);
        params[0]=abi.encode(key,lower,upper,uint256(liquidity),uint128(token0?SUPPLY:0),uint128(token0?0:SUPPLY),address(this),bytes(""));
        params[1]=abi.encode(key.currency0,key.currency1);
        minting=true;
        ILaunchPositionManager(POSITION_MANAGER).modifyLiquidities(abi.encode(hex"020d",params),block.timestamp+600);
        minting=false;
        if(ILaunchPositionManager(POSITION_MANAGER).ownerOf(id)!=address(this)) revert UnexpectedReceipt();
        ILaunchPermit2(PERMIT2).approve(token,POSITION_MANAGER,0,0);
        RWILaunchToken(token).approve(PERMIT2,0);
        bytes32 poolId=PoolId.unwrap(key.toId());
        launches[token]=Launch(msg.sender,id,poolId,startTick,token0,uint64(block.timestamp));
        launchedTokens.push(token);
        emit TokenLaunched(token,msg.sender,poolId,id,startTick);
    }
    function launchCount() external view returns(uint256){return launchedTokens.length;}
    /// @notice Anyone can trigger collection; fees always go to the immutable creator.
    /// @dev Zero liquidity decrease collects fees and cannot remove principal.
    function claimFees(address token) external nonReentrant {
        Launch memory l=launches[token];if(l.creator==address(0)) revert UnknownLaunch();
        bytes[] memory params=new bytes[](2);
        params[0]=abi.encode(l.positionId,uint256(0),uint128(0),uint128(0),bytes(""));
        params[1]=abi.encode(l.token0?token:RWI,l.token0?RWI:token,l.creator);
        ILaunchPositionManager(POSITION_MANAGER).modifyLiquidities(abi.encode(hex"0111",params),block.timestamp+600);
        emit FeesClaimed(token,l.creator);
    }
    function onERC721Received(address,address,uint256,bytes calldata) external view returns(bytes4){
        if(msg.sender!=POSITION_MANAGER||!minting) revert UnexpectedReceipt();
        return IERC721Receiver.onERC721Received.selector;
    }
}

interface ILaunchRegistry {
    function launches(address token) external view returns(address,uint256,bytes32,int24,bool,uint64);
}

/// @notice ETH-facing swaps with a mandatory RWI intermediate currency.
/// @dev No arbitrary pools, recipients, call targets or administrator escape path.
contract RWILaunchRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable factory;
    address public constant RWI=0xDa2598c976E62E7E15DcCa75169B404712E48B04;
    IPoolManager public constant manager=IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address public constant RWI_HOOK=0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    bool private executing;
    error InvalidTrade();
    error Slippage();
    error InvalidCallback();
    event Trade(address indexed token,address indexed trader,bool buy,uint256 amountIn,uint256 amountOut,uint256 rwiRouted);
    constructor(address factory_){factory=factory_;}
    function buy(address token,uint256 minTokensOut,uint256 deadline) external payable nonReentrant returns(uint256 amountOut){
        return run(token,msg.value,minTokensOut,deadline,true);
    }
    function sell(address token,uint256 tokensIn,uint256 minEthOut,uint256 deadline) external nonReentrant returns(uint256 amountOut){
        return run(token,tokensIn,minEthOut,deadline,false);
    }
    function run(address token,uint256 amount,uint256 minimum,uint256 deadline,bool buying) private returns(uint256 amountOut){
        (address creator,,,,,)=ILaunchRegistry(factory).launches(token);
        if(creator==address(0)||amount==0||amount>uint256(uint128(type(int128).max))||minimum==0||block.timestamp>deadline||deadline>block.timestamp+1200) revert InvalidTrade();
        executing=true;
        amountOut=abi.decode(manager.unlock(abi.encode(token,msg.sender,amount,minimum,buying)),(uint256));
        executing=false;
    }
    function unlockCallback(bytes calldata data) external returns(bytes memory){
        if(msg.sender!=address(manager)||!executing) revert InvalidCallback();
        (address token,address trader,uint256 amount,uint256 minimum,bool buying)=abi.decode(data,(address,address,uint256,uint256,bool));
        bool token0=token<RWI;
        PoolKey memory launchKey=PoolKey(Currency.wrap(token0?token:RWI),Currency.wrap(token0?RWI:token),10_000,200,IHooks(address(0)));
        PoolKey memory rwiKey=PoolKey(Currency.wrap(address(0)),Currency.wrap(RWI),0,200,IHooks(RWI_HOOK));
        uint256 out;
        uint256 rwiAmount;
        if(buying){
            BalanceDelta first=swap(rwiKey,true,amount);
            if(first.amount0()>=0||uint256(-int256(first.amount0()))!=amount||first.amount1()<=0) revert InvalidTrade();
            rwiAmount=uint256(uint128(first.amount1()));
            BalanceDelta second=swap(launchKey,!token0,rwiAmount);
            int128 rwiDelta=token0?second.amount1():second.amount0();
            int128 tokenDelta=token0?second.amount0():second.amount1();
            if(rwiDelta>=0||uint256(-int256(rwiDelta))!=rwiAmount||tokenDelta<=0) revert InvalidTrade();
            out=uint256(uint128(tokenDelta));if(out<minimum) revert Slippage();
            manager.sync(Currency.wrap(address(0)));
            manager.settle{value:amount}();
            manager.take(Currency.wrap(token),trader,out);
        }else{
            BalanceDelta first=swap(launchKey,token0,amount);
            int128 tokenDelta=token0?first.amount0():first.amount1();
            int128 rwiDelta=token0?first.amount1():first.amount0();
            if(tokenDelta>=0||uint256(-int256(tokenDelta))!=amount||rwiDelta<=0) revert InvalidTrade();
            rwiAmount=uint256(uint128(rwiDelta));
            BalanceDelta second=swap(rwiKey,false,rwiAmount);
            if(second.amount1()>=0||uint256(-int256(second.amount1()))!=rwiAmount||second.amount0()<=0) revert InvalidTrade();
            out=uint256(uint128(second.amount0()));if(out<minimum) revert Slippage();
            manager.sync(Currency.wrap(token));
            IERC20(token).safeTransferFrom(trader,address(manager),amount);
            manager.settle();
            manager.take(Currency.wrap(address(0)),trader,out);
        }
        emit Trade(token,trader,buying,amount,out,rwiAmount);
        return abi.encode(out);
    }
    function swap(PoolKey memory key,bool zeroForOne,uint256 amount) private returns(BalanceDelta){
        if(amount==0||amount>uint256(uint128(type(int128).max))) revert InvalidTrade();
        return manager.swap(key,SwapParams(zeroForOne,-int256(amount),zeroForOne?TickMath.MIN_SQRT_PRICE+1:TickMath.MAX_SQRT_PRICE-1),bytes(""));
    }
}

