//#region Imports
import {
  Tag,
  BlockLogs,
  VM_EXCEPTION,
  VM_EXCEPTIONS,
  CodedError,
  DATA,
  WhisperPostObject,
  BaseFilterArgs,
  Filter,
  FilterArgs,
  FilterTypes,
  QUANTITY,
  RangeFilterArgs,
  StorageRangeResult,
  SubscriptionId,
  SubscriptionName,
  TraceTransactionResult,
  TransactionTraceOptions
} from "@ganache/ethereum-utils";
import { Block, RuntimeBlock } from "@ganache/ethereum-block";
import {
  RuntimeTransaction,
  TypedRpcTransaction,
  TransactionFactory,
  TypedTransaction
} from "@ganache/ethereum-transaction";
import { toRpcSig, ecsign, hashPersonalMessage } from "ethereumjs-util";
import { TypedData as NotTypedData, signTypedData_v4 } from "eth-sig-util";
import { EthereumInternalOptions } from "@ganache/ethereum-options";
import { types, Data, Quantity, PromiEvent, utils } from "@ganache/utils";
import Blockchain from "./blockchain";
import Wallet from "./wallet";
import { $INLINE_JSON } from "ts-transformer-inline-file";

import Emittery from "emittery";
import estimateGas from "./helpers/gas-estimator";
import { assertArgLength } from "./helpers/assert-arg-length";
import { parseFilterDetails, parseFilterRange } from "./helpers/filter-parsing";
import { decode } from "@ganache/rlp";
import { Address } from "@ganache/ethereum-address";
import { GanacheRawBlock } from "@ganache/ethereum-block/src/serialize";

// Read in the current ganache version from core's package.json
const { version } = { version: "7.0.0-internal.21" }; //$INLINE_JSON("../../../../packages/ganache/package.json"); TODO
const { keccak } = utils;
//#endregion

//#region Constants
const { RPCQUANTITY_ZERO } = utils;
const CLIENT_VERSION = `Ganache/v${version}/EthereumJS TestRPC/v${version}/ethereum-js`;
const PROTOCOL_VERSION = Data.from("0x3f");
const RPC_MODULES = {
  eth: "1.0",
  net: "1.0",
  rpc: "1.0",
  web3: "1.0",
  evm: "1.0",
  personal: "1.0"
} as const;
//#endregion

//#region misc types
type TypedData = Exclude<
  Parameters<typeof signTypedData_v4>[1]["data"],
  NotTypedData
>;
//#endregion

//#region helpers
function assertExceptionalTransactions(transactions: TypedTransaction[]) {
  let baseError: string = null;
  let errors: string[];
  const data = {};

  transactions.forEach(transaction => {
    if (transaction.execException) {
      if (baseError) {
        baseError = VM_EXCEPTIONS;
        errors.push(
          `${transaction.hash.toString()}: ${transaction.execException}\n`
        );
        data[transaction.execException.data.hash] =
          transaction.execException.data;
      } else {
        baseError = VM_EXCEPTION;
        errors = [transaction.execException.message];
        data[transaction.execException.data.hash] =
          transaction.execException.data;
      }
    }
  });

  if (baseError) {
    const err = new Error(baseError + errors.join("\n"));
    (err as any).data = data;
    throw err;
  }
}

//#endregion helpers

export default class EthereumApi implements types.Api {
  readonly [index: string]: (...args: any) => Promise<any>;

  readonly #getId = (id => () => Quantity.from(++id))(0);
  readonly #filters = new Map<string, Filter>();
  readonly #subscriptions = new Map<string, Emittery.UnsubscribeFn>();
  readonly #options: EthereumInternalOptions;
  readonly #blockchain: Blockchain;
  readonly #wallet: Wallet;

  /**
   * This is the Ethereum API that the provider interacts with.
   * The only methods permitted on the prototype are the supported json-rpc
   * methods.
   * @param options
   * @param wallet
   * @param emitter
   */
  constructor(
    options: EthereumInternalOptions,
    wallet: Wallet,
    blockchain: Blockchain
  ) {
    this.#options = options;
    this.#wallet = wallet;
    this.#blockchain = blockchain;
  }

  //#region db
  /**
   * Stores a string in the local database.
   *
   * @param {String} dbName - Database name.
   * @param {String} key - Key name.
   * @param {String} value - String to store.
   * @returns Returns true if the value was stored, otherwise false.
   * @example
   * ```javascript
   * console.log(await provider.send("db_putString", ["testDb", "testKey", "testValue"]));
   * ```
   */
  @assertArgLength(3)
  async db_putString(dbName: string, key: string, value: string) {
    return false;
  }

  /**
   * Returns string from the local database.
   *
   * @param dbName Database name.
   * @param key Key name.
   * @returns The previously stored string.
   * @example
   * ```javascript
   * console.log(await provider.send("db_getString", ["testDb", "testKey"]));
   * ```
   */
  @assertArgLength(2)
  async db_getString(dbName: string, key: string) {
    return "";
  }

  /**
   * Stores binary data in the local database.
   *
   * @param {String} dbName - Database name.
   * @param {String} key - Key name.
   * @param {DATA} data - Data to store.
   * @returns True if the value was stored, otherwise false.
   * @example
   * ```javascript
   * console.log(await provider.send("db_putHex", ["testDb", "testKey", "0x0"]));
   * ```
   */
  @assertArgLength(3)
  async db_putHex(dbName: string, key: string, data: DATA) {
    return false;
  }

  /**
   * Returns binary data from the local database.
   *
   * @param dbName Database name.
   * @param key Key name.
   * @returns The previously stored data.
   * @example
   * ```javascript
   * console.log(await provider.send("db_getHex", ["testDb", "testKey"]));
   * ```
   */
  @assertArgLength(2)
  async db_getHex(dbName: string, key: string) {
    return "0x00";
  }
  //#endregion

  //#region bzz
  /**
   * Returns the kademlia table in a readable table format.
   */
  @assertArgLength(0)
  async bzz_hive() {
    return [];
  }

  /**
   * Returns details about the swarm node.
   */
  @assertArgLength(0)
  async bzz_info() {
    return [];
  }
  //#endregion

  //#region evm
  /**
   * Force a single block to be mined.
   *
   * Mines a block independent of whether or not mining is started or stopped.
   * Will mine an empty block if there are no available transactions to mine.
   *
   * @param timestamp The timestamp the block should be mined with.
   * EXPERIEMENTAL: Optionally, specify an `options` object with `timestamp`
   * and/or `blocks` fields. If `blocks` is given, it will mine exactly `blocks`
   *  number of blocks, regardless of any other blocks mined or reverted during it's
   * operation. This behavior is subject to change!
   *
   * @returns The string `"0x0"`. May return additional meta-data in the future.
   *
   * @example
   * ```javascript
   * console.log("start", await provider.send("eth_blockNumber"));
   * await provider.send("evm_mine", [{blocks: 5}] ); // mines 5 blocks
   * console.log("end", await provider.send("eth_blockNumber"));
   * ```
   */
  async evm_mine(timestamp?: number): Promise<"0x0">;
  async evm_mine(options?: {
    timestamp?: number;
    blocks?: number;
  }): Promise<"0x0">;
  @assertArgLength(0, 1)
  async evm_mine(
    arg?: number | { timestamp?: number; blocks?: number }
  ): Promise<"0x0"> {
    const blockchain = this.#blockchain;
    const vmErrorsOnRPCResponse = this.#options.chain.vmErrorsOnRPCResponse;
    // Since `typeof null === "object"` we have to guard against that
    if (arg !== null && typeof arg === "object") {
      let { blocks, timestamp } = arg;
      if (blocks == null) {
        blocks = 1;
      }
      // TODO(perf): add an option to mine a bunch of blocks in a batch so
      // we can save them all to the database in one go.
      // Devs like to move the blockchain forward by thousands of blocks at a
      // time and doing this would make it way faster
      for (let i = 0; i < blocks; i++) {
        const transactions = await blockchain.mine(-1, timestamp, true);
        if (vmErrorsOnRPCResponse) {
          assertExceptionalTransactions(transactions);
        }
      }
    } else {
      const transactions = await blockchain.mine(-1, arg as number, true);
      if (vmErrorsOnRPCResponse) {
        assertExceptionalTransactions(transactions);
      }
    }

    return "0x0";
  }

  // TODO: get example to work and clean this up
  /**
   * Sets the given account's storage to the specified value at the specified position.
   *
   * @param address - address to update storage for
   * @param position - position to store the value in
   * @param storage - value to store
   * @param blockNumber - integer block number, or the string "latest", "earliest"
   *  or "pending", see the default block parameter
   * @returns `true` if it worked
   * @example
   * ```javascript
   * const storage = "0x3e8";
   * const [address] = await provider.request({ method: "eth_accounts", params: [] });
   * const result = await provider.send("evm_setStorageAt", [address, 0, storage, "latest"]);
   * console.log(result);
   * ```
   */
  @assertArgLength(3, 4)
  async evm_setStorageAt(
    address: string,
    position: bigint | number,
    storage: string,
    blockNumber: string | Buffer | Tag = Tag.LATEST
  ) {
    const blockProm = this.#blockchain.blocks.getRaw(blockNumber);

    const trie = this.#blockchain.trie.copy();
    const block = await blockProm;
    if (!block) throw new Error("header not found");

    const blockData = (rlpDecode(block) as unknown) as [
      [Buffer, Buffer, Buffer, Buffer /* stateRoot */] /* header */,
      Buffer[],
      Buffer[]
    ];
    const headerData = blockData[0];
    const blockStateRoot = headerData[3];
    trie.root = blockStateRoot;

    const addressDataPromise = this.#blockchain.getFromTrie(
      trie,
      Address.from(address).toBuffer()
    );

    const posBuff = Quantity.from(position).toBuffer();
    const length = posBuff.length;
    let paddedPosBuff: Buffer;
    if (length < 32) {
      // storage locations are 32 bytes wide, so we need to expand any value
      // given to 32 bytes.
      paddedPosBuff = Buffer.allocUnsafe(32).fill(0);
      posBuff.copy(paddedPosBuff, 32 - length);
    } else if (length === 32) {
      paddedPosBuff = posBuff;
    } else {
      // if the position value we're passed is > 32 bytes, truncate it. This is
      // what geth does.
      paddedPosBuff = posBuff.slice(-32);
    }

    const addressData = await addressDataPromise;
    // An address's stateRoot is stored in the 3rd rlp entry
    this.#blockchain.trie.root = ((rlpDecode(addressData) as any) as [
      Buffer /*nonce*/,
      Buffer /*amount*/,
      Buffer /*stateRoot*/,
      Buffer /*codeHash*/
    ])[2];

    return new Promise((resolve, reject) => {
      this.#blockchain.trie.put(paddedPosBuff, storage, err => {
        if (err) return reject(err);
        resolve(void 0);
      });
    });
  }

  /**
   * Sets the given account's nonce to the specified value. Mines a new block
   * before returning.
   *
   * Warning: this will result in an invalid state tree.
   *
   * @param address
   * @param nonce
   * @returns `true` if it worked
   * @example
   * ```javascript
   * const nonce = "0x3e8";
   * const [address] = await provider.request({ method: "eth_accounts", params: [] });
   * const result = await provider.send("evm_setAccountNonce", [address, nonce]);
   * console.log(result);
   * ```
   */
  @assertArgLength(2)
  async evm_setAccountNonce(address: DATA, nonce: QUANTITY) {
    // TODO: the effect of this function could happen during a block mine operation, which would cause all sorts of
    // issues. We need to figure out a good way of timing this.
    const buffer = Address.from(address).toBuffer();
    const blockchain = this.#blockchain;
    const stateManager = blockchain.vm.stateManager;
    const account = await stateManager.getAccount({ buf: buffer } as any);

    account.nonce = {
      toArrayLike: () => Quantity.from(nonce).toBuffer()
    } as any;

    await stateManager.putAccount({ buf: buffer } as any, account);

    // TODO: do we need to mine a block here? The changes we're making really don't make any sense at all
    // and produce an invalid trie going forward.
    await blockchain.mine(0);
    return true;
  }

  /**
   * Jump forward in time by the given amount of time, in seconds.
   * @param seconds Number of seconds to jump forward in time by. Must be greater than or equal to `0`.
   * @returns Returns the total time adjustment, in seconds.
   * @example
   * ```javascript
   * const seconds = 10;
   * const timeAdjustment = await provider.send("evm_increaseTime", [seconds]);
   * console.log(timeAdjustment);
   * ```
   */
  @assertArgLength(1)
  async evm_increaseTime(seconds: QUANTITY) {
    const milliseconds =
      (typeof seconds === "number"
        ? seconds
        : Quantity.from(seconds).toNumber()) * 1000;
    return Math.floor(this.#blockchain.increaseTime(milliseconds) / 1000);
  }

  /**
   * Sets the internal clock time to the given timestamp.
   *
   * Warning: This will allow you to move *backwards* in time, which may cause
   * new blocks to appear to be mined before old blocks. This is will result in
   * an invalid state.
   *
   * @param time JavaScript timestamp (millisecond precision).
   * @returns The amount of *seconds* between the given timestamp and now.
   * @example
   * ```javascript
   * const currentDate = Date.now();
   * setTimeout(async () => {
   *   const time = await provider.send("evm_setTime", [currentDate]);
   *   console.log(time); // should be about two seconds ago
   * }, 1000)
   * ```
   */
  @assertArgLength(0, 1)
  async evm_setTime(time: QUANTITY | Date) {
    let t: number;
    switch (typeof time) {
      case "object":
        t = time.getTime();
        break;
      case "number":
        t = time;
        break;
      default:
        t = Quantity.from(time).toNumber();
        break;
    }
    return Math.floor(this.#blockchain.setTime(t) / 1000);
  }

  /**
   * Revert the state of the blockchain to a previous snapshot. Takes a single
   * parameter, which is the snapshot id to revert to. This deletes the given
   * snapshot, as well as any snapshots taken after (Ex: reverting to id 0x1
   * will delete snapshots with ids 0x1, 0x2, etc... If no snapshot id is
   * passed it will revert to the latest snapshot.
   *
   * @param snapshotId the snapshot id to revert
   * @returns `true` if a snapshot was reverted, otherwise `false`
   *
   * @example
   * ```javascript
   * const [from, to] = await provider.send("eth_accounts");
   * const startingBalance = BigInt(await provider.send("eth_getBalance", [from] ));
   *
   * // take a snapshot
   * const snapshotId = await provider.send("evm_snapshot");
   *
   * // send value to another account (over-simplified example)
   * await provider.send("eth_subscribe", ["newHeads"] );
   * await provider.send("eth_sendTransaction", [{from, to, value: "0xffff"}] );
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * // ensure balance has updated
   * const newBalance = await provider.send("eth_getBalance", [from] );
   * assert(BigInt(newBalance) < startingBalance);
   *
   * // revert the snapshot
   * const isReverted = await provider.send("evm_revert", [snapshotId] );
   * assert(isReverted);
   * console.log(isReverted);
   *
   * // ensure balance has reverted
   * const endingBalance = await provider.send("eth_getBalance", [from] );
   * const isBalanceReverted = assert.strictEqual(BigInt(endingBalance), startingBalance);
   * console.log({isBalanceReverted: isBalanceReverted});
   * ```
   */
  @assertArgLength(1)
  async evm_revert(snapshotId: QUANTITY) {
    return this.#blockchain.revert(Quantity.from(snapshotId));
  }

  /**
   * Snapshot the state of the blockchain at the current block. Takes no
   * parameters. Returns the id of the snapshot that was created. A snapshot can
   * only be reverted once. After a successful `evm_revert`, the same snapshot
   * id cannot be used again. Consider creating a new snapshot after each
   * `evm_revert` if you need to revert to the same point multiple times.
   *
   * @returns The hex-encoded identifier for this snapshot
   *
   * @example
   * ```javascript
   * const provider = ganache.provider();
   * const [from, to] = await provider.send("eth_accounts");
   * const startingBalance = BigInt(await provider.send("eth_getBalance", [from] ));
   *
   * // take a snapshot
   * const snapshotId = await provider.send("evm_snapshot");
   *
   * // send value to another account (over-simplified example)
   * await provider.send("eth_subscribe", ["newHeads"] );
   * await provider.send("eth_sendTransaction", [{from, to, value: "0xffff"}] );
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * // ensure balance has updated
   * const newBalance = await provider.send("eth_getBalance", [from] );
   * assert(BigInt(newBalance) < startingBalance);
   *
   * // revert the snapshot
   * const isReverted = await provider.send("evm_revert", [snapshotId] );
   * assert(isReverted);
   *
   * // ensure balance has reverted
   * const endingBalance = await provider.send("eth_getBalance", [from] );
   * const isBalanceReverted = assert.strictEqual(BigInt(endingBalance), startingBalance);
   * console.log({isBalanceReverted: isBalanceReverted});
   * ```
   */
  async evm_snapshot() {
    return Quantity.from(this.#blockchain.snapshot());
  }

  /**
   * Unlocks any unknown account.
   *
   * Note: accounts known to the `personal` namespace and accounts returned by
   * `eth_accounts` cannot be unlocked using this method.
   *
   * @param address address the address of the account to unlock
   * @param duration (default: disabled) Duration in seconds how long the account
   * should remain unlocked for. Set to 0 to disable automatic locking.
   * @returns `true` if the account was unlocked successfully, `false` if the
   * account was already unlocked. Throws an error if the account could not be
   * unlocked.
   * @example
   * ```javascript
   * const address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
   * const result = await provider.send("evm_unlockUnknownAccount", [address]);
   * console.log(result)
   * ```
   */
  async evm_unlockUnknownAccount(address: DATA, duration: number = 0) {
    return this.#wallet.unlockUnknownAccount(address.toLowerCase(), duration);
  }

  /**
   * Locks any unknown account.
   *
   * Note: accounts known to the `personal` namespace and accounts returned by
   * `eth_accounts` cannot be locked using this method.
   *
   * @param address The address of the account to lock.
   * @returns `true` if the account was locked successfully, `false` if the
   * account was already locked. Throws an error if the account could not be
   * locked.
   * @example
   * ```javascript
   * const address = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
   * const result = await provider.send("evm_lockUnknownAccount", [address]);
   * console.log(result)
   * ```
   */
  async evm_lockUnknownAccount(address: DATA) {
    const lowerAddress = address.toLowerCase();
    // if this is a known account, don'we can't unlock it this way
    if (this.#wallet.knownAccounts.has(lowerAddress)) {
      throw new Error("cannot lock known/personal account");
    }
    return this.#wallet.lockAccount(lowerAddress);
  }

  //#endregion evm

  //#region miner
  /**
   * Resume the CPU mining process with the given number of threads.
   *
   * Note: `threads` is ignored.
   * @param threads number of threads to resume the CPU mining process with
   * @returns true
   * @example
   * ```javascript
   * await provider.send("miner_stop")
   * // check that eth_mining returns false
   * console.log(await provider.send("eth_mining"));
   * await provider.send("miner_start")
   * // check that eth_mining returns true
   * console.log(await provider.send("eth_mining"));
   * ```
   */
  @assertArgLength(0, 1)
  async miner_start(threads: number = 1) {
    if (this.#options.miner.legacyInstamine === true) {
      const transactions = await this.#blockchain.resume(threads);
      if (transactions != null && this.#options.chain.vmErrorsOnRPCResponse) {
        assertExceptionalTransactions(transactions);
      }
    } else {
      this.#blockchain.resume(threads);
    }
    return true;
  }

  /**
   * Stop the CPU mining operation.
   * @returns true
   * @example
   * ```javascript
   * // check that eth_mining returns true
   * console.log(await provider.send("eth_mining"));
   * await provider.send("miner_stop")
   * // check that eth_mining returns false
   * console.log(await provider.send("eth_mining"));
   * ```
   */
  @assertArgLength(0)
  async miner_stop() {
    this.#blockchain.pause();
    return true;
  }

  /**
   * Sets the minimal accepted gas price when mining transactions.
   * Any transactions that are below this limit are excluded from the mining
   * process.
   * @param number minimal accepted gas price
   * @returns true
   * @example
   * ```javascript
   * console.log(await provider.send("miner_setGasPrice", [300000]));
   * ```
   */
  @assertArgLength(1)
  async miner_setGasPrice(number: QUANTITY) {
    this.#options.miner.gasPrice = Quantity.from(number);
    return true;
  }

  /**
   * Sets the etherbase, where mining rewards will go.
   * @param address the address where the mining rewards will go
   * @returns true
   * @example
   * ```javascript
   * const [account] = await provider.request({ method: "eth_accounts", params: [] });
   * console.log(await provider.send("miner_setEtherbase", [account]));
   * ```
   */
  @assertArgLength(1)
  async miner_setEtherbase(address: DATA) {
    this.#blockchain.coinbase = Address.from(address);
    return true;
  }

  /**
   * Set the extraData block header field a miner can include.
   * @param extra the extraData to include
   * @returns if successfully set returns true, otherwise returns an error
   * @example
   * ```javascript
   * console.log(await provider.send("miner_setExtra", ["0x0"]));
   * ```
   */
  @assertArgLength(1)
  async miner_setExtra(extra: DATA) {
    const bytes = Data.from(extra);
    const length = bytes.toBuffer().length;
    if (length > 32) {
      throw new Error(`extra exceeds max length. ${length} > 32`);
    }
    this.#options.miner.extraData = bytes;
    return true;
  }
  //#endregion

  //#region web3
  /**
   * Returns the current client version.
   * @returns The current client version.
   * @example
   * ```javascript
   * console.log(await provider.send("web3_clientVersion"));
   * ```
   */
  @assertArgLength(0)
  async web3_clientVersion() {
    return CLIENT_VERSION;
  }

  /**
   * Returns Keccak-256 (not the standardized SHA3-256) of the given data.
   * @param data The data to convert into a SHA3 hash.
   * @returns The SHA3 result of the given string.
   * @example
   * ```javascript
   * const data = "hello trufflers";
   * const sha3 = await provider.send("web3_sha3", [data]);
   * console.log(sha3);
   * ```
   */
  @assertArgLength(1)
  async web3_sha3(data: DATA) {
    return Data.from(keccak(Buffer.from(data)));
  }
  //#endregion

  //#region net
  /**
   * Returns the current network id.
   * @returns The current network id. This value should NOT be JSON-RPC
   * Quantity/Data encoded.
   * @example
   * ```javascript
   * console.log(await provider.send("net_version"))
   * ```
   */
  @assertArgLength(0)
  async net_version() {
    return this.#options.chain.networkId.toString();
  }

  /**
   * Returns `true` if client is actively listening for network connections.
   * @returns `true` when listening, otherwise `false`.
   * @example
   * ```javascript
   * console.log(await provider.send("net_listening"))
   * ```
   */
  @assertArgLength(0)
  async net_listening() {
    return true;
  }

  /**
   * Returns number of peers currently connected to the client.
   * @returns integer of the number of connected peers.
   * @example
   * ```javascript
   * console.log(await provider.send("net_peerCount"))
   * ```
   */
  @assertArgLength(0)
  async net_peerCount() {
    return RPCQUANTITY_ZERO;
  }
  //#endregion

  //#region eth

  // TODO: fix transaction object formatting, also why is the example not working?
  /**
   * Generates and returns an estimate of how much gas is necessary to allow the
   * transaction to complete. The transaction will not be added to the
   * blockchain. Note that the estimate may be significantly more than the
   * amount of gas actually used by the transaction, for a variety of reasons
   * including EVM mechanics and node performance.
   *
   * @param transaction - the transaction call object
   *  (from - DATA, 20 bytes (optional) - the address the transaction is sent from
   *  to - DATA, 20 bytes - the address the transaction is sent to
   *  gas - QUANTITY (optional) - integer of the maximum gas allowance for the transaction
   *  gasPrice - QUANTITY (optional) - integer of the price of gas in wei
   *  value - QUANTITY (optional) - integer of the value in wei
   *  data - DATA (optional) - hash of the method signature and the ABI encoded parameters)
   * @param blockNumber integer block number, or the string "latest", "earliest"
   *  or "pending", see the default block parameter
   *
   * @returns the amount of gas used.
   *
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * const gasEstimate = await provider.request({ method: "eth_estimateGas", params: [{ from: accounts[0], to: accounts[1] }, "latest" ] });
   * console.log(gasEstimate);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_estimateGas(
    transaction: any,
    blockNumber: QUANTITY | Tag = Tag.LATEST
  ): Promise<Quantity> {
    const blockchain = this.#blockchain;
    const blocks = blockchain.blocks;
    const parentBlock = await blocks.get(blockNumber);
    const parentHeader = parentBlock.header;
    const options = this.#options;

    const generateVM = () => {
      return blockchain.vm.copy();
    };
    return new Promise((resolve, reject) => {
      const { coinbase } = blockchain;
      const tx = TransactionFactory.fromRpc(transaction, blockchain.common);
      if (tx.from == null) {
        tx.from = coinbase;
      }
      if (tx.gas.isNull()) {
        // eth_estimateGas isn't subject to regular transaction gas limits
        tx.gas = options.miner.callGasLimit;
      }

      const block = new RuntimeBlock(
        Quantity.from((parentHeader.number.toBigInt() || 0n) + 1n),
        parentHeader.parentHash,
        parentHeader.miner,
        tx.gas.toBuffer(),
        parentHeader.gasUsed.toBuffer(),
        parentHeader.timestamp,
        options.miner.difficulty,
        parentHeader.totalDifficulty
      );
      const runArgs = {
        tx: tx.toVmTransaction(),
        block,
        skipBalance: true,
        skipNonce: true
      };
      estimateGas(generateVM, runArgs, (err: Error, result: any) => {
        if (err) return reject(err);
        resolve(Quantity.from(result.gasEstimate.toArrayLike(Buffer)));
      });
    });
  }

  /**
   * Returns the current ethereum protocol version.
   * @returns The current ethereum protocol version.
   * @example
   * ```javascript
   * const version = await provider.request({ method: "eth_protocolVersion", params: [] });
   * console.log(version);
   * ```
   */
  @assertArgLength(0)
  async eth_protocolVersion() {
    return PROTOCOL_VERSION;
  }

  // TODO: figure out object formatting for returns
  /**
   * Returns an object with data about the sync status or false.
   * @returns An object with sync status data or false, when not syncing:
   *   startingBlock: {bigint} - The block at which the import started (will
   *    only be reset, after the sync reached his head)
   *   currentBlock: {bigint} - The current block, same as eth_blockNumber
   *   highestBlock: {bigint} - The estimated highest block
   * @example
   * ```javascript
   * const result = await provider.request({ method: "eth_syncing", params: [] });
   * console.log(result);
   * ```
   */
  @assertArgLength(0)
  async eth_syncing() {
    return false;
  }

  /**
   * Returns the client coinbase address.
   * @returns 20 bytes - the current coinbase address.
   * @example
   * ```javascript
   * const coinbaseAddress = await provider.request({ method: "eth_coinbase" });
   * console.log(coinbaseAddress);
   * ```
   */
  @assertArgLength(0)
  async eth_coinbase() {
    return this.#blockchain.coinbase;
  }

  /**
   * Returns information about a block by block number.
   * @param number Integer of a block number, or the string "earliest", "latest" or "pending", as in the
   * default block parameter.
   * @param transactions If `true` it returns the full transaction objects, if `false` only the hashes of the
   * transactions.
   * @returns The block, `null` if the block doesn't exist.
   *
   * * `hash`: `DATA`, 32 Bytes - Hash of the block. `null` when pending.
   * * `parentHash`: `DATA`, 32 Bytes - Hash of the parent block.
   * * `sha3Uncles`: `DATA`, 32 Bytes - SHA3 of the uncles data in the block.
   * * `miner`: `DATA`, 20 Bytes -  Address of the miner.
   * * `stateRoot`: `DATA`, 32 Bytes - The root of the state trie of the block.
   * * `transactionsRoot`: `DATA`, 32 Bytes - The root of the transaction trie of the block.
   * * `receiptsRoot`: `DATA`, 32 Bytes - The root of the receipts trie of the block.
   * * `logsBloom`: `DATA`, 256 Bytes - The bloom filter for the logs of the block. `null` when pending.
   * * `difficulty`: `QUANTITY` - Integer of the difficulty of this block.
   * * `number`: `QUANTITY` - The block number. `null` when pending.
   * * `gasLimit`: `QUANTITY` - The maximum gas allowed in the block.
   * * `gasUsed`: `QUANTITY` - Total gas used by all transactions in the block.
   * * `timestamp`: `QUANTITY` - The unix timestamp for when the block was collated.
   * * `extraData`: `DATA` - Extra data for the block.
   * * `mixHash`: `DATA`, 256 Bytes - Hash identifier for the block.
   * * `nonce`: `DATA`, 8 Bytes - Hash of the generated proof-of-work. `null` when pending.
   * * `totalDifficulty`: `QUANTITY` - Integer of the total difficulty of the chain until this block.
   * * `size`: `QUANTITY` - Integer the size of the block in bytes.
   * * `transactions`: `Array` - Array of transaction objects or 32 Bytes transaction hashes depending on the last parameter.
   * * `uncles`: `Array` - Array of uncle hashes.
   *
   * @example
   * ```javascript
   * const block = await provider.request({ method: "eth_getBlockByNumber", params: ["0x0", false] });
   * console.log(block);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_getBlockByNumber(number: QUANTITY | Tag, transactions = false) {
    const block = await this.#blockchain.blocks.get(number).catch(_ => null);
    return block ? block.toJSON(transactions) : null;
  }

  /**
   * Returns information about a block by block hash.
   * @param hash Hash of a block.
   * @param transactions If `true` it returns the full transaction objects, if `false` only the hashes of the
   * transactions.
   * @returns The block, `null` if the block doesn't exist.
   *
   * * `hash`: `DATA`, 32 Bytes - Hash of the block. `null` when pending.
   * * `parentHash`: `DATA`, 32 Bytes - Hash of the parent block.
   * * `sha3Uncles`: `DATA`, 32 Bytes - SHA3 of the uncles data in the block.
   * * `miner`: `DATA`, 20 Bytes -  Address of the miner.
   * * `stateRoot`: `DATA`, 32 Bytes - The root of the state trie of the block.
   * * `transactionsRoot`: `DATA`, 32 Bytes - The root of the transaction trie of the block.
   * * `receiptsRoot`: `DATA`, 32 Bytes - The root of the receipts trie of the block.
   * * `logsBloom`: `DATA`, 256 Bytes - The bloom filter for the logs of the block. `null` when pending.
   * * `difficulty`: `QUANTITY` - Integer of the difficulty of this block.
   * * `number`: `QUANTITY` - The block number. `null` when pending.
   * * `gasLimit`: `QUANTITY` - The maximum gas allowed in the block.
   * * `gasUsed`: `QUANTITY` - Total gas used by all transactions in the block.
   * * `timestamp`: `QUANTITY` - The unix timestamp for when the block was collated.
   * * `extraData`: `DATA` - Extra data for the block.
   * * `mixHash`: `DATA`, 256 Bytes - Hash identifier for the block.
   * * `nonce`: `DATA`, 8 Bytes - Hash of the generated proof-of-work. `null` when pending.
   * * `totalDifficulty`: `QUANTITY` - Integer of the total difficulty of the chain until this block.
   * * `size`: `QUANTITY` - Integer the size of the block in bytes.
   * * `transactions`: `Array` - Array of transaction objects or 32 Bytes transaction hashes depending on the last parameter.
   * * `uncles`: `Array` - Array of uncle hashes.
   *
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, gas: "0x5b8d80", data: simpleSol }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const txReceipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash]})
   * const block = await provider.request({ method: "eth_getBlockByHash", params: [txReceipt.blockHash, true] });
   * console.log(block);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_getBlockByHash(hash: DATA, transactions = false) {
    const block = await this.#blockchain.blocks
      .getByHash(hash)
      .catch(_ => null);
    return block ? block.toJSON(transactions) : null;
  }

  /**
   * Returns the number of transactions in a block from a block matching the given block number.
   * @param number Integer of a block number, or the string "earliest", "latest" or "pending", as in the
   * default block parameter.
   * @returns integer of the number of transactions in the block
   * @example
   * ```javascript
   * const txCount = await provider.request({ method: "eth_getBlockTransactionCountByNumber", params: ["0x0"] });
   * console.log(txCount);
   * ```
   */
  @assertArgLength(1)
  async eth_getBlockTransactionCountByNumber(number: QUANTITY | Tag) {
    const rawBlock = await this.#blockchain.blocks.getRaw(number);
    if (rawBlock) {
      const data = rlpDecode(rawBlock);
      return Quantity.from((data[1] as any).length);
    } else {
      return null;
    }
  }

  /**
   * Returns the number of transactions in a block from a block matching the given block hash.
   * @param hash DATA, 32 Bytes - hash of a block.
   * @returns integer of the number of transactions in the block
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, gas: "0x5b8d80", data: simpleSol }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const txReceipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
   * const txCount = await provider.request({ method: "eth_getBlockTransactionCountByHash", params: [txReceipt.blockHash] });
   * console.log(txCount);
   * ```
   */
  @assertArgLength(1)
  async eth_getBlockTransactionCountByHash(hash: DATA) {
    const number = await this.#blockchain.blocks.getNumberFromHash(hash);
    if (number) {
      return this.eth_getBlockTransactionCountByNumber(
        Quantity.from(number).toNumber()
      );
    } else {
      return null;
    }
  }

  /**
   * Returns a list of available compilers
   * @returns list of available compilers
   * @example
   * ```javascript
   * const compilers = await provider.send("eth_getCompilers");
   * console.log(compilers);
   * ```
   */
  @assertArgLength(0)
  async eth_getCompilers() {
    return [] as string[];
  }

  // TODO: how to format the transaction object for @returns
  /**
   * Returns information about a transaction by block hash and transaction index position.
   * @param hash DATA, 32 Bytes - hash of a block.
   * @param index QUANTITY - integer of the transaction index position.
   * @returns the transaction object or null if no transaction was found
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: accounts[0], to: accounts[1], gas: "0x5b8d80" }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const { blockHash, transactionIndex } = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
   *
   * const tx = await provider.request({ method: "eth_getTransactionByBlockHashAndIndex", params: [ blockHash, transactionIndex ] });
   * console.log(tx);
   * ```
   */
  @assertArgLength(2)
  async eth_getTransactionByBlockHashAndIndex(hash: DATA, index: QUANTITY) {
    const block = await this.eth_getBlockByHash(hash, true);
    if (block) {
      const tx = block.transactions[Quantity.from(index).toNumber()];
      if (tx) return tx;
    }
    return null;
  }

  // TODO: how to format the transaction object for @returns
  /**
   * Returns information about a transaction by block number and transaction index position.
   * @param number QUANTITY|TAG - a block number, or the string "earliest", "latest" or "pending", as in the default
   * block parameter.
   * @param index QUANTITY - integer of the transaction index position.
   * @returns the transaction object or null if no transaction was found
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: accounts[0], to: accounts[1], gas: "0x5b8d80" }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const { transactionIndex } = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
   *
   * const tx = await provider.request({ method: "eth_getTransactionByBlockNumberAndIndex", params: [ "latest", transactionIndex ] });
   * console.log(tx);
   * ```
   */
  @assertArgLength(2)
  async eth_getTransactionByBlockNumberAndIndex(
    number: QUANTITY | Tag,
    index: QUANTITY
  ) {
    const block = await this.eth_getBlockByNumber(number, true);
    return block.transactions[parseInt(Quantity.from(index).toString(), 10)];
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block hash.
   * @param hash Hash of a block.
   * @returns The number of uncles in a block.
   * @example
   * ```javascript
   * const blockHash = await provider.send("eth_getBlockByNumber", ["latest"] );
   * const uncleCount = await provider.send("eth_getUncleCountByBlockHash", [blockHash] );
   * console.log(uncleCount);
   * ```
   */
  @assertArgLength(1)
  async eth_getUncleCountByBlockHash(hash: DATA) {
    return RPCQUANTITY_ZERO;
  }

  /**
   * Returns the number of uncles in a block from a block matching the given block hash.
   * @param blockNumber A block number, or the string "earliest", "latest" or "pending".
   * @returns The number of uncles in a block.
   * @example
   * ```javascript
   * const uncleCount = await provider.send("eth_getUncleCountByBlockNumber", ["latest"] );
   * console.log(uncleCount);
   * ```
   */
  @assertArgLength(1)
  async eth_getUncleCountByBlockNumber(number: QUANTITY | Tag) {
    return RPCQUANTITY_ZERO;
  }

  /**
   * Returns information about a uncle of a block by hash and uncle index position.
   *
   * @param hash Hash of a block.
   * @param index The uncle's index position.
   * @returns A block object or `null` when no block is found.
   *
   * * `hash`: `DATA`, 32 Bytes - Hash of the block. `null` when pending.
   * * `parentHash`: `DATA`, 32 Bytes - Hash of the parent block.
   * * `sha3Uncles`: `DATA`, 32 Bytes - SHA3 of the uncles data in the block.
   * * `miner`: `DATA`, 20 Bytes -  Address of the miner.
   * * `stateRoot`: `DATA`, 32 Bytes - The root of the state trie of the block.
   * * `transactionsRoot`: `DATA`, 32 Bytes - The root of the transaction trie of the block.
   * * `receiptsRoot`: `DATA`, 32 Bytes - The root of the receipts trie of the block.
   * * `logsBloom`: `DATA`, 256 Bytes - The bloom filter for the logs of the block. `null` when pending.
   * * `difficulty`: `QUANTITY` - Integer of the difficulty of this block.
   * * `number`: `QUANTITY` - The block number. `null` when pending.
   * * `gasLimit`: `QUANTITY` - The maximum gas allowed in the block.
   * * `gasUsed`: `QUANTITY` - Total gas used by all transactions in the block.
   * * `timestamp`: `QUANTITY` - The unix timestamp for when the block was collated.
   * * `extraData`: `DATA` - Extra data for the block.
   * * `mixHash`: `DATA`, 256 Bytes - Hash identifier for the block.
   * * `nonce`: `DATA`, 8 Bytes - Hash of the generated proof-of-work. `null` when pending.
   * * `totalDifficulty`: `QUANTITY` - Integer of the total difficulty of the chain until this block.
   * * `size`: `QUANTITY` - Integer the size of the block in bytes.
   * * `transactions`: `Array` - Array of transaction objects or 32 Bytes transaction hashes depending on the last parameter.
   * * `uncles`: `Array` - Array of uncle hashes.
   *
   * @example
   * ```javascript
   * const blockHash = await provider.send("eth_getBlockByNumber", ["latest"] );
   * const block = await provider.send("eth_getUncleByBlockHashAndIndex", [blockHash, "0x0"] );
   * console.log(block);
   * ```
   */
  @assertArgLength(2)
  async eth_getUncleByBlockHashAndIndex(hash: DATA, index: QUANTITY) {
    return null as ReturnType<EthereumApi["eth_getBlockByHash"]>;
  }

  /**
   * Returns information about a uncle of a block by hash and uncle index position.
   *
   * @param blockNumber A block number, or the string "earliest", "latest" or "pending".
   * @param uncleIndex The uncle's index position.
   * @returns A block object or `null` when no block is found.
   *
   * * `hash`: `DATA`, 32 Bytes - Hash of the block. `null` when pending.
   * * `parentHash`: `DATA`, 32 Bytes - Hash of the parent block.
   * * `sha3Uncles`: `DATA`, 32 Bytes - SHA3 of the uncles data in the block.
   * * `miner`: `DATA`, 20 Bytes -  Address of the miner.
   * * `stateRoot`: `DATA`, 32 Bytes - The root of the state trie of the block.
   * * `transactionsRoot`: `DATA`, 32 Bytes - The root of the transaction trie of the block.
   * * `receiptsRoot`: `DATA`, 32 Bytes - The root of the receipts trie of the block.
   * * `logsBloom`: `DATA`, 256 Bytes - The bloom filter for the logs of the block. `null` when pending.
   * * `difficulty`: `QUANTITY` - Integer of the difficulty of this block.
   * * `number`: `QUANTITY` - The block number. `null` when pending.
   * * `gasLimit`: `QUANTITY` - The maximum gas allowed in the block.
   * * `gasUsed`: `QUANTITY` - Total gas used by all transactions in the block.
   * * `timestamp`: `QUANTITY` - The unix timestamp for when the block was collated.
   * * `extraData`: `DATA` - Extra data for the block.
   * * `mixHash`: `DATA`, 256 Bytes - Hash identifier for the block.
   * * `nonce`: `DATA`, 8 Bytes - Hash of the generated proof-of-work. `null` when pending.
   * * `totalDifficulty`: `QUANTITY` - Integer of the total difficulty of the chain until this block.
   * * `size`: `QUANTITY` - Integer the size of the block in bytes.
   * * `transactions`: `Array` - Array of transaction objects or 32 Bytes transaction hashes depending on the last parameter.
   * * `uncles`: `Array` - Array of uncle hashes.
   *
   * @example
   * ```javascript
   * const block = await provider.send("eth_getUncleByBlockNumberAndIndex", ["latest", "0x0"] );
   * console.log(block);
   * ```
   */
  @assertArgLength(2)
  async eth_getUncleByBlockNumberAndIndex(
    blockNumber: QUANTITY | Tag,
    uncleIndex: QUANTITY
  ) {
    return null as ReturnType<EthereumApi["eth_getBlockByHash"]>;
  }

  /**
   * Returns: An Array with the following elements
   * 1: `DATA`, 32 Bytes - current block header pow-hash
   * 2: `DATA`, 32 Bytes - the seed hash used for the DAG.
   * 3: `DATA`, 32 Bytes - the boundary condition ("target"), 2^256 / difficulty.
   *
   * @param filterId A filter id.
   * @returns The hash of the current block, the seedHash, and the boundary condition to be met ("target").
   * @example
   * ```javascript
   * console.log(await provider.send("eth_getWork", ["0x0"] ));
   *  ```
   */
  @assertArgLength(1)
  async eth_getWork(filterId: QUANTITY) {
    return [] as [string, string, string] | [];
  }

  /**
   * Used for submitting a proof-of-work solution.
   *
   * @param nonce The nonce found (64 bits).
   * @param powHash The header's pow-hash (256 bits).
   * @param digest The mix digest (256 bits).
   * @returns `true` if the provided solution is valid, otherwise `false`.
   * @example
   * ```javascript
   * const nonce = "0xe0df4bd14ab39a71";
   * const powHash = "0x0000000000000000000000000000000000000000000000000000000000000001";
   * const digest = "0xb2222a74119abd18dbcb7d1f661c6578b7bbeb4984c50e66ed538347f606b971";
   * const result = await provider.request({ method: "eth_submitWork", params: [nonce, powHash, digest] });
   * console.log(result);
   * ```
   */
  @assertArgLength(3)
  async eth_submitWork(nonce: DATA, powHash: DATA, digest: DATA) {
    return false;
  }

  /**
   * Used for submitting mining hashrate.
   *
   * @param hashRate A hexadecimal string representation (32 bytes) of the hash rate.
   * @param clientID A random hexadecimal(32 bytes) ID identifying the client.
   * @returns `true` if submitting went through succesfully and `false` otherwise.
   * @example
   * ```javascript
   * const hashRate = "0x0000000000000000000000000000000000000000000000000000000000000001";
   * const clientId = "0xb2222a74119abd18dbcb7d1f661c6578b7bbeb4984c50e66ed538347f606b971";
   * const result = await provider.request({ method: "eth_submitHashrate", params: [hashRate, clientId] });
   * console.log(result);
   * ```
   */
  @assertArgLength(2)
  async eth_submitHashrate(hashRate: DATA, clientID: DATA) {
    return false;
  }

  /**
   * Returns `true` if client is actively mining new blocks.
   * @returns returns `true` if the client is mining, otherwise `false`.
   * @example
   * ```javascript
   * const isMining = await provider.request({ method: "eth_mining", params: [] });
   * console.log(isMining);
   * ```
   */
  @assertArgLength(0)
  async eth_mining() {
    // we return the blockchain's started state
    return this.#blockchain.isStarted();
  }

  /**
   * Returns the number of hashes per second that the node is mining with.
   * @returns number of hashes per second.
   * @example
   * ```javascript
   * const hashrate = await provider.request({ method: "eth_hashrate", params: [] });
   * console.log(hashrate);
   * ```
   */
  @assertArgLength(0)
  async eth_hashrate() {
    return RPCQUANTITY_ZERO;
  }

  /**
   * Returns the current price per gas in wei.
   * @returns integer of the current gas price in wei.
   * @example
   * ```javascript
   * const gasPrice = await provider.request({ method: "eth_gasPrice", params: [] });
   * console.log(gasPrice);
   * ```
   */
  @assertArgLength(0)
  async eth_gasPrice() {
    return this.#options.miner.gasPrice;
  }

  /**
   * Returns a list of addresses owned by client.
   * @returns Array of 20 Bytes - addresses owned by the client.
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * console.log(accounts);
   * ```
   */
  @assertArgLength(0)
  async eth_accounts() {
    return this.#wallet.addresses;
  }

  /**
   * Returns the number of the most recent block.
   * @returns The current block number the client is on.
   * @example
   * ```javascript
   * const blockNumber = await provider.request({ method: "eth_blockNumber" });
   * console.log(blockNumber);
   * ```
   */
  @assertArgLength(0)
  async eth_blockNumber() {
    return this.#blockchain.blocks.latest.header.number;
  }

  /**
   * Returns the currently configured chain id, a value used in
   * replay-protected transaction signing as introduced by EIP-155.
   * @returns The chain id as a string.
   * @EIP [155 – Simple replay attack protection](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md)
   *
   * @example
   * ```javascript
   * const chainId = await provider.send("eth_chainId");
   * console.log(chainId);
   * ```
   */
  @assertArgLength(0)
  async eth_chainId() {
    return Quantity.from(this.#options.chain.chainId);
  }

  /**
   * Returns the balance of the account of given address.
   * @param address DATA, 20 Bytes - address to check for balance.
   * @param blockNumber integer block number, or the string "latest", "earliest"
   *  or "pending", see the default block parameter
   *
   * @returns integer of the account balance in wei
   *
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * const balance = await provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] });
   * console.log(balance);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_getBalance(
    address: DATA,
    blockNumber: QUANTITY | Tag = Tag.LATEST
  ) {
    return this.#blockchain.accounts.getBalance(
      Address.from(address),
      blockNumber
    );
  }

  /**
   * Returns code at a given address.
   *
   * @param address 20 Bytes - address
   * @param blockNumber integer block number, or the string "latest", "earliest" or "pending", see the default block
   * parameter
   * @returns the code from the given address.
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, gas: "0x5b8d80", data: simpleSol }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const txReceipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash]})
   * const code = await provider.request({ method: "eth_getCode", params: [txReceipt.contractAddress, "latest"] });
   * console.log(code);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_getCode(address: DATA, blockNumber: QUANTITY | Tag = Tag.LATEST) {
    const blockchain = this.#blockchain;
    const blockProm = blockchain.blocks.getRaw(blockNumber);

    const trie = blockchain.trie.copy();
    const block = await blockProm;
    if (!block) throw new Error("header not found");

    const blockData = (rlpDecode(block) as unknown) as [
      [Buffer, Buffer, Buffer, Buffer /* stateRoot */] /* header */,
      Buffer[],
      Buffer[]
    ];
    const headerData = blockData[0];
    const blockStateRoot = headerData[3];
    trie.root = blockStateRoot;

    const addressDataPromise = this.#blockchain.getFromTrie(
      trie,
      Address.from(address).toBuffer()
    );

    const addressData = await addressDataPromise;
    // An address's codeHash is stored in the 4th rlp entry
    const codeHash = ((rlpDecode(addressData) as any) as [
      Buffer /*nonce*/,
      Buffer /*amount*/,
      Buffer /*stateRoot*/,
      Buffer /*codeHash*/
    ])[3];
    // if this address isn't a contract, return 0x
    if (!codeHash || KECCAK256_NULL.equals(codeHash)) {
      return Data.from("0x");
    }
    return new Promise((resolve, reject) => {
      trie.getRaw(codeHash, (err: Error, data: Buffer) => {
        if (err) return void reject(err);
        resolve(Data.from(data));
      });
    });
  }

  /**
   * Returns the value from a storage position at a given address.
   * @param address DATA, 20 Bytes - address of the storage.
   * @param position QUANTITY - integer of the position in the storage.
   * @param blockNumber integer block number, or the string "latest", "earliest"
   *  or "pending", see the default block parameter
   * @returns the value in storage at the requested position
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, gas: "0x5b8d80", data: simpleSol }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const txReceipt = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash]})
   * const storageValue = await provider.request({ method: "eth_getStorageAt", params: [txReceipt.contractAddress, "0x0", "latest"] });
   * console.log(storageValue);
   * ```
   */
  @assertArgLength(2, 3)
  async eth_getStorageAt(
    address: DATA,
    position: QUANTITY,
    blockNumber: QUANTITY | Tag = Tag.LATEST
  ) {
    const blockchain = this.#blockchain;
    const blockNum = blockchain.blocks.getEffectiveNumber(blockNumber);
    const block = await blockchain.blocks.getRawByBlockNumber(blockNum);

    if (!block) throw new Error("header not found");

    const [[, , , blockStateRoot]] = decode<GanacheRawBlock>(block);
    const trie = blockchain.trie.copy(false);
    trie.setContext(blockStateRoot, null, blockNum);

    const posBuff = Quantity.from(position).toBuffer();
    const length = posBuff.length;
    let paddedPosBuff: Buffer;
    if (length < 32) {
      // storage locations are 32 bytes wide, so we need to expand any value
      // given to 32 bytes.
      paddedPosBuff = Buffer.allocUnsafe(32).fill(0);
      posBuff.copy(paddedPosBuff, 32 - length);
    } else if (length === 32) {
      paddedPosBuff = posBuff;
    } else {
      // if the position value we're passed is > 32 bytes, truncate it. This is
      // what geth does.
      paddedPosBuff = posBuff.slice(-32);
    }

    const addressBuf = Address.from(address).toBuffer();
    const addressData = await trie.get(addressBuf);
    // An address's stateRoot is stored in the 3rd rlp entry
    const addressStateRoot = decode<EthereumRawAccount>(addressData)[2];
    trie.setContext(addressStateRoot, addressBuf, blockNum);
    const value = await trie.get(paddedPosBuff);
    return Data.from(decode(value));
  }

  // TODO: how to format the transaction object for @returns
  /**
   * Returns the information about a transaction requested by transaction hash.
   *
   * @param transactionHash 32 Bytes - hash of a transaction
   * @returns the transaction object or null if no transaction was found
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: accounts[0], to: accounts[1], gas: "0x5b8d80" }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * const tx = await provider.request({ method: "eth_getTransactionByHash", params: [ txHash ] });
   * console.log(tx);
   * ```
   */
  @assertArgLength(1)
  async eth_getTransactionByHash(transactionHash: DATA) {
    const { transactions } = this.#blockchain;
    const hashBuffer = Data.from(transactionHash).toBuffer();

    // we must check the database before checking the pending cache, because the
    // cache is updated _after_ the transaction is already in the database, and
    // the database contains block info whereas the pending cache doesn't.
    const transaction = await transactions.get(hashBuffer);

    if (transaction === null) {
      // if we can't find it in the list of pending transactions, check the db!
      const tx = transactions.transactionPool.find(hashBuffer);
      return tx ? tx.toJSON() : null;
    } else {
      return transaction.toJSON();
    }
  }

  /**
   * Returns the receipt of a transaction by transaction hash.
   *
   * Note: The receipt is not available for pending transactions.
   *
   * @param transactionHash Hash of a transaction.
   * @returns Returns the receipt of a transaction by transaction hash.
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: accounts[0], to: accounts[1], gas: "0x5b8d80" }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * const txReceipt = await provider.request({ method: "eth_getTransactionReceipt", params: [ txHash ] });
   * console.log(txReceipt);
   * ```
   */
  @assertArgLength(1)
  async eth_getTransactionReceipt(transactionHash: DATA) {
    const { transactions, transactionReceipts, blocks } = this.#blockchain;
    const dataHash = Data.from(transactionHash);
    const txHash = dataHash.toBuffer();

    const transactionPromise = transactions.get(txHash);
    const receiptPromise = transactionReceipts.get(txHash);
    const blockPromise = transactionPromise.then(t =>
      t ? blocks.get(t.blockNumber.toBuffer()) : null
    );
    const [transaction, receipt, block] = await Promise.all([
      transactionPromise,
      receiptPromise,
      blockPromise
    ]);
    if (transaction) {
      return receipt.toJSON(block, transaction);
    }

    // if we are performing non-legacy instamining, then check to see if the
    // transaction is pending so as to warn about the v7 breaking change
    const options = this.#options;
    if (
      options.miner.blockTime <= 0 &&
      options.miner.legacyInstamine !== true &&
      this.#blockchain.isStarted()
    ) {
      const tx = this.#blockchain.transactions.transactionPool.find(txHash);
      if (tx != null) {
        options.logging.logger.log(
          " > Ganache `eth_getTransactionReceipt` notice: the transaction with hash\n" +
            ` > \`${dataHash.toString()}\` has not\n` +
            " > yet been mined. See https://trfl.co/v7-instamine for additional information."
        );
      }
    }
    return null;
  }

  // TODO: fix transaction object formatting (for param)
  /**
   * Creates new message call transaction or a contract creation, if the data field contains code.
   * @param transaction - the transaction call object
   * @returns The transaction hash
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from: accounts[0], to: accounts[1], gas: "0x5b8d80" }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * console.log(txHash);
   * ```
   */
  @assertArgLength(1)
  async eth_sendTransaction(transaction: TypedRpcTransaction) {
    const blockchain = this.#blockchain;

    const tx = TransactionFactory.fromRpc(transaction, blockchain.common);
    if (tx.from == null) {
      throw new Error("from not found; is required");
    }
    const fromString = tx.from.toString();

    const wallet = this.#wallet;
    const isKnownAccount = wallet.knownAccounts.has(fromString);
    const isUnlockedAccount = wallet.unlockedAccounts.has(fromString);

    if (!isUnlockedAccount) {
      const msg = isKnownAccount
        ? "authentication needed: password or unlock"
        : "sender account not recognized";
      throw new Error(msg);
    }

    if (tx.gas.isNull()) {
      const defaultLimit = this.#options.miner.defaultTransactionGasLimit;
      if (defaultLimit === utils.RPCQUANTITY_EMPTY) {
        // if the default limit is `RPCQUANTITY_EMPTY` use a gas estimate
        tx.gas = await this.eth_estimateGas(transaction, Tag.LATEST);
      } else {
        tx.gas = defaultLimit;
      }
    }

    if (tx.gasPrice.isNull()) {
      tx.gasPrice = this.#options.miner.gasPrice;
    }

    if (isUnlockedAccount) {
      const secretKey = wallet.unlockedAccounts.get(fromString);
      return blockchain.queueTransaction(tx, secretKey);
    } else {
      return blockchain.queueTransaction(tx);
    }
  }
  /**
   * Signs a transaction that can be submitted to the network at a later time using `eth_sendRawTransaction`.
   *
   * Transaction call object:
   * * `from`: `DATA`, 20 bytes (optional) - The address the transaction is sent from.
   * * `to`: `DATA`, 20 bytes - The address the transaction is sent to.
   * * `gas`: `QUANTITY` (optional) - Integer of the maximum gas allowance for the transaction.
   * * `gasPrice`: `QUANTITY` (optional) - Integer of the price of gas in wei.
   * * `value`: `QUANTITY` (optional) - Integer of the value in wei.
   * * `data`: `DATA` (optional) - Hash of the method signature and the ABI encoded parameters.
   *
   * @param transaction - The transaction call object as seen in source.
   * @returns The raw, signed transaction.
   * @example
   * ```javascript
   * const [from, to] = await provider.request({ method: "eth_accounts", params: [] });
   * const signedTx = await provider.request({ method: "eth_signTransaction", params: [{ from, to }] });
   * console.log(signedTx)
   * ```
   */
  @assertArgLength(1)
  async eth_signTransaction(transaction: TypedRpcTransaction) {
    const blockchain = this.#blockchain;
    const tx = TransactionFactory.fromRpc(transaction, blockchain.common);

    if (tx.from == null) {
      throw new Error("from not found; is required");
    }
    const fromString = tx.from.toString();

    const wallet = this.#wallet;
    const isKnownAccount = wallet.knownAccounts.has(fromString);
    const isUnlockedAccount = wallet.unlockedAccounts.has(fromString);

    if (!isUnlockedAccount) {
      const msg = isKnownAccount
        ? "authentication needed: password or unlock"
        : "sender account not recognized";
      throw new Error(msg);
    }

    const secretKey = wallet.unlockedAccounts.get(fromString).toBuffer();
    tx.signAndHash(secretKey);
    return Data.from(tx.serialized).toString();
  }
  /**
   * Creates new message call transaction or a contract creation for signed transactions.
   * @param transaction DATA, the signed transaction data
   * @returns The transaction hash
   */
  @assertArgLength(1)
  async eth_sendRawTransaction(transaction: DATA) {
    const blockchain = this.#blockchain;
    const tx = TransactionFactory.fromString(transaction, blockchain.common);
    return blockchain.queueTransaction(tx);
  }

  /**
   * The sign method calculates an Ethereum specific signature with:
   * `sign(keccak256("\x19Ethereum Signed Message:\n" + message.length + message)))`.
   *
   * By adding a prefix to the message makes the calculated signature
   * recognizable as an Ethereum specific signature. This prevents misuse where a malicious DApp can sign arbitrary data
   *  (e.g. transaction) and use the signature to impersonate the victim.
   *
   * Note the address to sign with must be unlocked.
   *
   * @param account DATA, 20 bytes - address to sign with
   * @param data DATA, N bytes - message to sign
   * @returns Signature - a hex encoded 129 byte array
   * starting with `0x`. It encodes the `r`, `s`, and `v` parameters from
   * appendix F of the [yellow paper](https://ethereum.github.io/yellowpaper/paper.pdf)
   *  in big-endian format. Bytes 0...64 contain the `r` parameter, bytes
   * 64...128 the `s` parameter, and the last byte the `v` parameter. Note
   * that the `v` parameter includes the chain id as specified in [EIP-155](https://eips.ethereum.org/EIPS/eip-155).
   * @example
   * ```javascript
   * const [account] = await provider.request({ method: "eth_accounts", params: [] });
   * const msg = "0x307866666666666666666666";
   * const signature = await provider.request({ method: "eth_sign", params: [account, msg] });
   * console.log(signature);
   * ```
   */
  @assertArgLength(2)
  async eth_sign(address: DATA, message: DATA) {
    const account = Address.from(address).toString().toLowerCase();

    const privateKey = this.#wallet.unlockedAccounts.get(account);
    if (privateKey == null) {
      throw new Error("cannot sign data; no private key");
    }

    const chainId = this.#options.chain.chainId;
    const messageHash = hashPersonalMessage(Data.from(message).toBuffer());
    const { v, r, s } = ecsign(messageHash, privateKey.toBuffer(), chainId);
    return toRpcSig(v, r, s, chainId);
  }

  /**
   *
   * @param address DATA, 20 bytes - Address of the account that will sign the messages.
   * @param typedData Typed structured data to be signed.
   * @returns Signature. As in `eth_sign`, it is a hex encoded 129 byte array
   * starting with `0x`. It encodes the `r`, `s`, and `v` parameters from
   * appendix F of the [yellow paper](https://ethereum.github.io/yellowpaper/paper.pdf)
   *  in big-endian format. Bytes 0...64 contain the `r` parameter, bytes
   * 64...128 the `s` parameter, and the last byte the `v` parameter. Note
   * that the `v` parameter includes the chain id as specified in [EIP-155](https://eips.ethereum.org/EIPS/eip-155).
   * @EIP [712](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md)
   * @example
   * ```javascript
   * const [account] = await provider.request({ method: "eth_accounts", params: [] });
   * const typedData = {
   *  types: {
   *    EIP712Domain: [
   *      { name: 'name', type: 'string' },
   *      { name: 'version', type: 'string' },
   *      { name: 'chainId', type: 'uint256' },
   *      { name: 'verifyingContract', type: 'address' },
   *    ],
   *    Person: [
   *      { name: 'name', type: 'string' },
   *      { name: 'wallet', type: 'address' }
   *    ],
   *    Mail: [
   *      { name: 'from', type: 'Person' },
   *      { name: 'to', type: 'Person' },
   *      { name: 'contents', type: 'string' }
   *    ],
   *  },
   *  primaryType: 'Mail',
   *  domain: {
   *    name: 'Ether Mail',
   *    version: '1',
   *    chainId: 1,
   *    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
   *  },
   *  message: {
   *    from: {
   *      name: 'Cow',
   *      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
   *    },
   *    to: {
   *      name: 'Bob',
   *      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
   *    },
   *    contents: 'Hello, Bob!',
   *  },
   * };
   * const signature = await provider.request({ method: "eth_signTypedData", params: [account, typedData] });
   * console.log(signature);
   * ```
   */
  @assertArgLength(2)
  async eth_signTypedData(address: DATA, typedData: TypedData) {
    const account = Address.from(address).toString().toLowerCase();

    const privateKey = this.#wallet.unlockedAccounts.get(account);
    if (privateKey == null) {
      throw new Error("cannot sign data; no private key");
    }

    if (!typedData.types) {
      throw new Error("cannot sign data; types missing");
    }

    if (!typedData.types.EIP712Domain) {
      throw new Error("cannot sign data; EIP712Domain definition missing");
    }

    if (!typedData.domain) {
      throw new Error("cannot sign data; domain missing");
    }

    if (!typedData.primaryType) {
      throw new Error("cannot sign data; primaryType missing");
    }

    if (!typedData.message) {
      throw new Error("cannot sign data; message missing");
    }

    return signTypedData_v4(privateKey.toBuffer(), { data: typedData });
  }

  /**
   * Starts a subscription to a particular event. For every event that matches
   * the subscription a JSON-RPC notification with event details and
   * subscription ID will be sent to a client.
   *
   * @param {String} subscriptionName
   * @returns {QUANTITY} A subscription id.
   * @example
   * ```javascript
   * const subscriptionId = await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * console.log(subscriptionId);
   * ```
   */
  eth_subscribe(subscriptionName: SubscriptionName): PromiEvent<Quantity>;
  /**
   * Starts a subscription to a particular event. For every event that matches
   * the subscription a JSON-RPC notification with event details and
   * subscription ID will be sent to a client.
   *
   * @param subscriptionName
   * @param options Filter options:
   *  * `address`: either an address or an array of addresses. Only logs that
   *    are created from these addresses are returned
   *  * `topics`, only logs which match the specified topics
   * @returns A subscription id.
   */
  eth_subscribe(
    subscriptionName: "logs",
    options: BaseFilterArgs
  ): PromiEvent<Quantity>;
  @assertArgLength(1, 2)
  eth_subscribe(subscriptionName: SubscriptionName, options?: BaseFilterArgs) {
    const subscriptions = this.#subscriptions;
    switch (subscriptionName) {
      case "newHeads": {
        const subscription = this.#getId();
        const promiEvent = PromiEvent.resolve(subscription);

        const unsubscribe = this.#blockchain.on("block", (block: Block) => {
          const value = block;
          const header = value.header;
          const result = {
            logsBloom: header.logsBloom,
            miner: header.miner,
            difficulty: header.difficulty,
            totalDifficulty: header.totalDifficulty,
            extraData: header.extraData,
            gasLimit: header.gasLimit,
            gasUsed: header.gasUsed,
            hash: block.hash(),
            mixHash: block.header.mixHash,
            nonce: header.nonce,
            number: header.number,
            parentHash: header.parentHash,
            receiptsRoot: header.receiptsRoot,
            stateRoot: header.stateRoot,
            timestamp: header.timestamp,
            transactionsRoot: header.transactionsRoot,
            sha3Uncles: header.sha3Uncles
          };

          // TODO: move the JSON stringification closer to where the message
          // is actually sent to the listener
          promiEvent.emit("message", {
            type: "eth_subscription",
            data: {
              result: JSON.parse(JSON.stringify(result)),
              subscription: subscription.toString()
            }
          });
        });
        subscriptions.set(subscription.toString(), unsubscribe);
        return promiEvent;
      }
      case "logs": {
        const subscription = this.#getId();
        const promiEvent = PromiEvent.resolve(subscription);

        const { addresses, topics } = options
          ? parseFilterDetails(options)
          : { addresses: [], topics: [] };
        const unsubscribe = this.#blockchain.on(
          "blockLogs",
          (blockLogs: BlockLogs) => {
            // TODO: move the JSON stringification closer to where the message
            // is actually sent to the listener
            const result = JSON.parse(
              JSON.stringify([...blockLogs.filter(addresses, topics)])
            );
            promiEvent.emit("message", {
              type: "eth_subscription",
              data: {
                result,
                subscription: subscription.toString()
              }
            });
          }
        );
        subscriptions.set(subscription.toString(), unsubscribe);
        return promiEvent;
      }
      case "newPendingTransactions": {
        const subscription = this.#getId();
        const promiEvent = PromiEvent.resolve(subscription);

        const unsubscribe = this.#blockchain.on(
          "pendingTransaction",
          (transaction: RuntimeTransaction) => {
            const result = transaction.hash.toString();
            promiEvent.emit("message", {
              type: "eth_subscription",
              data: {
                result,
                subscription: subscription.toString()
              }
            });
          }
        );
        subscriptions.set(subscription.toString(), unsubscribe);
        return promiEvent;
      }
      case "syncing": {
        // ganache doesn't sync, so doing nothing is perfectly valid.
        const subscription = this.#getId();
        const promiEvent = PromiEvent.resolve(subscription);

        this.#subscriptions.set(subscription.toString(), () => {});
        return promiEvent;
      }
      default:
        throw new CodedError(
          `no \"${subscriptionName}\" subscription in eth namespace`,
          JsonRpcTypes.ErrorCode.METHOD_NOT_FOUND
        );
    }
  }

  /**
   * Cancel a subscription to a particular event. Returns a boolean indicating
   * if the subscription was successfully cancelled.
   *
   * @param {String} subscriptionName
   * @returns {QUANTITY} A subscription id.
   * @example
   * ```javascript
   * const result = await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * console.log(result);
   * ```
   */
  @assertArgLength(1)
  async eth_unsubscribe(subscriptionId: SubscriptionId) {
    const subscriptions = this.#subscriptions;
    const unsubscribe = subscriptions.get(subscriptionId);
    if (unsubscribe) {
      subscriptions.delete(subscriptionId);
      unsubscribe();
      return true;
    } else {
      return false;
    }
  }

  /**
   * Creates a filter in the node, to notify when a new block arrives. To check
   * if the state has changed, call `eth_getFilterChanges`.
   *
   * @returns A filter id.
   * @example
   * ```javascript
   * const filterId = await provider.request({ method: "eth_newBlockFilter", params: [] });
   * console.log(filterId);
   * ```
   */
  @assertArgLength(0)
  async eth_newBlockFilter() {
    const unsubscribe = this.#blockchain.on("block", (block: Block) => {
      value.updates.push(block.hash());
    });
    const value = {
      updates: [],
      unsubscribe,
      filter: null,
      type: FilterTypes.block
    };
    const filterId = this.#getId();
    this.#filters.set(filterId.toString(), value);
    return filterId;
  }

  /**
   * Creates a filter in the node, to notify when new pending transactions
   * arrive. To check if the state has changed, call `eth_getFilterChanges`.
   *
   * @returns A filter id.
   * @example
   * ```javascript
   * const filterId = await provider.request({ method: "eth_newPendingTransactionFilter", params: [] });
   * console.log(filterId);
   * ```
   */
  @assertArgLength(0)
  async eth_newPendingTransactionFilter() {
    const unsubscribe = this.#blockchain.on(
      "pendingTransaction",
      (transaction: RuntimeTransaction) => {
        value.updates.push(transaction.hash);
      }
    );
    const value = {
      updates: [],
      unsubscribe,
      filter: null,
      type: FilterTypes.pendingTransaction
    };
    const filterId = this.#getId();
    this.#filters.set(filterId.toString(), value);
    return filterId;
  }

  /**
   * Creates a filter object, based on filter options, to notify when the state
   * changes (logs). To check if the state has changed, call
   * `eth_getFilterChanges`.
   *
   * If the from `fromBlock` or `toBlock` option are equal to "latest" the
   * filter continually append logs for whatever block is seen as latest at the
   * time the block was mined, not just for the block that was "latest" when the
   * filter was created.
   *
   * ### A note on specifying topic filters:
   * Topics are order-dependent. A transaction with a log with topics [A, B]
   * will be matched by the following topic filters:
   *  * `[]` “anything”
   *  * `[A]` “A in first position (and anything after)”
   *  * `[null, B]` “anything in first position AND B in second position (and
   * anything after)”
   *  * `[A, B]` “A in first position AND B in second position (and anything
   * after)”
   *  * `[[A, B], [A, B]]` “(A OR B) in first position AND (A OR B) in second
   * position (and anything after)”
   *
   * @param filter The filter options
   * @returns A filter id.
   * @example
   * ```javascript
   * const filterId = await provider.request({ method: "eth_newFilter", params: [] });
   * console.log(filterId);
   * ```
   */
  @assertArgLength(0, 1)
  async eth_newFilter(filter: RangeFilterArgs = {}) {
    const blockchain = this.#blockchain;
    const { addresses, topics } = parseFilterDetails(filter);
    const unsubscribe = blockchain.on("blockLogs", (blockLogs: BlockLogs) => {
      const blockNumber = blockLogs.blockNumber;
      // every time we get a blockLogs message we re-check what the filter's
      // range is. We do this because "latest" isn't the latest block at the
      // time the filter was set up, rather it is the actual latest *mined*
      // block (that is: not pending)
      const { fromBlock, toBlock } = parseFilterRange(filter, blockchain);
      if (fromBlock <= blockNumber && toBlock >= blockNumber) {
        value.updates.push(...blockLogs.filter(addresses, topics));
      }
    });
    const value = { updates: [], unsubscribe, filter, type: FilterTypes.log };
    const filterId = this.#getId();
    this.#filters.set(filterId.toString(), value);
    return filterId;
  }

  // TODO: create an example that actually returns changes
  /**
   * Polling method for a filter, which returns an array of logs, block hashes,
   * or transaction hashes, depending on the filter type, which occurred since
   * last poll.
   *
   * @param filterId The filter id.
   * @returns An array of logs, block hashes, or transaction hashes, depending
   * on the filter type, which occurred since last poll.
   * @example
   * ```javascript
   * const filterId = await provider.request({ method: "eth_newFilter", params: [] });
   * const changes = await provider.request({ method: "eth_getFilterChanges", params: [filterId] });
   * console.log(changes);
   * ```
   */
  @assertArgLength(1)
  async eth_getFilterChanges(filterId: QUANTITY) {
    const filter = this.#filters.get(Quantity.from(filterId).toString());
    if (filter) {
      const updates = filter.updates;
      filter.updates = [];
      return updates;
    } else {
      throw new Error("filter not found");
    }
  }

  /**
   * Uninstalls a filter with given id. Should always be called when watch is
   * no longer needed.
   *
   * @param filterId The filter id.
   * @returns `true` if the filter was successfully uninstalled, otherwise
   * `false`.
   * @example
   * ```javascript
   * const filterId = await provider.request({ method: "eth_newFilter", params: [] });
   * const result = await provider.request({ method: "eth_uninstallFilter", params: [filterId] });
   * console.log(result);
   * ```
   */
  @assertArgLength(1)
  async eth_uninstallFilter(filterId: QUANTITY) {
    const id = Quantity.from(filterId).toString();
    const filter = this.#filters.get(id);
    if (!filter) return false;
    filter.unsubscribe();
    return this.#filters.delete(id);
  }

  // TODO: create an example that actually returns logs
  /**
   * Returns an array of all logs matching filter with given id.
   *
   * @param filterId the filter id.
   * @returns Array of log objects, or an empty array.
   * @example
   * ```javascript
   * const filterId = await provider.request({ method: "eth_newFilter", params: [] });
   * const logs = await provider.request({ method: "eth_getFilterLogs", params: [filterId] });
   * console.log(logs);
   * ```
   */
  @assertArgLength(1)
  async eth_getFilterLogs(filterId: QUANTITY) {
    const filter = this.#filters.get(Quantity.from(filterId).toString());
    if (filter && filter.type === FilterTypes.log) {
      return this.eth_getLogs(filter.filter);
    } else {
      throw new Error("filter not found");
    }
  }

  /**
   * Returns an array of all logs matching a given filter object.
   *
   * Filter options:
   * * `fromBlock`: `QUANTITY | TAG` (optional) - Integer block number, or the string "latest", "earliest"
   * or "pending".
   * * `toBlock`: `QUANTITY | TAG` (optional) - Integer block number, or the string "latest", "earliest"
   * or "pending".
   * * `address`: `DATA | Array` (optional) - Contract address or a list of addresses from which the logs should originate.
   * * `topics`: `Array of DATA` (optional) - Array of 32 Bytes `DATA` topcis. Topics are order-dependent. Each topic can also
   * be an array of `DATA` with "or" options.
   * * `blockHash`: `DATA`, 32 Bytes (optional) - Hash of the block to restrict logs from. If `blockHash` is present,
   * then neither `fromBlock` or `toBlock` are allowed.
   *
   * @param filter The filter options as seen in source.
   * @returns Array of log objects, or an empty array.
   * @example
   * ```javascript
   * const logs = await provider.request({ method: "eth_getLogs", params: [{}] });
   * console.log(logs);
   * ```
   */
  @assertArgLength(1)
  async eth_getLogs(filter: FilterArgs) {
    return this.#blockchain.blockLogs.getLogs(filter);
  }

  /**
   * Returns the number of transactions sent from an address.
   *
   * @param address DATA, 20 bytes - the address to get number of transactions sent from
   * @param blockNumber integer block number, or the string "latest", "earliest"
   * or "pending", see the default block parameter
   * @returns integer of the number of transactions sent from this address.
   * @example
   * ```javascript
   * const accounts = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * await provider.request({ method: "eth_sendTransaction", params: [{ from: accounts[0], to: accounts[1], gas: "0x5b8d80" }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * const txCount = await provider.request({ method: "eth_getTransactionCount", params: [ accounts[0], "latest" ] });
   * console.log(txCount);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_getTransactionCount(
    address: DATA,
    blockNumber: QUANTITY | Tag = Tag.LATEST
  ) {
    return this.#blockchain.accounts.getNonce(
      Address.from(address),
      blockNumber
    );
  }

  // TODO: fix transaction object formatting
  /**
   * Executes a new message call immediately without creating a transaction on the block chain.
   *
   * @param transaction - the transaction call object
   *  (from - DATA, 20 bytes (optional) - the address the transaction is sent from
   *  to - DATA, 20 bytes - the address the transaction is sent to
   *  gas - QUANTITY (optional) - integer of the maximum gas allowance for the transaction
   *  gasPrice - QUANTITY (optional) - integer of the price of gas in wei
   *  value - QUANTITY (optional) - integer of the value in wei
   *  data - DATA (optional) - hash of the method signature and the ABI encoded parameters)
   *  @param blockNumber integer block number, or the string "latest", "earliest"
   *  or "pending", see the default block parameter
   *
   * @param transaction - The transaction call object as seen in source.
   * @param blockNumber Integer block number, or the string "latest", "earliest"
   *  or "pending".
   *
   * @returns The return value of executed contract.
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * const txObj = { from, gas: "0x5b8d80", gasPrice: "0x1dfd14000", value:"0x0", data: simpleSol };
   * const result = await provider.request({ method: "eth_call", params: [txObj, "latest"]});
   * console.log(result);
   * ```
   */
  @assertArgLength(1, 2)
  async eth_call(transaction: any, blockNumber: QUANTITY | Tag = Tag.LATEST) {
    const blockchain = this.#blockchain;
    const blocks = blockchain.blocks;
    const parentBlock = await blocks.get(blockNumber);
    const parentHeader = parentBlock.header;
    const options = this.#options;

    let gas: Quantity;
    if (typeof transaction.gasLimit === "undefined") {
      if (typeof transaction.gas !== "undefined") {
        gas = Quantity.from(transaction.gas);
      } else {
        // eth_call isn't subject to regular transaction gas limits by default
        gas = options.miner.callGasLimit;
      }
    } else {
      gas = Quantity.from(transaction.gasLimit);
    }

    let data: Data;
    if (typeof transaction.data === "undefined") {
      if (typeof transaction.input !== "undefined") {
        data = Data.from(transaction.input);
      }
    } else {
      data = Data.from(transaction.data);
    }

    const block = new RuntimeBlock(
      parentHeader.number,
      parentHeader.parentHash,
      blockchain.coinbase,
      gas.toBuffer(),
      parentHeader.gasUsed.toBuffer(),
      parentHeader.timestamp,
      options.miner.difficulty,
      parentHeader.totalDifficulty
    );

    const simulatedTransaction = {
      gas,
      // if we don't have a from address, our caller sut be the configured coinbase address
      from:
        transaction.from == null
          ? blockchain.coinbase
          : Address.from(transaction.from),
      to: transaction.to == null ? null : Address.from(transaction.to),
      gasPrice: Quantity.from(
        transaction.gasPrice == null ? 0 : transaction.gasPrice
      ),
      value:
        transaction.value == null ? null : Quantity.from(transaction.value),
      data,
      block
    };

    return blockchain.simulateTransaction(simulatedTransaction, parentBlock);
  }
  //#endregion

  //#region debug

  /**
   * Attempt to run the transaction in the exact same manner as it was executed
   * on the network. It will replay any transaction that may have been executed
   * prior to this one before it will finally attempt to execute the transaction
   * that corresponds to the given hash.
   *
   * In addition to the hash of the transaction you may give it a secondary
   * optional argument, which specifies the options for this specific call.
   * The possible options are:
   *
   * * `disableStorage`: {boolean} Setting this to `true` will disable storage capture (default = `false`).
   * * `disableMemory`: {boolean} Setting this to `true` will disable memory capture (default = `false`).
   * * `disableStack`: {boolean} Setting this to `true` will disable stack capture (default = `false`).
   *
   * @param transactionHash Hash of the transaction to trace.
   * @param options - See options in source.
   * @returns Returns the `gas`, `structLogs`, and `returnValue` for the traced transaction.
   *
   * The `structLogs` are an array of logs, which contains the following fields:
   * * `depth`: The execution depth.
   * * `error`: Information about an error, if one occurred.
   * * `gas`: The number of gas remaining.
   * * `gasCost`: The cost of gas in wei.
   * * `memory`: An array containing the contract's memory data.
   * * `op`: The current opcode.
   * * `pc`: The current program counter.
   * * `stack`: The EVM execution stack.
   * * `storage`: An object containing the contract's storage data.
   *
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, gas: "0x5b8d80", data: simpleSol }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   * const transactionTrace = await provider.request({ method: "debug_traceTransaction", params: [txHash] });
   * console.log(transactionTrace);
   * ```
   */
  async debug_traceTransaction(
    transactionHash: DATA,
    options?: TransactionTraceOptions
  ): Promise<TraceTransactionResult> {
    return this.#blockchain.traceTransaction(transactionHash, options || {});
  }

  // TODO: fix example it's not returning anything for storageRangeAt
  /**
   * Attempts to replay the transaction as it was executed on the network and
   * return storage data given a starting key and max number of entries to return.
   *
   * @param blockHash Hash of a block.
   * @param txIndex Integer of the transaction index position.
   * @param contractAddress Address of the contract.
   * @param startKey Hash of the start key for grabbing storage entries.
   * @param maxResult Integer of maximum number of storage entries to return.
   * @returns Returns a storage object with the keys being keccak-256 hashes of the storage keys,
   * and the values being the raw, unhashed key and value for that specific storage slot. Also
   * returns a next key which is the keccak-256 hash of the next key in storage for continuous downloading.
   * @example
   * ```javascript
   * // Simple.sol
   * // // SPDX-License-Identifier: MIT
   * //  pragma solidity ^0.7.4;
   * //
   * //  contract Simple {
   * //      uint256 public value;
   * //      constructor() payable {
   * //          value = 5;
   * //      }
   * //  }
   * const simpleSol = "0x6080604052600560008190555060858060196000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c80633fa4f24514602d575b600080fd5b60336049565b6040518082815260200191505060405180910390f35b6000548156fea26469706673582212200897f7766689bf7a145227297912838b19bcad29039258a293be78e3bf58e20264736f6c63430007040033";
   * const [from] = await provider.request({ method: "eth_accounts", params: [] });
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const initialTxHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, gas: "0x5b8d80", data: simpleSol }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * const {contractAddress} = await provider.request({ method: "eth_getTransactionReceipt", params: [initialTxHash] });
   *
   * // set value to 19
   * const data = "0x552410770000000000000000000000000000000000000000000000000000000000000019";
   * const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, to: contractAddress, data }] });
   * await provider.once("message"); // Note: `await provider.once` is non-standard
   *
   * const { blockHash, transactionIndex } = await provider.request({ method: "eth_getTransactionReceipt", params: [txHash] });
   * const storage = await provider.request({ method: "debug_storageRangeAt", params: [blockHash, transactionIndex, contractAddress, "0x01", 1] });
   * console.log(storage);
   * ```
   */
  async debug_storageRangeAt(
    blockHash: DATA,
    transactionIndex: QUANTITY,
    contractAddress: DATA,
    keyStart: DATA,
    maxResult: QUANTITY
  ): Promise<StorageRangeResult> {
    return this.#blockchain.storageRangeAt(
      blockHash,
      Quantity.from(transactionIndex).toNumber(),
      contractAddress,
      keyStart,
      Quantity.from(maxResult).toNumber()
    );
  }

  //#endregion

  //#region personal
  /**
   * Returns all the Ethereum account addresses of all keys that have been
   * added.
   * @returns the Ethereum account addresses of all keys that have been added.
   * @example
   * ```javascript
   * console.log(await provider.send("personal_listAccounts"));
   * ```
   */
  @assertArgLength(0)
  async personal_listAccounts() {
    return this.#wallet.addresses;
  }

  // TODO: example is not returning acct address
  /**
   * Generates a new account with private key. Returns the address of the new
   * account.
   * @param {String} passphrase - The passphrase to encrypt the private key with.
   * @returns The new account's address.
   * @example
   * ```javascript
   * const passphrase = "passphrase"
   * const address = await provider.send("personal_newAccount", [passphrase])
   * console.log(address);
   * ```
   */
  @assertArgLength(1)
  async personal_newAccount(passphrase: string) {
    if (typeof passphrase !== "string") {
      throw new Error("missing value for required argument `passphrase`");
    }

    const wallet = this.#wallet;
    const newAccount = wallet.createRandomAccount();
    const address = newAccount.address;
    const strAddress = address.toString();
    const encryptedKeyFile = await wallet.encrypt(
      newAccount.privateKey,
      passphrase
    );
    wallet.encryptedKeyFiles.set(strAddress, encryptedKeyFile);
    wallet.addresses.push(strAddress);
    wallet.knownAccounts.add(strAddress);
    return newAccount.address;
  }

  /**
   * Imports the given unencrypted private key (hex string) into the key store, encrypting it with the passphrase.
   *
   * @param {String} rawKey - The raw, unencrypted private key to import.
   * @param {String} passphrase - The passphrase to encrypt with.
   * @returns Returns the address of the new account.
   * @example
   * ```javascript
   * const rawKey = "0x0123456789012345678901234567890123456789012345678901234567890123";
   * const passphrase = "passphrase";
   *
   * const address = await provider.send("personal_importRawKey",[rawKey, passphrase]);
   * console.log(address);
   * ```
   */
  @assertArgLength(2)
  async personal_importRawKey(rawKey: DATA, passphrase: string) {
    if (typeof passphrase !== "string") {
      throw new Error("missing value for required argument `passphrase`");
    }

    const wallet = this.#wallet;
    const newAccount = Wallet.createAccountFromPrivateKey(Data.from(rawKey));
    const address = newAccount.address;
    const strAddress = address.toString();
    const encryptedKeyFile = await wallet.encrypt(
      newAccount.privateKey,
      passphrase
    );
    wallet.encryptedKeyFiles.set(strAddress, encryptedKeyFile);
    wallet.addresses.push(strAddress);
    wallet.knownAccounts.add(strAddress);
    return newAccount.address;
  }

  /**
   * Locks the account. The account can no longer be used to send transactions.
   * @param {String} address - The account address to be locked.
   * @returns Returns true if the account was locked, otherwise false.
   * @example
   * ```javascript
   * const [account] = await provider.send("personal_listAccounts");
   * const isLocked = await provider.send("personal_lockAccount", [account]);
   * console.log(isLocked);
   * ```
   */
  @assertArgLength(1)
  async personal_lockAccount(address: DATA) {
    return this.#wallet.lockAccount(address.toLowerCase());
  }

  // TODO: personal_newAccount in example is not working

  /**
   * Unlocks the account for use.
   *
   * The unencrypted key will be held in memory until the unlock duration
   * expires. The unlock duration defaults to 300 seconds. An explicit duration
   * of zero seconds unlocks the key until geth exits.
   *
   * The account can be used with `eth_sign` and `eth_sendTransaction` while it is
   * unlocked.
   * @param address The address of the account to unlock.
   * @param passphrase Passphrase to unlock the account.
   * @param duration (Default: 300) Duration in seconds how long the account
   * should remain unlocked for. Set to 0 to disable automatic locking.
   * @returns True if it worked. Throws an error or returns false if it did not.
   * @example
   * ```javascript
   * // generate an account
   * const passphrase = "passphrase";
   * const newAccount = await provider.send("personal_newAccount", [passphrase]);
   * const isLocked = await provider.send("personal_unlockAccount", [newAccount, passphrase]);
   * console.log(isLocked);
   * ```
   */
  @assertArgLength(2, 3)
  async personal_unlockAccount(
    address: DATA,
    passphrase: string,
    duration: number = 300
  ) {
    return this.#wallet.unlockAccount(
      address.toLowerCase(),
      passphrase,
      duration
    );
  }

  // TODO: formatting for transaction call object and use of personal_newAccount doesn't work
  /**
   * Validate the given passphrase and submit transaction.
   *
   * The transaction is the same argument as for `eth_sendTransaction` and
   * contains the from address. If the passphrase can be used to decrypt the
   * private key belonging to `tx.from` the transaction is verified, signed and
   * send onto the network. The account is not unlocked globally in the node
   * and cannot be used in other RPC calls.
   *
   * @param txData - The transaction call object.
   * @param {String} passphrase - The passphrase to decrpyt the private key belonging to `tx.from`.
   * @returns The transaction hash or if unsuccessful an error.
   * @example
   * ```javascript
   * const passphrase = "passphrase";
   * const newAccount = await provider.send("personal_newAccount", [passphrase]);
   * const [to] = await provider.send("personal_listAccounts")
   *
   * // use account and passphrase to send the transaction
   * const txHash = await provider.send("personal_sendTransaction", [{ from: newAccount, to }, passphrase]);
   * console.log(txHash);
   * ```
   */
  @assertArgLength(2)
  async personal_sendTransaction(transaction: any, passphrase: string) {
    const blockchain = this.#blockchain;
    const tx = TransactionFactory.fromRpc(transaction, blockchain.common);
    const from = tx.from;
    if (from == null) {
      throw new Error("from not found; is required");
    }

    const fromString = tx.from.toString();

    const wallet = this.#wallet;
    const encryptedKeyFile = wallet.encryptedKeyFiles.get(fromString);
    if (encryptedKeyFile === undefined) {
      throw new Error("no key for given address or file");
    }

    if (encryptedKeyFile !== null) {
      const secretKey = await wallet.decrypt(encryptedKeyFile, passphrase);
      tx.signAndHash(secretKey);
    }

    return blockchain.queueTransaction(tx);
  }
  /**
   * Validates the given passphrase and signs a transaction that can be
   * submitted to the network at a later time using `eth_sendRawTransaction`.
   *
   * The transaction is the same argument as for `eth_signTransaction` and
   * contains the from address. If the passphrase can be used to decrypt the
   * private key belogging to `tx.from` the transaction is verified and signed.
   * The account is not unlocked globally in the node and cannot be used in other RPC calls.
   *
   * Transaction call object:
   * * `from`: `DATA`, 20 bytes (optional) - The address the transaction is sent from.
   * * `to`: `DATA`, 20 bytes - The address the transaction is sent to.
   * * `gas`: `QUANTITY` (optional) - Integer of the maximum gas allowance for the transaction.
   * * `gasPrice`: `QUANTITY` (optional) - Integer of the price of gas in wei.
   * * `value`: `QUANTITY` (optional) - Integer of the value in wei.
   * * `data`: `DATA` (optional) - Hash of the method signature and the ABI encoded parameters.
   *
   * @param transaction - The transaction call object as seen in source.
   * @returns The raw, signed transaction.
   * @example
   * ```javascript
   * const [to] = await provider.request({ method: "eth_accounts", params: [] });
   * const passphrase = "passphrase";
   * const from = await provider.send("personal_newAccount", [passphrase] );
   * await provider.request({ method: "eth_subscribe", params: ["newHeads"] });
   * const signedTx = await provider.request({ method: "personal_signTransaction", params: [{ from, to }, passphrase] });
   * console.log(signedTx)
   * ```
   */
  @assertArgLength(2)
  async personal_signTransaction(
    transaction: TypedRpcTransaction,
    passphrase: string
  ) {
    const blockchain = this.#blockchain;
    const tx = TransactionFactory.fromRpc(transaction, blockchain.common);

    if (tx.from == null) {
      throw new Error("from not found; is required");
    }
    const fromString = tx.from.toString();

    const wallet = this.#wallet;
    const encryptedKeyFile = wallet.encryptedKeyFiles.get(fromString);
    if (encryptedKeyFile === undefined || encryptedKeyFile === null) {
      throw new Error("no key for given address or file");
    }

    const secretKey = await wallet.decrypt(encryptedKeyFile, passphrase);
    tx.signAndHash(secretKey);
    return Data.from(tx.serialized).toString();
  }
  //#endregion

  //#region rpc
  /**
   * Returns oject of RPC modules
   * @example
   * ```javascript
   * console.log(await provider.send("rpc_modules"))
   * ```
   */
  @assertArgLength(0)
  async rpc_modules() {
    return RPC_MODULES;
  }
  //endregion

  //#region shh

  /**
   * Creates new whisper identity in the client.
   *
   * @returns {DATA, 60 Bytes} The address of the new identiy.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_newIdentity"));
   * ```
   */
  @assertArgLength(0)
  async shh_newIdentity() {
    return "0x00";
  }

  /**
   * Checks if the client hold the private keys for a given identity.
   *
   * @param address - The identity address to check.
   * @returns Returns `true` if the client holds the private key for that identity, otherwise `false`.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_hasIdentity", ["0x0"] ));
   * ```
   */
  @assertArgLength(1)
  async shh_hasIdentity(address: DATA) {
    return false;
  }

  /**
   * Creates a new group.
   *
   * @returns The address of the new group.
   */
  @assertArgLength(0)
  async shh_newGroup() {
    return "0x00";
  }

  /**
   * Adds a whisper identity to the group.
   *
   * @param {DATA, 60 Bytes} - The identity address to add to a group.
   * @returns True if the identity was successfully added to the group, otherwise false.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_addToGroup", ["0x0"]));
   * ```
   */
  @assertArgLength(1)
  async shh_addToGroup(address: DATA) {
    return false;
  }

  /**
   * Creates filter to notify, when client receives whisper message matching the filter options.
   *
   * @param to (optional) Identity of the receiver. When present it will try to decrypt any incoming message
   *  if the client holds the private key to this identity.
   * @param {Array of DATA} topics - Array of DATA topics which the incoming message's topics should match.
   * @returns Returns true if the identity was successfully added to the group, otherwise false.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_newFilter", ["0x0", []]));
   * ```
   */
  @assertArgLength(2)
  async shh_newFilter(to: DATA, topics: DATA[]) {
    return false;
  }

  /**
   * Uninstalls a filter with given id. Should always be called when watch is no longer needed.
   * Additonally filters timeout when they aren't requested with `shh_getFilterChanges` for a period of time.
   *
   * @param {QUANTITY} id - The filter id. Ex: "0x7"
   * @returns True if the filter was successfully uninstalled, otherwise false.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_uninstallFilter", ["0x0"]));
   * ```
   */
  @assertArgLength(1)
  async shh_uninstallFilter(id: QUANTITY) {
    return false;
  }

  /**
   * Polling method for whisper filters. Returns new messages since the last call of this method.
   *
   * @param id - The filter id. Ex: "0x7"
   * @returns More Info: https://github.com/ethereum/wiki/wiki/JSON-RPC#shh_getfilterchanges
   * @example
   * ```javascript
   * console.log(await provider.send("shh_getFilterChanges", ["0x0"]));
   * ```
   */
  @assertArgLength(1)
  async shh_getFilterChanges(id: QUANTITY) {
    return [];
  }

  /**
   * Get all messages matching a filter. Unlike shh_getFilterChanges this returns all messages.
   *
   * @param id The filter id. Ex: "0x7"
   * @returns See: `shh_getFilterChanges`.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_getMessages", ["0x0"] ));
   * ```
   */
  @assertArgLength(1)
  async shh_getMessages(id: QUANTITY) {
    return false;
  }

  /**
   * Creates a whisper message and injects it into the network for distribution.
   *
   * @param postData
   * @returns Returns `true` if the message was sent, otherwise `false`.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_post", [{}] ));
   * ```
   */
  @assertArgLength(1)
  async shh_post(postData: WhisperPostObject) {
    return false;
  }

  /**
   * Returns the current whisper protocol version.
   *
   * @returns The current whisper protocol version.
   * @example
   * ```javascript
   * console.log(await provider.send("shh_version"));
   * ```
   */
  @assertArgLength(0)
  async shh_version() {
    return "2";
  }
  //#endregion
}
