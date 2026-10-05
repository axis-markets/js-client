import {Asset, Networks} from '@stellar/stellar-sdk'
import {Emitter} from './emitter.js'
import {AxisApiClient, AxisApiError} from './api-client.js'
import {AxisStreamClient} from './stream-client.js'
import {TokenBalance} from './token-balance.js'
import {AxisMarket} from './axis-market.js'
import {AxisAccount, parseApiOrder} from './axis-account.js'
import {pairKey} from './asset-pair.js'
import {parseApiDate} from './api-dates.js'
import {AxisContractClient} from './index.js'

/** Max stale ledger threshold, in ms */
const LEDGER_STALE_THRESHOLD = 60_000

/**
 * High-level AXIS DEX state
 *
 * Emits:
 * - `change` - anything in the contract state changed
 * - `frozen` `boolean` - the frozen state toggled
 * - `config` {ContractInfoConfig} - contract configuration changed
 * - `market` `{market: AxisMarket, created: boolean}` - a market was opened or updated
 * - `connection` `boolean` - WebSocket push connection opened or dropped
 * - `ledger` `number` - new ledger processed by the indexer
 */
export class Axis extends Emitter {
    /**
     * @param {AxisOptions} options
     */
    constructor({apiUrl, wsUrl, rpcUrl, contractId, networkPassphrase = Networks.PUBLIC, fee, signer, WebSocket, fallbackPollInterval = 15_000}) {
        super()
        this.api = new AxisApiClient(apiUrl)
        this.stream = new AxisStreamClient(wsUrl || toWsUrl(this.api.serverUrl), {WebSocket})
        this.rpcUrl = rpcUrl
        this.contractId = contractId
        this.networkPassphrase = networkPassphrase
        this.fee = fee
        this.signer = signer
        this.fallbackPollInterval = fallbackPollInterval
        this.tokenBalances = rpcUrl ? new TokenBalance({rpcUrl, networkPassphrase, spender: contractId}) : undefined
        this.nativeAsset = Asset.native().contractId(networkPassphrase)
        this.stream.on('open', () => {
            this.stopFallback()
            this.emit('connection', true)
        })
        this.stream.on('close', () => {
            this.startFallback()
            this.emit('connection', false)
        })
    }

    /**
     * AXIS REST API client
     * @type {AxisApiClient}
     * @readonly
     */
    api
    /**
     * AXIS contract address
     * @type {string|undefined}
     * @readonly
     */
    contractId
    /**
     * AXIS API WebSocket client
     * @type {AxisStreamClient}
     * @readonly
     */
    stream
    /**
     * Token balance wrappers
     * @type {TokenBalance}
     * @readonly
     */
    tokenBalances
    /**
     * Contract address of the native XLM token
     * @type {string}
     * @readonly
     */
    nativeAsset
    /**
     * Last known ledger
     * @type {number}
     */
    ledger = 0
    /**
     * Last updated UNIX milliseconds
     * @type {number}
     */
    ledgerTime = 0
    /**
     * Whether trading is suspended
     * @type {boolean}
     */
    frozen = false
    /**
     * Contract configuration
     * @type {ContractInfoConfig}
     */
    config
    /**
     * Available AXIS markets
     * @type {Map<string, AxisMarket>}
     * @readonly
     */
    markets = new Map()
    /**
     * 24h ticker entries
     * @type {Map<string, TickerEntry>}
     * @readonly
     */
    tickers = new Map() //TODO: move inside AxisMarket
    /**
     * Tracked accounts
     * @type {Map<string, AxisAccount>}
     * @private
     */
    accounts = new Map()
    /**
     * Contract clients by signer
     * @type {Map<string, {signTransaction: function, client: AxisContractClient}>}
     * @private
     */
    clients = new Map() //TODO: check if we can use a single AxisContractClient instance instead
    /**
     * @type {Promise<Axis>}
     * @private
     */
    connecting

    /**
     * Whether the contract state loaded
     * @return {boolean}
     */
    get loaded() {
        return !!this.loadedAt
    }

    /**
     * Load the contract state and track its changes
     * @return {Promise<Axis>}
     */
    connect() {
        if (!this.connecting) {
            this.connecting = new Promise((resolve, reject) => {
                //works with the push API, or the REST API if the push connection is not available
                let settled = false
                const done = () => {
                    if (!settled) {
                        settled = true
                        resolve(this)
                    }
                }
                const fail = e => {
                    if (!settled) {
                        settled = true
                        this.connecting = undefined
                        this.unsubscribeContract?.()
                        reject(e)
                    }
                }
                this.unsubscribeContract = this.stream.subscribe('contract', {}, message => {
                    if (message.ledger) {
                        this.applyLedger(message.ledger)
                    }
                    if (message.type === 'contract') {
                        try {
                            this.applyContractSnapshot(message.data)
                        } catch (e) {
                            return fail(e) //a snapshot of another contract is ignored after connecting
                        }
                        done()
                    }
                })
                //do not wait for a push connection that may never open
                this.api.getContract()
                    .then(data => {
                        if (!this.loaded) {
                            this.applyContractSnapshot(data)
                        }
                        done()
                    }, e => {
                        if (!settled && !this.stream.connected) {
                            this.startFallback()
                            fail(e)
                        }
                    })
                    .catch(fail)
            })
        }
        return this.connecting
    }

    /**
     * AXIS contract address
     * @return {Promise<string>}
     */
    async getContractId() {
        if (!this.contractId) {
            await this.connect()
        }
        return this.contractId
    }

    /**
     * Current ledger sequence
     * @return {Promise<number>}
     */
    async getLedger() {
        if (this.ledger && this.stream.connected && Date.now() - this.ledgerTime < LEDGER_STALE_THRESHOLD)
            return this.ledger
        if (this.tokenBalances)
            return this.tokenBalances.getLatestLedger()
        if (this.ledger)
            return this.ledger
        throw new Error('The current ledger is unknown: connect to the AXIS API or set the `rpcUrl` option')
    }

    /**
     * Get market of the asset pair
     * @param {string} asset1 - Token contract address
     * @param {string} asset2 - Token contract address
     * @return {AxisMarket|undefined}
     */
    getMarket(asset1, asset2) {
        return this.markets.get(pairKey(asset1, asset2)) //TODO: accept also stellar classic asset format CODE:ISSUER and convert it to contract address automatically
    }

    /**
     * Get live order by id
     * @param {bigint|string} id - Order id
     * @return {Promise<AccountOrder|undefined>} - Undefined if not found (filled, removed, expired)
     */
    async getOrder(id) {
        const key = id.toString()
        for (const account of this.accounts.values()) {
            const order = account.orders.get(key)
            if (order)
                return order
        }
        try {
            return parseApiOrder(await this.api.getOrder(key))
        } catch (e) {
            if (e instanceof AxisApiError && e.status === 404)
                return undefined
            throw e
        }
    }

    /**
     * Trader wrapper tracking the orders and allowances for an account (one instance per account address)
     * @param {string} address - Trader address
     * @param {{signTransaction: [SignTransactionCallback]}} [options] - Transaction signing callback
     * @return {AxisAccount}
     */
    account(address, {signTransaction} = {}) {
        let account = this.accounts.get(address)
        if (!account) {
            account = new AxisAccount(this, address, {signTransaction})
            this.accounts.set(address, account)
            account.start()
        } else if (signTransaction) {
            account.signTransaction = signTransaction
        }
        return account
    }

    /**
     * Stream the 24h ticker of every market
     * Sends a full snapshot, then updates caused by trades
     * @param {function(Ticker24hResult): void} [callback]
     * @return {function(): void} - Unsubscribe function
     */
    subscribeTicker(callback) {
        return this.stream.subscribe('ticker', {}, message => {
            if (message.type !== 'ticker')
                return
            for (const entry of message.data.ticker) {
                this.tickers.set(entry.symbol, entry)
            }
            callback?.(message.data)
        })
    }

    /**
     * Extend the contract instance and code lifetime with an `ExtendFootprintTTL` operation, restoring them first if archived
     * @param {{days?: number, signer?: Signer}} [params] - Lifetime in days (30 by default) and the transaction source
     * (the default signer by default)
     * @return {Promise<number>} - Ledger sequence both entries live until, at least
     */
    async keepalive({days, signer} = {}) {
        const client = await this.contractClient(signer)
        return client.keepalive(days)
    }

    /**
     * Stop following the contract state and tracked accounts
     */
    close() {
        this.stopFallback()
        this.unsubscribeContract?.()
        for (const account of [...this.accounts.values()]) {
            account.close()
        }
        this.stream.close()
        this.connecting = undefined
    }

    /**
     * Contract client signing with the given account
     * @param {Signer} [signer] - The default signer if omitted
     * @return {Promise<AxisContractClient>}
     * @internal
     */
    async contractClient(signer = this.signer) {
        if (!signer?.publicKey || !signer.signTransaction)
            throw new Error('A signer ({publicKey, signTransaction}) is required to submit transactions')
        if (!this.rpcUrl)
            throw new Error('The `rpcUrl` option is required to submit transactions')
        await this.getContractId()
        const cached = this.clients.get(signer.publicKey)
        if (cached && cached.signTransaction === signer.signTransaction)
            return cached.client
        const client = new AxisContractClient({
            publicKey: signer.publicKey,
            signTransaction: signer.signTransaction,
            rpcUrl: this.rpcUrl,
            contractId: this.contractId,
            networkPassphrase: this.networkPassphrase,
            fee: this.fee
        })
        this.clients.set(signer.publicKey, {signTransaction: signer.signTransaction, client})
        return client
    }

    /**
     * @param {AxisAccount} account
     * @internal
     */
    releaseAccount(account) {
        if (this.accounts.get(account.address) === account) {
            this.accounts.delete(account.address)
        }
    }

    /**
     * Apply a contract state snapshot
     * @param {ContractInfo} data
     * @private
     */
    applyContractSnapshot(data) {
        this.checkContractAddress(data.address)
        this.loadedAt = Date.now()
        const frozen = data.frozen === true
        if (frozen !== this.frozen) {
            this.frozen = frozen
            this.emit('frozen', frozen)
        }
        if (data.config && JSON.stringify(data.config) !== JSON.stringify(this.config)) {
            this.config = data.config
            this.emit('config', data.config)
        }
        for (const record of data.markets || []) {
            const key = pairKey(record.base, record.quote)
            const market = this.markets.get(key)
            if (!market) {
                const created = new AxisMarket(this, record)
                this.markets.set(key, created)
                this.emit('market', {market: created, created: true})
            } else if (record.refreshed && market.refreshed !== parseApiDate(record.refreshed)) {
                market.update(record)
                this.emit('market', {market, created: false})
            }
        }
        this.emit('change')
    }

    /**
     * Take the contract address reported by the AXIS API, or check it against the explicitly set
     * @param {string} [address]
     * @throws {Error} - If the API tracks another contract or the address is unknown
     * @private
     */
    checkContractAddress(address) {
        if (!address) {
            if (!this.contractId)
                throw new Error('The AXIS API does not report the contract address: set the `contractId` option')
            return
        }
        if (!this.contractId) {
            this.setContractId(address)
        } else if (address !== this.contractId)
            throw new Error(`The AXIS API tracks contract ${address}, not ${this.contractId}`)
    }

    /**
     * @param {string} contractId
     * @private
     */
    setContractId(contractId) {
        this.contractId = contractId
        if (this.tokenBalances) {
            this.tokenBalances.spender = contractId
        }
    }

    /**
     * @param {number} ledger
     * @private
     */
    applyLedger(ledger) {
        this.ledgerTime = Date.now()
        if (ledger > this.ledger) {
            this.ledger = ledger
            this.emit('ledger', ledger)
        }
    }

    /**
     * Poll the contract state over REST while the push connection is down
     * @private
     */
    startFallback() {
        if (this.fallbackTimer || !this.connecting)
            return
        this.fallbackTimer = setInterval(() => {
            this.api.getContract()
                .then(data => this.applyContractSnapshot(data))
                .catch(() => {
                    //retried on the next tick
                })
        }, this.fallbackPollInterval)
    }

    /**
     * @private
     */
    stopFallback() {
        clearInterval(this.fallbackTimer)
        this.fallbackTimer = undefined
    }
}

/**
 * Derive the push API endpoint from the REST API URL
 * @param {string} apiUrl
 * @return {string}
 */
export function toWsUrl(apiUrl) {
    return apiUrl.replace(/^http/i, 'ws').replace(/\/+$/, '') + '/ws'
}

/**
 * @typedef {{}} AxisOptions
 * @property {string} apiUrl - AXIS REST API URL
 * @property {string} [contractId] - AXIS contract address, by default pulled from the AXIS API
 * @property {string} [wsUrl] - AXIS API push channel URL (`<apiUrl>/ws` with the `ws(s)` scheme by default)
 * @property {string} [rpcUrl] - Stellar RPC URL
 * @property {string} [networkPassphrase] - Network passphrase (Pubnet by default)
 * @property {string} [fee] - Transaction fee
 * @property {Signer} [signer] - Default signer settings for contract operations
 * @property {number} [fallbackPollInterval] - REST polling period while the push connection is down, in milliseconds
 * @property {typeof WebSocket} [WebSocket] - WebSocket implementation
 */
