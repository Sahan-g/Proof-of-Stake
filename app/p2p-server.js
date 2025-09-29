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
                console.log('Added initial stake:', {
                    publicKey: this.wallet.publicKey,
                    amount: initialStake,
                    timestamp: stakeInfo.timestamp
                });
                this.hasInitialStake = true;
            } catch (error) {
                console.error('Failed to add initial stake:', error.message);
            }
        } else {
            this.hasInitialStake = true;
            console.log('Node already has stake:', {
                publicKey: this.wallet.publicKey,
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
        console.log(`P2P Server listening on port ${P2P_PORT}`);
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
        console.log(`👨 New peer connected: ${socket.url}`);
        this.messageHandler(socket);
        this.sendChain(socket)

        socket.on('close', () => {
            console.log(`❌ Connection to a peer closed`);
            this.sockets = this.sockets.filter(s => s !== socket);
        });
    }

    messageHandler(socket) {
        socket.on('message', message => {
            const data = JSON.parse(message);
            switch (data.type) {
                case MESSAGE_TYPES.chain:
                    this.blockchain.replaceChain(data.chain);
                    break;
                case MESSAGE_TYPES.transaction:
                    this.transactionPool.updateOrAddTransaction(data.transaction);
                    break;
                case MESSAGE_TYPES.block:
                    console.log(`📥 Block received with index ${JSON.stringify(data.block.index)} at p2p-server}`);
                    const isAdded = this.blockchain.addBlockToChain(data.block, this.stakeManager);
                    if (isAdded) {
                        this.transactionPool.removeConfirmedTransactions(data.block.transactions);
                    }
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
        console.log("➡️ Sent chain to peer");
    }

    sendTransaction(socket, transaction) {
        socket.send(JSON.stringify({ type: MESSAGE_TYPES.transaction, transaction }));
    }

    syncChains() {
        this.sockets.forEach(socket => {
            this.sendChain(socket);
        });
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
        this.sockets.forEach(socket => {
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
            publicKey: this.wallet.publicKey,
            stake: stake ? stake.amount : 0,
            isActive: isActive,
            totalStaked: this.stakeManager.getTotalStake()
        });
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
        const selectedValidator = this.validatorSelector.selectValidator(
            currentTime,
            this.lastBlockTime
        );
        if (selectedValidator === this.wallet.publicKey) {
            const lastBlock = this.blockchain.getLastBlock();
            const transactions = this.transactionPool.validTransactions();
            const validatorStake = this.stakeManager.getStake(this.wallet.publicKey);

            if (!validatorStake) {
                console.log("Not a valid validator");
                return;
            }

            const block = new Block({
                index: lastBlock.index + 1,
                timestamp: currentTime,
                transactions,
                previousHash: lastBlock.hash,
                proposerPublicKey: this.wallet.publicKey,
                stake: validatorStake.amount,
                lastBlockTime: this.lastBlockTime,
                wallet: this.wallet
            });

            if (await this.blockchain.addBlockToChain(block, this.stakeManager)) {
                console.log('Successfully added new block to chain');
                this.broadcastBlock(block);
                this.transactionPool.removeConfirmedTransactions(transactions);
                this.lastBlockTime = currentTime;
                
                // Calculate and add rewards
                const reward = this.stakeManager.claimReward(this.wallet.publicKey, currentTime);
                if (reward > 0) {
                    console.log(`Claimed validator reward: ${reward}`);
                }
            }
        }
    }

}

module.exports = P2PServer;