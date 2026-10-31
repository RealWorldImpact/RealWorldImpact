# Pons V2 current-chain review

`pons-current.json` records the public Robinhood Chain factory configuration and source hashes read on 2026-10-31 at block 102673253. Sources were obtained from the public [Sourcify record](https://sourcify.dev/server/v2/contract/4663/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e?fields=abi,metadata,sources), alongside [Pons' documentation](https://docs.ponsfamily.com/v2).

The reviewed contracts are `PonsV2LaunchFactory`, `PonsV2BondingCurve`, `PonsV2GraduationExecutor` and `PonsV2GraduationGuard`. Their prior local copies differed only in trailing whitespace. The default 1.68 ETH virtual reserve / 4.2 ETH collected-reserve ratio sets a fixed sellable allocation; graduation occurs when that allocation is exhausted, not at a live USD valuation.

RWI is not an approved pair asset in that snapshot, and the factory charges 0.0005 ETH per launch. RWI's selected implementation therefore emulates the mechanism in a separate factory. See [V5 design](../launch-v5/README.md) for its calibrated distribution, ETH routing, zero launch fee, fixed creator rewards, failure recovery, tests and explicit USD limitations. The abandoned market-reference investigation in `../launch-market-reference` is not part of V5.
