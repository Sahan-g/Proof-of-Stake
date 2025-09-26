const { randomBytes } = require('crypto');
const { STAKE_MATURITY_TIME } = require('../config');

class ValidatorSelector {
    constructor(stakeManager) {
        this.stakeManager = stakeManager;
    }

    selectValidator(currentTime, lastBlockTime) {
        const activeValidators = this.stakeManager.getActiveValidators(currentTime);
        if (activeValidators.length === 0) return null;

        // Calculate selection seed using previous block time
        const seed = this._generateSeed(lastBlockTime);
        
        // Calculate weighted probabilities based on stake amounts
        const totalStake = this.stakeManager.getTotalStake();
        let cumulativeProbability = 0;
        const validatorProbabilities = activeValidators.map(validator => {
            const stakeProbability = validator.stake / totalStake;
            cumulativeProbability += stakeProbability;
            return {
                ...validator,
                cumulativeProbability
            };
        });

        // Select validator based on weighted random selection
        const random = seed / BigInt(2 ** 256); // Normalize to [0, 1)
        const selectedValidator = validatorProbabilities.find(
            v => v.cumulativeProbability >= random
        );

        return selectedValidator ? selectedValidator.publicKey : activeValidators[0].publicKey;
    }

    _generateSeed(lastBlockTime) {
        const buffer = randomBytes(32);
        const timeBuffer = Buffer.alloc(8);
        timeBuffer.writeBigInt64BE(BigInt(lastBlockTime));
        
        for (let i = 0; i < 8; i++) {
            buffer[i] ^= timeBuffer[i];
        }
        
        return BigInt('0x' + buffer.toString('hex'));
    }
}

module.exports = ValidatorSelector;