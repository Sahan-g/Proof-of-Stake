// Proof of Stake Configuration
const MINIMUM_STAKE = 1000; // Minimum amount required to become a validator
const STAKE_MATURITY_TIME = 1 * 60 * 1000; // 1 minute in milliseconds (for testing)
const BLOCK_TIME = 15 * 1000; // 15 seconds in milliseconds
const ROUND_INTERVAL = 60 * 1000; // 1 minute in milliseconds
const MAX_VALIDATORS = 100; // Maximum number of validators allowed
const STAKE_REWARD_RATE = 0.05; // 5% annual reward rate
const SLASHING_PENALTY = 0.1; // 10% of stake as penalty for misbehavior

// Network Configuration
const CHAIN_ID = "pos-chain-1";
const GENESIS_STAKE = 10000; // Initial stake in genesis block

module.exports = {
    MINIMUM_STAKE,
    STAKE_MATURITY_TIME,
    BLOCK_TIME,
    ROUND_INTERVAL,
    MAX_VALIDATORS,
    STAKE_REWARD_RATE,
    SLASHING_PENALTY,
    CHAIN_ID,
    GENESIS_STAKE
};
