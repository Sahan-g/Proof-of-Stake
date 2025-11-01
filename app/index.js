const express = require("express");
const bodyParser = require("body-parser");
const Block = require("../blockchain/block");
const Blockchain = require("../blockchain/index");
const Wallet = require("../wallet");
const TransactionPool = require("../transaction/transaction-pool");

const P2PServer = require("./p2p-server");

const PORT = process.env.PORT || 3001;
const ENABLE_SENSOR_SIM = process.env.ENABLE_SENSOR_SIM === 'true';

const app = express();

const startServer = async () => {
  app.use(bodyParser.json());

  const wallet = await Wallet.loadOrCreate();
  const blockchain = await Blockchain.create(wallet);
  const tp = new TransactionPool();
  const p2pServer = new P2PServer(blockchain, tp,wallet);

  app.get("/blocks", (req, res) => {
    res.json(blockchain.chain);
  });

  app.get("/transaction", (req, res) => {
    res.json(tp.transactions);
  });

  // app.post("/transact", (req, res) => {
  //   const { recipient, amount } = req.body;
  //   const transaction = wallet.createTransaction(recipient, amount, tp, bc);
  //   p2pServer.broadcastTransaction(transaction);

  //   res.redirect("/transaction");
  // });

  // Create a sensor reading transaction (IoT)
  app.post("/transact", (req, res) => {
    try {
      const { sensor_id, reading, metadata } = req.body;

      // Basic validation
      if (!sensor_id || typeof sensor_id !== "string") {
        return res
          .status(400)
          .json({ ok: false, error: "sensor_id is required (string)" });
      }
      if (!reading || typeof reading !== "object" || Array.isArray(reading)) {
        return res
          .status(400)
          .json({ ok: false, error: "reading must be a non-null object" });
      }
      if (
        metadata != null &&
        (typeof metadata !== "object" || Array.isArray(metadata))
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "metadata must be an object if provided" });
      }

      const tx = wallet.createTransaction(sensor_id, reading, tp, metadata);
      p2pServer.transactionPool.updateOrAddTransaction(tx)
      p2pServer.broadcastTransaction(tx);

      return res.status(201).json({ ok: true, transaction: tx });
    } catch (err) {
      console.error("Failed to create transaction:", err);
      return res
        .status(500)
        .json({ ok: false, error: err.message || "internal error" });
    }
  });

  // Staking endpoint
  app.post("/stake", (req, res) => {
    try {
      const { amount } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ error: "Valid amount required" });
      }
      
      const stakeInfo = p2pServer.stakeManager.addStake(
        wallet.publicKey,
        amount,
        Date.now()
      );
      
      // Broadcast stake update to peers
      p2pServer.broadcastStake({
        publicKey: wallet.publicKey,
        ...stakeInfo
      });
      
      return res.json({ 
        success: true, 
        stake: stakeInfo,
        message: "Stake added successfully and broadcasted to peers" 
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  // Get validator status
  app.get("/validator-status", (req, res) => {
    const stake = p2pServer.stakeManager.getStake(wallet.publicKey);
    const isActive = p2pServer.stakeManager.isActiveValidator(
      wallet.publicKey,
      Date.now()
    );
    res.json({
      publicKey: wallet.publicKey,
      stake: stake || 0,
      isActive: isActive,
      totalStaked: p2pServer.stakeManager.getTotalStake()
    });
  });

  // Get all validators
  app.get("/validators", (req, res) => {
    const activeValidators = p2pServer.stakeManager.getActiveValidators(Date.now());
    res.json(activeValidators);
  });

  // Manual chain sync endpoint for debugging
  app.post("/sync-chain", (req, res) => {
    p2pServer.syncChains();
    res.json({ 
      message: "Chain sync requested",
      currentHeight: blockchain.chain.length,
      peers: p2pServer.sockets.length
    });
  });

  app.listen(PORT, () => {
    console.log(`\nServer is running on port ${PORT}`);
  });

  // Start P2P and wait for network to be ready
  await p2pServer.listen();

  // Start PoS block production only after network is ready
  console.log('🚀 Starting block production...\n');
  p2pServer.startBlockProduction();

  // Sensor data simulation (if enabled)
  function generateAndSendSensorData() {
    const sensor_id = "sensor-" + Math.floor(Math.random() * 1000);
    const reading = {
      value: parseFloat((Math.random() * 100).toFixed(2)),
    };
    const metadata = {
      timestamp: Date.now(),
      unit: "Celsius"
    };

    try {
      const tx = wallet.createTransaction(sensor_id, reading, tp, metadata);
      p2pServer.transactionPool.updateOrAddTransaction(tx);
      p2pServer.broadcastTransaction(tx);
      console.log(
        "✨ Generated and broadcasted sensor data for sensor-id:",
        sensor_id,
        "| Value:",
        reading.value + "°C"
      );
    } catch (error) {
      console.error("❌ Error generating sensor data:", error.message);
    }
  }

  if (ENABLE_SENSOR_SIM) {
    console.log('🌡️  Sensor data simulation ENABLED (every 10 seconds)\n');
    setInterval(generateAndSendSensorData, 10000);
    // Generate first transaction immediately
    setTimeout(generateAndSendSensorData, 5000);
  } else {
    console.log("❌ Sensor data simulation disabled\n");
  }
};

startServer();
