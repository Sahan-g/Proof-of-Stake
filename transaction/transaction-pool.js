const Transaction = require("./transaction");
const Block = require("../blockchain/block");

const {ROUND_INTERVAL} = require("../config");

class TransactionPool {
  constructor() {
    this.transactions = [];
  }

  updateOrAddTransaction(transaction) {
    let transactionWithId = this.transactions.find(
      (t) => t.id === transaction.id
    );
    if (transactionWithId) {
      this.transactions[this.transactions.indexOf(transactionWithId)] =
        transaction;
    } else {
      this.transactions.push(transaction);
    }
  }

  getTransactions() {
    return this.transactions;
  }

  clear() {
    this.transactions = [];
  }

  existingTransaction(address) {
    return this.transactions.find(
      (transaction) => transaction.input.address === address
    );
  }

  validTransactions() {
    return this.transactions.filter((transaction) => {
      // Validate required fields for sensor data
      if (!transaction.sensor_id || !transaction.reading) {
        console.error('Invalid transaction: missing sensor_id or reading');
        return false;
      }

      // Validate reading structure
      if (typeof transaction.reading !== 'object' || !transaction.reading.value) {
        console.error('Invalid transaction: malformed reading data');
        return false;
      }

      // Verify transaction signature
      if (!transaction.input || !Transaction.verifyTransaction(transaction)) {
        console.error(`Invalid signature from ${transaction.input?.address}`);
        return false;
      }

      return true;
    });
  }

removeConfirmedTransactions(confirmedTransactions) {
  console.log(confirmedTransactions);

  if (!Array.isArray(confirmedTransactions)) {
    console.warn("⚠️ confirmedTransactions is not a valid array:", confirmedTransactions);
    return;
  }

  this.transactions = this.transactions.filter(
    (t) => !confirmedTransactions.find((ct) => ct.id === t.id)
  );
}


   getTransactionsForRound(transactionPool,wallet,round) {
    const allTxns = transactionPool.transactions;
    console.log("all tx:", this.transactions)
    const roundStart = Block.genesis(wallet).timestamp + round * ROUND_INTERVAL;
    const roundEndLimit = roundStart + 8 * 60 * 1000; // 8-minute mark

    // Filter and sort
    const filteredTxns = allTxns
      .filter(
        (txn) =>  txn.timestamp < roundEndLimit // lower limit removed because since we consider txns only upto  8 minutes some will be left for the next round
      )
      .sort((a, b) => a.timestamp - b.timestamp);
      console.log("filtered:",filteredTxns)
    return filteredTxns;
  }
}

module.exports = TransactionPool;
