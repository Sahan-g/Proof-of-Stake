const ChainUtil = require('../chain-util');

class ValidatorSelector {
    constructor(stakeManager) {
        this.stakeManager = stakeManager;
    }

    /**
     * Deterministic validator selection
     * All nodes compute the same winner based on VRF seed and stakes
     * Uses hash of (seed + publicKey) as randomness, weighted by stake
     */
    selectValidator(currentTime, lastBlockHash, wallet) {
        const activeValidators = this.stakeManager.getActiveValidators(currentTime);
        if (activeValidators.length === 0) {
            console.log('❌ No active validators available');
            return null;
        }

        // Create VRF seed from last block hash and current time slot
        const timeSlot = Math.floor(currentTime / 15000); // 15 second slots
        const vrfSeed = `${lastBlockHash}-${timeSlot}`;
        
        const totalStake = this.stakeManager.getTotalStake();
        const myStake = this.stakeManager.getStake(wallet.publicKey);
        
        if (!myStake || !myStake.active) {
            console.log('⏭️  Node is not an active validator');
            return null;
        }

        // Compute priority for all validators deterministically
        // All nodes can compute this the same way
        let winnerPriority = null;
        let winnerPublicKey = null;
        
        for (const validator of activeValidators) {
            // Deterministic hash based on seed + public key (everyone can compute this)
            const combinedHash = ChainUtil.createHash(vrfSeed + validator.publicKey);
            const hashValue = this.vrfHashToNumber(combinedHash);
            
            // Priority: divide by stake weight (higher stake = lower priority value = more likely to win)
            const stakeWeight = validator.stake / totalStake;
            const priority = Number(hashValue) / stakeWeight;
            
            if (winnerPriority === null || priority < winnerPriority) {
                winnerPriority = priority;
                winnerPublicKey = validator.publicKey;
            }
        }

        const isWinner = winnerPublicKey === wallet.publicKey;

        console.log('🎲 VRF Selection:', {
            slot: timeSlot,
            myStake: myStake.amount,
            totalStake,
            validators: activeValidators.length,
            winner: isWinner ? '✅ ME' : '❌ ' + winnerPublicKey.substring(0, 10) + '...'
        });

        return isWinner ? wallet.publicKey : null;
    }

    /**
     * Compute VRF proof by signing the seed with the wallet's private key
     */
    computeVRFProof(seed, wallet) {
        const seedHash = ChainUtil.createHash(seed);
        const signature = wallet.sign(seedHash);
        return `${wallet.publicKey}-${signature}-${seedHash}`;
    }

    /**
     * Verify VRF proof from another validator
     */
    verifyVRFProof(proof, publicKey, seed) {
        const parts = proof.split('-');
        if (parts.length !== 3) return false;

        const [claimedPublicKey, signature, seedHash] = parts;
        
        if (claimedPublicKey !== publicKey) return false;
        
        const expectedSeedHash = ChainUtil.createHash(seed);
        if (seedHash !== expectedSeedHash) return false;

        return ChainUtil.verifySignature(publicKey, signature, seedHash);
    }

    /**
     * Convert VRF hash to BigInt for comparison
     */
    vrfHashToNumber(hash) {
        return BigInt('0x' + hash);
    }

    /**
     * Check if a validator should have won based on their VRF proof
     */
    validateSelection(validatorPublicKey, vrfProof, seed, timestamp, stakeAmount, totalStake) {
        // Verify the VRF proof is valid
        if (!this.verifyVRFProof(vrfProof, validatorPublicKey, seed)) {
            console.log('Invalid VRF proof');
            return false;
        }

        // Calculate if validator should have won
        const vrfHash = ChainUtil.createHash(vrfProof);
        const vrfValue = this.vrfHashToNumber(vrfHash);
        const stakeRatio = stakeAmount / totalStake;
        const threshold = stakeRatio * (2 ** 256);

        return vrfValue < threshold;
    }
}

module.exports = ValidatorSelector;