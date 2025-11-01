const Block = require('./block');
const db = require('../database');
const { blockchainWallet } = require('../wallet');
const ChainUtil = require('../chain-util');


class Blockchain {
    constructor() {
        this.chain = []; 
    }

    static async create(wallet) {
        const blockChain = new Blockchain();
        let chainFromDB = await db.getChain();

        if(chainFromDB && chainFromDB.length > 0) {
            console.log("Blockchain loaded from DB.");
            blockChain.chain = chainFromDB.map(blockData => Block.fromObject(blockData));
        } else {
            console.log("No blockchain found in DB. Creating genesis block...");
            const genesisBlock = Block.genesis(wallet);
            blockChain.chain.push(genesisBlock);
            await db.saveChain(blockChain.chain);
        }

        return blockChain;
    }

    getLastBlock() {
        return this.chain[this.chain.length - 1]; 
    }

    async addBlockToChain(block, stakeManager) {
        console.log('Attempting to add block:', block);
        if (Block.verifyBlock(block, stakeManager) && Block.isValidBlock(block, this.getLastBlock())) {
            this.chain.push(block);
            await db.saveChain(this.chain);
            console.log('👍 Block added to chain and saved to DB.');
            return true;
        } else {
            console.log('❌ Invalid block. Not added to chain.');
            return false;
        }
    }

    isChainValid(chain) {
        if(chain.length === 1) {
            return true;
        }
        
        console.log('Validating chain of length:', chain.length);
        
        for (let i = 1; i < chain.length; i++) {
            const currentBlock = Block.fromObject(chain[i]);
            const previousBlock = Block.fromObject(chain[i - 1]);
            
            console.log(`Validating block ${i}:`, {
                index: currentBlock.index,
                proposer: currentBlock.proposerPublicKey,
                prevHash: currentBlock.previousHash,
                actualPrevHash: previousBlock.hash
            });
            
            if (currentBlock.previousHash !== previousBlock.hash) {
                console.log('Invalid previous hash:', {
                    expected: previousBlock.hash,
                    actual: currentBlock.previousHash,
                    blockIndex: i
                });
                return false;
            }

            const blockString = currentBlock.index + currentBlock.timestamp + 
                              JSON.stringify(currentBlock.transactions) + 
                              currentBlock.previousHash + currentBlock.proposerPublicKey + 
                              currentBlock.stake + currentBlock.lastBlockTime;
                              
            const currentBlockHash = ChainUtil.createHash(blockString);
            if (currentBlockHash !== currentBlock.hash) {
                console.log('Invalid block hash:', {
                    computed: currentBlockHash,
                    actual: currentBlock.hash,
                    blockIndex: i
                });
                return false;
            }

            if (currentBlock.timestamp <= previousBlock.timestamp) {
                console.log('Invalid block timestamp:', {
                    current: currentBlock.timestamp,
                    previous: previousBlock.timestamp,
                    blockIndex: i
                });
                return false;
            }
        }
        
        console.log("👍 Chain is valid");
        return true;
    }

    async replaceChain(newChain) {
        if (newChain.length <= this.chain.length) {
            console.log(`⏭️  Received chain (${newChain.length} blocks) is not longer than current chain (${this.chain.length} blocks). Ignoring.`);
            return;
        }

        if (!this.isChainValid(newChain)) {
            console.log('❌ Received chain is invalid. Ignoring.');
            return;
        }

        console.log(`🔄 Replacing current chain (${this.chain.length} blocks) with new chain (${newChain.length} blocks)`);
        this.chain = newChain.map(blockData => Block.fromObject(blockData));
        await db.saveChain(this.chain);
        console.log('✅ Replaced chain and saved it to DB.');
    }
}

module.exports = Blockchain;