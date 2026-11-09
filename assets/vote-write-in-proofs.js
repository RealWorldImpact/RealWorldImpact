/* Recover confirmed write-ins when the address index omits known transactions. */
(function(root){
  const checkpoints = {
    13: {
      nominations: [
        '0xc7f4e0ef51cec3bae8491643cd09816a0e0a8a4a37b497fce70b737c2824f88b',
        '0x5aa57b139a438f555633822c434405c48993affc9b0688b9801f82492ebfa50c',
      ],
      payments: [
        '0x048c114c7bb95a2c78678cbbe288f86e3e0eb32e3ea2e00a9d2ccb75327f039e',
        '0xb54f37834e237ce2950a22069e00009a6327bba05199bfcdd73a9acb087f0286',
      ],
    },
  };
  const lower = value => String(value || '').toLowerCase();
  const burn = '0x000000000000000000000000000000000000dead';

  async function confirmedReceipt(rpc, hash){
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if(lower(receipt?.transactionHash) !== hash || BigInt(receipt.status) !== 1n){
      throw Error('Write-in transaction receipt could not be verified');
    }
    const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
    if(!receipt.blockHash || lower(block?.hash) !== lower(receipt.blockHash)){
      throw Error('Write-in receipt is outside the canonical chain');
    }
    return {receipt, block};
  }

  async function nominations(round, indexed, rpc){
    const known = new Set(indexed.map(row => lower(row.hash || row.transaction_hash)));
    const missing = (checkpoints[round]?.nominations || []).filter(hash => !known.has(hash));
    const recovered = await Promise.all(missing.map(async hash => {
      const [{receipt, block}, tx] = await Promise.all([
        confirmedReceipt(rpc, hash), rpc('eth_getTransactionByHash', [hash]),
      ]);
      const {INBOX} = root.RWIContractVotes;
      if(lower(tx?.hash) !== hash || lower(tx.to) !== INBOX || lower(receipt.to) !== INBOX
        || lower(tx.from) !== lower(receipt.from) || lower(tx.blockHash) !== lower(receipt.blockHash)
        || tx.blockNumber !== receipt.blockNumber || tx.transactionIndex !== receipt.transactionIndex
        || BigInt(tx.value) !== 0n){
        throw Error('Recovered nomination does not match its receipt');
      }
      return {hash, from:tx.from, to:tx.to, raw_input:tx.input, status:'ok',
        block_number:Number(BigInt(receipt.blockNumber)), position:Number(BigInt(receipt.transactionIndex)),
        timestamp:new Date(Number(BigInt(block.timestamp))*1000).toISOString()};
    }));
    return [...indexed, ...recovered];
  }

  async function payments(round, indexed, rpc){
    const known = new Set(indexed.map(row => lower(row.transaction_hash)));
    const missing = (checkpoints[round]?.payments || []).filter(hash => !known.has(hash));
    const {TOKEN, TRANSFER} = root.RWIContractVotes;
    const recovered = await Promise.all(missing.map(async hash => {
      const {receipt} = await confirmedReceipt(rpc, hash);
      return receipt.logs.filter(log => !log.removed && lower(log.address) === TOKEN
        && log.topics?.length === 3 && lower(log.topics[0]) === TRANSFER
        && lower(log.topics[2]) === '0x'+burn.slice(2).padStart(64, '0')
        && /^0x[0-9a-f]{64}$/i.test(log.topics[1]) && /^0x[0-9a-f]{64}$/i.test(log.data))
        .map(log => ({transaction_hash:hash, block_number:Number(BigInt(receipt.blockNumber)),
          transaction_index:Number(BigInt(receipt.transactionIndex)), from:'0x'+lower(log.topics[1]).slice(-40),
          to:burn, token:{address_hash:TOKEN}, total:{value:BigInt(log.data).toString()}}));
    }));
    return [...indexed, ...recovered.flat()];
  }

  root.RWIWriteInProofs = {nominations, payments};
})(globalThis);
