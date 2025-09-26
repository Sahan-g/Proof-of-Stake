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
        const blockString = block.index + block.timestamp + JSON.stringify(block.transactions) + 
                          block.previousHash + block.proposerPublicKey + block.stake + block.lastBlockTime;
        if (block.hash !== ChainUtil.createHash(blockString)) {
            console.log("Invalid block hash");
            return false;
        }

        if (!ChainUtil.verifySignature(block.proposerPublicKey, block.signature, block.hash)) {
            console.log("Invalid block signature");
            return false;
        }

        // Verify proposer's stake
        const validatorStake = stakeManager.getStake(block.proposerPublicKey);
        if (!validatorStake || validatorStake.amount !== block.stake) {
            console.log("Invalid stake amount");
            return false;
        }

        // Verify validator is active
        if (!stakeManager.isActiveValidator(block.proposerPublicKey, block.timestamp)) {
            console.log("Proposer is not an active validator");
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
        const { index, timestamp, transactions, previousHash, proposerPublicKey, hash, signature } = obj;
        return new this({index, timestamp, transactions, previousHash, proposerPublicKey, hash, signature});
    }
}

module.exports = Block;
