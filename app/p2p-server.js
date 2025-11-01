const webSocket = require('ws');
const axios = require('axios');
const StakeManager = require('../stake');
const ValidatorSelector = require('../stake/validator-selector');
const Block = require('../blockchain/block');
const { BLOCK_TIME } = require('../config');

const P2P_PORT = process.env.P2P_PORT || 5001;
const BOOTSTRAP_ADDRESS = process.env.BOOTSTRAP_ADDRESS || 'http://127.0.0.1:4000';
const P2P_HOST = process.env.P2P_HOST || 'localhost';
const selfAddress = `ws://${P2P_HOST}:${P2P_PORT}`;

// const peers = process.env.PEERS ? process.env.PEERS.split(',') : [];
let peers = [];

const MESSAGE_TYPES = {
    chain: 'CHAIN',
    transaction: 'TRANSACTION',
    clear_transactions: 'CLEAR_TRANSACTIONS',
    block: 'BLOCK',
    stake: 'STAKE',
    stake_sync: 'STAKE_SYNC',
    request_chain: 'REQUEST_CHAIN'
};

class P2PServer {
    constructor(blockchain, transactionPool, wallet) {
        this.blockchain = blockchain;
        this.transactionPool = transactionPool;
        this.sockets = [];
        this.wallet = wallet;
        this.stakeManager = new StakeManager();
        this.validatorSelector = new ValidatorSelector(this.stakeManager);
        this.lastBlockTime = Date.now();
        this.nextBlockTime = null; // Will be set during sync
        this.hasInitialStake = false; // Track if initial stake is set
    }

    async initializeStake() {
        if (this.hasInitialStake) return;

        const currentStake = this.stakeManager.getStake(this.wallet.publicKey);
        if (!currentStake) {
            try {
                // Add initial stake of 1000 units
                const initialStake = 1000;
                const stakeInfo = this.stakeManager.addStake(
                    this.wallet.publicKey,
                    initialStake,
                    Date.now()
                );
                console.log('💎 Added initial stake:', {
                    publicKey: this.wallet.publicKey.substring(0, 10) + '...',
                    amount: initialStake,
                    timestamp: stakeInfo.timestamp
                });
                
                // Broadcast stake to peers
                this.broadcastStake({
                    publicKey: this.wallet.publicKey,
                    ...stakeInfo
                });
                
                this.hasInitialStake = true;
            } catch (error) {
                console.error('Failed to add initial stake:', error.message);
            }
        } else {
            this.hasInitialStake = true;
            console.log('💎 Node already has stake:', {
                publicKey: this.wallet.publicKey.substring(0, 10) + '...',
                amount: currentStake.amount
            });
        }
    }

    async listen() {
        const server = new webSocket.Server({ port: P2P_PORT });
        server.on('connection', (socket) => { 
            this.connectSocket(socket);
        });

        await this.registerToBootstrap();
        console.log(`🌐 P2P Server listening on port ${P2P_PORT}`);
        
        // Wait for all connections and syncs to complete
        await this.waitForNetworkReady();
    }

    async waitForNetworkReady() {
        console.log('\n⏳ Waiting for network to be ready...');
        
        // Wait for initial connections
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Initialize stake (this will be broadcast to peers)
        await this.initializeStake();
        
        // Wait a bit more for stake sync
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Request chains from all peers
        console.log('🔄 Requesting chain sync from all peers...');
        this.syncChains();
        
        // Wait for chain sync to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const currentChainLength = this.blockchain.chain.length;
        const connectedPeers = this.sockets.length;
        const activeValidators = this.stakeManager.getActiveValidators(Date.now());
        
        console.log(`\n📊 Network Status:`);
        console.log(`   - Current chain length: ${currentChainLength}`);
        console.log(`   - Connected peers: ${connectedPeers}`);
        console.log(`   - Active validators: ${activeValidators.length}`);
        console.log(`   - Total stake: ${this.stakeManager.getTotalStake()}`);
        console.log(`   - My stake: ${this.stakeManager.getStake(this.wallet.publicKey)?.amount || 0}`);
        
        // Log all validators
        if (activeValidators.length > 0) {
            console.log(`\n📋 All Validators:`);
            activeValidators.forEach((v, i) => {
                console.log(`   ${i + 1}. ${v.publicKey.substring(0, 20)}... (stake: ${v.stake})`);
            });
        }
        
        console.log('\n✅ Network ready!\n');
    }

    connectToPeers() {
        peers.forEach(peer => this.connectToPeer(peer));
    }

    connectToPeersFetchedFromBootstrap() {
        peers.forEach(peer => {
            if (peer !== selfAddress) {
                this.connectToPeer(peer)
            }
        });
    }

    async registerToBootstrap() {
        try{
            await axios.post(`${BOOTSTRAP_ADDRESS}/register`, { address: selfAddress });
            console.log(`Registered peer with bootstrap at ${BOOTSTRAP_ADDRESS} as ${selfAddress}`);
        } catch (error) {
            console.error(`Error registering peer: ${error.message}`);
        }

        try{
            const res = await axios.get(`${BOOTSTRAP_ADDRESS}/peers`);
            peers = res.data;
            if(peers){

                this.connectToPeersFetchedFromBootstrap();
                console.log(`Connected to peers: ${peers}`);
            }
            console.log("skiping no peers")
        } catch (error) {
            console.error(`Error obtaining peers: ${error.message}`);
        }
    }


    connectToPeer(peer) {
        const socket = new webSocket(peer);

        socket.on('open', () => {
            this.connectSocket(socket);
        });

        socket.on('error', () => {
            console.log(`Couldn't connect to peer ${peer}`);
            peers = peers.filter(p => p !== peer);
            return;
        });
    }


    connectSocket(socket) {
        this.sockets.push(socket);
        console.log(`👨 New peer connected: ${socket.url || 'incoming'}`);
        this.messageHandler(socket);
        
        // Send our chain to the new peer
        this.sendChain(socket);
        
        // Send stake info to new peer
        this.sendStakeInfo(socket);
        
        // Request their chain (in case they have a longer one)
        this.requestChain(socket);

        socket.on('close', () => {
            console.log(`❌ Connection to a peer closed`);
            this.sockets = this.sockets.filter(s => s !== socket);
        });
    }

    messageHandler(socket) {
        socket.on('message', async message => {
            const data = JSON.parse(message);
            switch (data.type) {
                case MESSAGE_TYPES.chain:
                    console.log(`📥 Received chain with ${data.chain.length} blocks`);
                    await this.blockchain.replaceChain(data.chain);
                    break;
                    
                case MESSAGE_TYPES.request_chain:
                    console.log(`📤 Chain requested by peer, sending ${this.blockchain.chain.length} blocks`);
                    this.sendChain(socket);
                    break;
                    
                case MESSAGE_TYPES.transaction:
                    this.transactionPool.updateOrAddTransaction(data.transaction);
                    break;
                    
                case MESSAGE_TYPES.block:
                    console.log(`📥 Block received with index ${data.block.index} from peer`);
                    
                    const lastBlock = this.blockchain.getLastBlock();
                    
                    // Check if we already have this block
                    if (data.block.index <= lastBlock.index) {
                        console.log(`⏭️  Already have block ${data.block.index}, skipping`);
                        break;
                    }
                    
                    // Check if this is the next block we expect
                    if (data.block.index !== lastBlock.index + 1) {
                        console.log(`⚠️  Gap detected! Expected block ${lastBlock.index + 1}, received ${data.block.index}`);
                        console.log(`📥 Requesting full chain to resolve gap...`);
                        this.requestChain(socket);
                        break;
                    }
                    
                    // Check if previous hash matches (fork detection)
                    if (data.block.previousHash !== lastBlock.hash) {
                        console.log(`🔱 Fork detected! Previous hash mismatch.`);
                        console.log(`   Expected: ${lastBlock.hash.substring(0, 20)}...`);
                        console.log(`   Received: ${data.block.previousHash.substring(0, 20)}...`);
                        console.log(`📥 Requesting full chain to resolve fork...`);
                        this.requestChain(socket);
                        break;
                    }
                    
                    const isAdded = await this.blockchain.addBlockToChain(data.block, this.stakeManager);
                    if (isAdded) {
                        console.log(`✅ Block ${data.block.index} added to chain`);
                        this.transactionPool.removeConfirmedTransactions(data.block.transactions);
                        this.lastBlockTime = data.block.timestamp;
                        
                        // Re-broadcast to other peers (gossip protocol)
                        this.rebroadcastBlock(data.block, socket);
                    } else {
                        console.log(`❌ Block ${data.block.index} rejected - requesting full chain`);
                        this.requestChain(socket);
                    }
                    break;
                    
                case MESSAGE_TYPES.stake:
                    // Receive stake information from another node
                    this.receiveStakeInfo(data.stakeInfo);
                    break;
                    
                case MESSAGE_TYPES.stake_sync:
                    // Full stake sync from peer
                    this.syncStakes(data.stakes);
                    break;
                    
                default:
                    console.error(`Unknown message type: ${data.type}`);
            }
        });
    }

    sendChain(socket) {
        socket.send(JSON.stringify(
            {
                type: MESSAGE_TYPES.chain,
                chain: this.blockchain.chain
            }));
        console.log(`➡️  Sent chain with ${this.blockchain.chain.length} blocks to peer`);
    }

    requestChain(socket) {
        socket.send(JSON.stringify({
            type: MESSAGE_TYPES.request_chain
        }));
        console.log("📥 Requested chain from peer");
    }

    sendStakeInfo(socket) {
        // Send all stake information to a peer
        const stakes = Array.from(this.stakeManager.stakes.entries()).map(([publicKey, stakeInfo]) => ({
            publicKey,
            ...stakeInfo
        }));
        
        socket.send(JSON.stringify({
            type: MESSAGE_TYPES.stake_sync,
            stakes
        }));
        console.log("➡️ Sent stake info to peer");
    }

    receiveStakeInfo(stakeInfo) {
        // Receive and update stake information from another node
        try {
            const existing = this.stakeManager.getStake(stakeInfo.publicKey);
            
            // Only update if this is new or more recent
            if (!existing || stakeInfo.timestamp >= existing.timestamp) {
                this.stakeManager.stakes.set(stakeInfo.publicKey, {
                    amount: stakeInfo.amount,
                    timestamp: stakeInfo.timestamp,
                    lastRewardClaim: stakeInfo.lastRewardClaim,
                    active: stakeInfo.active
                });
                
                console.log('📥 Received stake update:', {
                    validator: stakeInfo.publicKey.substring(0, 10) + '...',
                    amount: stakeInfo.amount
                });
            }
        } catch (error) {
            console.error('Error receiving stake info:', error.message);
        }
    }

    syncStakes(stakes) {
        // Sync all stakes from a peer
        try {
            let updated = 0;
            stakes.forEach(stake => {
                const existing = this.stakeManager.getStake(stake.publicKey);
                if (!existing || stake.timestamp >= existing.timestamp) {
                    this.stakeManager.stakes.set(stake.publicKey, {
                        amount: stake.amount,
                        timestamp: stake.timestamp,
                        lastRewardClaim: stake.lastRewardClaim,
                        active: stake.active
                    });
                    updated++;
                }
            });
            
            // Recalculate total staked
            this.stakeManager.totalStaked = 0;
            for (const [, stakeInfo] of this.stakeManager.stakes.entries()) {
                this.stakeManager.totalStaked += stakeInfo.amount;
            }
            
            console.log(`📥 Synced stakes from peer: ${updated} updated, total validators: ${stakes.length}, total stake: ${this.stakeManager.totalStaked}`);
        } catch (error) {
            console.error('Error syncing stakes:', error.message);
        }
    }

    broadcastStake(stakeInfo) {
        // Broadcast stake update to all peers
        this.sockets.forEach(socket => {
            socket.send(JSON.stringify({
                type: MESSAGE_TYPES.stake,
                stakeInfo
            }));
        });
    }

    sendTransaction(socket, transaction) {
        socket.send(JSON.stringify({ type: MESSAGE_TYPES.transaction, transaction }));
    }

    syncChains() {
        console.log(`🔄 Requesting chains from ${this.sockets.length} peers`);
        this.sockets.forEach(socket => {
            this.requestChain(socket);
        });
    }

    async requestChainSync() {
        // Request chain from peers if we're behind
        if (this.sockets.length === 0) {
            console.log('⚠️  No peers to sync with');
            return;
        }

        try {
            // Just request chain from first available peer
            const socket = this.sockets[0];
            socket.send(JSON.stringify({
                type: 'REQUEST_CHAIN'
            }));
            console.log('📥 Requested chain sync from peer');
        } catch (error) {
            console.error('Failed to request chain sync:', error.message);
        }
    }

    broadcastTransaction(transaction) {
        this.sockets.forEach(socket => this.sendTransaction(socket, transaction));
    }

    broadcastClearTransactions() {
        this.sockets.forEach(socket => {
            socket.send(JSON.stringify({ type: MESSAGE_TYPES.clear_transactions }));
        });
    }

    broadcastBlock(block) {
        console.log(`📢 Broadcasting block ${block.index} to ${this.sockets.length} peers`);
        this.sockets.forEach(socket => {
            socket.send(JSON.stringify({
                type: MESSAGE_TYPES.block,
                block
            }));
        });
    }

    rebroadcastBlock(block, sourceSocket) {
        // Re-broadcast to all peers except the one we received from (gossip protocol)
        const targetSockets = this.sockets.filter(s => s !== sourceSocket);
        console.log(`🔄 Re-broadcasting block ${block.index} to ${targetSockets.length} other peers`);
        
        targetSockets.forEach(socket => {
            socket.send(JSON.stringify({
                type: MESSAGE_TYPES.block,
                block
            }));
        });
    }

    async startBlockProduction() {
        // Initialize stake before starting block production
        await this.initializeStake();
        
        // Initial sync with bootstrap server
        await this.syncBlockTime();
        
        // Start the block production loop
        this.scheduleNextBlock();

        // Log validator status
        const stake = this.stakeManager.getStake(this.wallet.publicKey);
        const isActive = this.stakeManager.isActiveValidator(this.wallet.publicKey, Date.now());
        console.log('Validator status:', {
            publicKey: this.wallet.publicKey.substring(0, 20) + '...',
            stake: stake ? stake.amount : 0,
            isActive: isActive,
            totalStaked: this.stakeManager.getTotalStake()
        });
        
        // Periodic stake sync every 30 seconds to ensure consistency
        setInterval(() => {
            if (this.sockets.length > 0) {
                console.log('🔄 Periodic stake sync...');
                this.sockets.forEach(socket => {
                    this.sendStakeInfo(socket);
                });
            }
        }, 30000);
    }

    async syncBlockTime() {
        try {
            const response = await axios.get(`${BOOTSTRAP_ADDRESS}/block-time`);
            const { nextBlockTime, currentTime } = response.data;
            
            // Adjust for network latency
            const timeNow = Date.now();
            const networkLatency = (timeNow - currentTime) / 2;
            this.nextBlockTime = nextBlockTime + networkLatency;
            
            console.log('Synchronized block time:', {
                nextBlock: new Date(this.nextBlockTime).toISOString(),
                networkLatency: `${networkLatency}ms`
            });
        } catch (error) {
            console.error('Failed to sync block time:', error.message);
        }
    }

    scheduleNextBlock() {
        const now = Date.now();
        
        // If we missed the next block time, sync with bootstrap
        if (now > this.nextBlockTime) {
            this.syncBlockTime().then(() => this.scheduleNextBlock());
            return;
        }

        const timeUntilNextBlock = this.nextBlockTime - now;
        console.log(`Scheduling next block in ${timeUntilNextBlock}ms`);

        setTimeout(async () => {
           
            await this.tryProduceBlock();
            
            // After producing (or trying to produce) a block, sync time and schedule next
            await this.syncBlockTime();
            this.scheduleNextBlock();
        }, timeUntilNextBlock);
    }

    async tryProduceBlock() {
        const currentTime = Date.now();
        const lastBlock = this.blockchain.getLastBlock();
        
        console.log(`🔍 Checking validator selection for block ${lastBlock.index + 1}`);
        
        // Use VRF to determine if this node should produce a block
        const selectedValidator = this.validatorSelector.selectValidator(
            currentTime,
            lastBlock.hash,
            this.wallet
        );
        
        if (selectedValidator === this.wallet.publicKey) {
            console.log(`🎯 This node selected to produce block ${lastBlock.index + 1}!`);
            
            const transactions = this.transactionPool.validTransactions();
            const validatorStake = this.stakeManager.getStake(this.wallet.publicKey);

            if (!validatorStake) {
                console.log("❌ Not a valid validator - no stake found");
                return;
            }

            if (!validatorStake.active) {
                console.log("❌ Validator stake not yet active (maturity period)");
                return;
            }

            // Compute VRF proof for this block
            const timeSlot = Math.floor(currentTime / 15000);
            const vrfSeed = `${lastBlock.hash}-${timeSlot}`;
            const vrfProof = this.validatorSelector.computeVRFProof(vrfSeed, this.wallet);

            const block = new Block({
                index: lastBlock.index + 1,
                timestamp: currentTime,
                transactions,
                previousHash: lastBlock.hash,
                proposerPublicKey: this.wallet.publicKey,
                stake: validatorStake.amount,
                lastBlockTime: lastBlock.timestamp,
                vrfProof: vrfProof, // Include VRF proof in block
                wallet: this.wallet
            });

            console.log('📦 Creating block:', {
                index: block.index,
                transactions: transactions.length,
                stake: validatorStake.amount,
                previousHash: lastBlock.hash.substring(0, 10) + '...',
                hash: block.hash.substring(0, 10) + '...'
            });

            if (await this.blockchain.addBlockToChain(block, this.stakeManager)) {
                console.log(`✅ Successfully added block ${block.index} to chain`);
                this.broadcastBlock(block);
                this.transactionPool.removeConfirmedTransactions(transactions);
                
                // Update lastBlockTime from blockchain
                this.lastBlockTime = this.blockchain.getLastBlock().timestamp;
                
                // Calculate and add rewards
                const reward = this.stakeManager.claimReward(this.wallet.publicKey, currentTime);
                if (reward > 0) {
                    console.log(`💰 Claimed validator reward: ${reward}`);
                }
            } else {
                console.log(`❌ Failed to add block ${block.index} to chain`);
            }
        } else {
            console.log(`⏭️  Not selected for block ${lastBlock.index + 1} (current height: ${lastBlock.index})`);
        }
    }

}

module.exports = P2PServer;