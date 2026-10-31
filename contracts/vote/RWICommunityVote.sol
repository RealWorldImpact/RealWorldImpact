// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Records advisory charity votes. It never calls a token or moves funds.
/// @dev The public tally validates the current round/charity and weights each
///      caller's latest vote by their live RWI balance. There is no proxy/admin.
contract RWICommunityVote {
    error WrongChain();
    error InvalidRound();
    error InvalidCharity();

    event VoteCast(address indexed voter, uint64 indexed round, string charity);

    constructor() {
        if (block.chainid != 4663) revert WrongChain();
    }

    function vote(uint64 round, string calldata charity) external {
        if (round == 0) revert InvalidRound();
        bytes calldata slug = bytes(charity);
        if (slug.length == 0 || slug.length > 96) revert InvalidCharity();
        for (uint256 i; i < slug.length; ++i) {
            uint8 c = uint8(slug[i]);
            bool alphanumeric = (c >= 48 && c <= 57) || (c >= 97 && c <= 122);
            if (!alphanumeric && !(i > 0 && c == 45)) revert InvalidCharity();
        }
        emit VoteCast(msg.sender, round, charity);
    }
}
