const ChainUtil = require('../chain-util');

class Block {
    constructor({index, timestamp, transactions, previousHash, proposerPublicKey, hash, signature, stake, lastBlockTime, wallet}) {
        this.index = index; 
        this.timestamp = timestamp ? timestamp : Date.now();
        this.transactions = transactions; 
        this.previousHash = previousHash; 
        this.proposerPublicKey = proposerPublicKey;
        this.stake = stake || 0; // Validator's stake amount
        this.lastBlockTime = lastBlockTime || this.timestamp; // For block time validation
        this.hash = hash ? hash : this.computeHash();
        this.signature = signature ? signature : wallet.sign(this.hash);
    }

    computeHash() {
        const blockString = this.index + this.timestamp + JSON.stringify(this.transactions) + 
                          this.previousHash + this.proposerPublicKey + this.stake + this.lastBlockTime;
        return ChainUtil.createHash(blockString);
    } 

    static genesis(wallet) {
        return new Block({
            index: 0,
            transactions: [],
            previousHash: '0',
            proposerPublicKey: 'GENESIS',
            stake: 0,
            wallet: wallet
        });
    }

    static verifyBlock(block, stakeManager) {
        console.log('Verifying block:', {
            index: block.index,
            proposer: block.proposerPublicKey,
            stake: block.stake,
            timestamp: block.timestamp
        });

        const blockString = block.index + block.timestamp + JSON.stringify(block.transactions) + 
                          block.previousHash + block.proposerPublicKey + block.stake + block.lastBlockTime;
        const computedHash = ChainUtil.createHash(blockString);
        if (block.hash !== computedHash) {
            console.log("Invalid block hash:", {
                computed: computedHash,
                actual: block.hash,
                blockString
            });
            return false;
        }

        if (!ChainUtil.verifySignature(block.proposerPublicKey, block.signature, block.hash)) {
            console.log("Invalid block signature:", {
                proposerKey: block.proposerPublicKey,
                signature: block.signature,
                hash: block.hash
            });
            return false;
        }

        // Verify proposer's stake
        const validatorStake = stakeManager.getStake(block.proposerPublicKey);
        if (!validatorStake || validatorStake.amount !== block.stake) {
            console.log("Invalid stake amount:", {
                expected: validatorStake ? validatorStake.amount : 'No stake',
                actual: block.stake,
                proposer: block.proposerPublicKey
            });
            return false;
        }

        // Verify validator is active
        if (!stakeManager.isActiveValidator(block.proposerPublicKey, block.timestamp)) {
            console.log("Proposer is not an active validator:", {
                proposer: block.proposerPublicKey,
                stake: validatorStake,
                timestamp: block.timestamp
            });
            return false;
        }

        console.log("Block verified successfully");
        return true;
    }

    static isValidBlock(block, previousBlock) {
        if (block.index !== previousBlock.index + 1) {
            console.log(`Invalid block index: ${block.index} expected: ${previousBlock.index + 1}`);
            return false;
        }
        if (block.previousHash !== previousBlock.hash) {
            console.log(`Invalid previous hash: ${block} expected: ${previousBlock}`);
            return false;
        }
        if (block.timestamp <= previousBlock.timestamp) {
            console.log("Invalid timestamp");
            return false;
        }

        // Verify block time constraints
        const blockTimeDiff = block.timestamp - block.lastBlockTime;
        const { BLOCK_TIME } = require('../config');
        if (blockTimeDiff < BLOCK_TIME) {
            console.log("Block time too short");
            return false;
        }

        console.log("Block is valid");
        return true;
    }

    static fromObject(obj) {
        const { 
            index, 
            timestamp, 
            transactions, 
            previousHash, 
            proposerPublicKey, 
            hash, 
            signature,
            stake,
            lastBlockTime 
        } = obj;
        return new this({
            index, 
            timestamp, 
            transactions, 
            previousHash, 
            proposerPublicKey, 
            hash, 
            signature,
            stake,
            lastBlockTime
        });
    }
}

module.exports = Block;
