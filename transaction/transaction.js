const ChainUtil = require("../chain-util");

class Transaction {
  constructor(sensor_id, reading, metadata = null) {
    this.id = ChainUtil.id();
    this.timestamp = Date.now();

    this.sensor_id = sensor_id;
    this.reading = reading;
    this.metadata = metadata;

    // Signature envelope set by signTransaction()
    this.hash = null;
    this.input = null;
  }

  _signablePayload() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      sensor_id: this.sensor_id,
      reading: this.reading,
      metadata: this.metadata,
    };
  }

  static fromSensorReading(senderWallet, { sensor_id, reading, metadata }) {
    const tx = new this(sensor_id, reading, metadata);
    console.log(tx)
    return this.signTransaction(tx, senderWallet);
  }

  static signTransaction(transaction, senderWallet) {
    const payload = transaction._signablePayload();
    transaction.input = {
      timestamp: Date.now(),
      address: senderWallet.publicKey,
      signature: senderWallet.sign(ChainUtil.createHash(payload)),
    };
    return transaction;
  }

  static verifyTransaction(transaction) {
    const expectedHash = ChainUtil.createHash({
      id: transaction.id,
      timestamp: transaction.timestamp,
      sensor_id: transaction.sensor_id,
      reading: transaction.reading,
      metadata: transaction.metadata,
    });
    console.log(expectedHash)
    console.log(transaction.hash)
    if (expectedHash !== transaction.hash) return false;

    return ChainUtil.verifySignature(
      transaction.input.address,
      transaction.input.signature,
      transaction.hash
    );
  }

}

module.exports = Transaction;
