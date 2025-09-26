const ChainUtil = require('../chain-util');
const { 
    MINIMUM_STAKE, 
    STAKE_MATURITY_TIME, 
    STAKE_REWARD_RATE,
    SLASHING_PENALTY 
} = require('../config');

class StakeManager {
    constructor() {
        // Map of validator public keys to their stake info
        this.stakes = new Map();
        // Track total staked amount
        this.totalStaked = 0;
    }

    addStake(validatorPublicKey, amount, timestamp) {
        if (amount < MINIMUM_STAKE) {
            throw new Error(`Stake amount must be at least ${MINIMUM_STAKE}`);
        }

        const stakeInfo = {
            amount,
            timestamp,
            lastRewardClaim: timestamp,
            active: false // Will become active after maturity period
        };

        if (this.stakes.has(validatorPublicKey)) {
            const existingStake = this.stakes.get(validatorPublicKey);
            stakeInfo.amount += existingStake.amount;
            stakeInfo.timestamp = existingStake.timestamp; // Keep original timestamp for maturity
            stakeInfo.active = existingStake.active;
            stakeInfo.lastRewardClaim = existingStake.lastRewardClaim;
        }

        this.stakes.set(validatorPublicKey, stakeInfo);
        this.totalStaked += amount;

        return stakeInfo;
    }

    getStake(validatorPublicKey) {
        return this.stakes.get(validatorPublicKey);
    }

    isActiveValidator(validatorPublicKey, currentTime) {
        const stake = this.stakes.get(validatorPublicKey);
        if (!stake) return false;

        // Check if stake has matured
        if (!stake.active && currentTime - stake.timestamp >= STAKE_MATURITY_TIME) {
            stake.active = true;
            this.stakes.set(validatorPublicKey, stake);
        }

        return stake.active;
    }

    calculateReward(validatorPublicKey, currentTime) {
        const stake = this.stakes.get(validatorPublicKey);
        if (!stake || !stake.active) return 0;

        const timeStaked = currentTime - stake.lastRewardClaim;
        const annualReward = stake.amount * STAKE_REWARD_RATE;
        const reward = (annualReward * timeStaked) / (365 * 24 * 60 * 60 * 1000); // Convert annual rate to actual time period

        return Math.floor(reward);
    }

    claimReward(validatorPublicKey, currentTime) {
        const reward = this.calculateReward(validatorPublicKey, currentTime);
        if (reward > 0) {
            const stake = this.stakes.get(validatorPublicKey);
            stake.lastRewardClaim = currentTime;
            this.stakes.set(validatorPublicKey, stake);
        }
        return reward;
    }

    withdrawStake(validatorPublicKey, amount) {
        const stake = this.stakes.get(validatorPublicKey);
        if (!stake || !stake.active) {
            throw new Error('No active stake found');
        }

        if (amount > stake.amount) {
            throw new Error('Withdrawal amount exceeds staked amount');
        }

        stake.amount -= amount;
        this.totalStaked -= amount;

        if (stake.amount < MINIMUM_STAKE) {
            // If remaining stake is below minimum, deactivate validator
            stake.active = false;
        }

        this.stakes.set(validatorPublicKey, stake);
        return amount;
    }

    applySlashing(validatorPublicKey) {
        const stake = this.stakes.get(validatorPublicKey);
        if (!stake) return 0;

        const slashAmount = Math.floor(stake.amount * SLASHING_PENALTY);
        stake.amount -= slashAmount;
        this.totalStaked -= slashAmount;

        if (stake.amount < MINIMUM_STAKE) {
            stake.active = false;
        }

        this.stakes.set(validatorPublicKey, stake);
        return slashAmount;
    }

    getActiveValidators(currentTime) {
        const activeValidators = [];
        for (const [publicKey, stake] of this.stakes.entries()) {
            if (this.isActiveValidator(publicKey, currentTime)) {
                activeValidators.push({
                    publicKey,
                    stake: stake.amount
                });
            }
        }
        return activeValidators;
    }

    getTotalStake() {
        return this.totalStaked;
    }
}

module.exports = StakeManager;