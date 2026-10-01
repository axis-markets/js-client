import {canonicalPair} from './asset-pair.js'
import {parseApiDate} from './api-dates.js'

/**
 * DEX Market
 */
export class AxisMarket {
    /**
     * @param {Axis} axis
     * @param {{a: string, b: string, created?: string, refreshed?: string}} record - Market data
     */
    constructor(axis, record) {
        this.axis = axis
        const [a, b] = canonicalPair(record.a, record.b)
        this.a = a
        this.b = b
        this.key = a + '/' + b
        this.update(record)
    }

    /**
     * Base asset
     * @type {string}
     * @readonly
     */
    a
    /**
     * Quote asset
     * @type {string}
     * @readonly
     */
    b
    /**
     * Canonical market key `a/b`
     * @type {string}
     * @readonly
     */
    key
    /**
     * Creation timestamp (first oracle check) (UNIX milliseconds)
     * @type {number}
     */
    created = 0
    /**
     * Last oracle check (UNIX milliseconds)
     * @type {number}
     */
    refreshed = 0

    /**
     * Base asset
     * @return {string}
     */
    get base() {
        return this.a
    }

    /**
     * Quote asset
     * @return {string}
     */
    get quote() {
        return this.b
    }

    /**
     * Check whether the asset is one of the market assets
     * @param {string} asset
     * @return {boolean}
     */
    has(asset) {
        return asset === this.a || asset === this.b
    }

    /**
     * The other market asset
     * @param {string} asset - One of the market assets
     * @return {string}
     */
    counter(asset) {
        if (asset === this.a)
            return this.b
        if (asset === this.b)
            return this.a
        throw new Error(`Asset ${asset} does not belong to the market ${this.key}`)
    }

    /**
     * Apply the contract state change record
     * @param {{created?: string, refreshed?: string}} record
     * @internal
     */
    update(record) {
        if (record.created) {
            this.created = parseApiDate(record.created)
        }
        if (record.refreshed) {
            this.refreshed = parseApiDate(record.refreshed)
        }
    }

    /**
     * Re-check both market assets against the price oracle and cache oracle prices
     * @param {Signer} [signer] - Transaction source, the {@link Axis} signer by default
     * @return {Promise<Market|undefined>}
     */
    async requote(signer) {
        return this.axis.contractClient(signer).requote(this.a, this.b)
    }

    /**
     * Extend oracle price feeds access for the market
     * @param {{amount: bigint, sponsor?: string, signer?: Signer}} params - `amount` of fee tokens to burn
     * @return {Promise<bigint[]>} - New access expiration UNIX timestamps (in seconds) for each oracle-listed asset
     */
    async subsidize({amount, sponsor, signer}) {
        const client = this.axis.contractClient(signer)
        return client.subsidize({sponsor: sponsor ?? client.publicKey, selling: this.a, buying: this.b, amount})
    }

    /**
     * Orderbook depth data with given precision
     * @param {{base?: string, depth?: number, step?: string, limit?: number}} [params] - `base` is the base asset, `step` the price step (automatic by default)
     * @return {Promise<import('./api-client.js').OrderbookDepth>}
     */
    async getDepth({base = this.a, depth, step, limit} = {}) {
        return this.axis.api.getDepth({market: base + '/' + this.counter(base), depth, step, limit})
    }

    /**
     * Stream the orderbook depth
     * Returns a snapshot, then updates on book changes
     * @param {{base?: string, depth?: number, step?: string, limit?: number}} params
     * @param {function(OrderbookDepth): void} callback
     * @return {function(): void} - Unsubscribe function
     */
    subscribeDepth({base = this.a, depth, step, limit} = {}, callback) {
        const market = base + '/' + this.counter(base)
        return this.axis.stream.subscribe('depth', {market, depth, step, limit}, message => {
            if (message.type === 'depth') {
                callback(message.data)
            }
        })
    }

    /**
     * Stream the market trades
     * Returns a snapshot, then updates on trades
     * @param {function(ApiTrade[], boolean): void} callback - Trades and whether they are the snapshot
     * @return {function(): void} - Unsubscribe function
     */
    subscribeTrades(callback) {
        return this.axis.stream.subscribe('trades', {market: this.key}, message => {
            if (message.type === 'trades') {
                callback(message.trades, true)
            } else if (message.type === 'trade') {
                callback([message.trade], false)
            }
        })
    }

    /**
     * Stream the market candles
     * Returns a snapshot, then updates on trades
     * @param {{base?: string, resolution: number|string, limit?: number}} params - `base` is the base asset of the view, `resolution` in seconds or an alias (`5m`, `1h`, …), `limit` the candles in the snapshot (200 by default, at most 200)
     * @param {function(Candle[], boolean): void} callback - Candles
     * @return {function(): void} - Unsubscribe function
     */
    subscribeCandles({base = this.a, resolution, limit}, callback) {
        const market = base + '/' + this.counter(base)
        return this.axis.stream.subscribe('candles', {market, resolution, limit}, message => {
            if (message.type === 'candles') {
                callback(message.candles, true)
            } else if (message.type === 'candle') {
                callback([message.candle], false)
            }
        })
    }

    /**
     * Last 24h ticker entry of the market, available while {@link Axis#subscribeTicker} runs
     * @return {TickerEntry|undefined}
     */
    get ticker() {
        return this.axis.tickers.get(this.key)
    }

    toJSON() {
        return {a: this.a, b: this.b, key: this.key, created: this.created, refreshed: this.refreshed}
    }
}

/**
 * @typedef {{}} Signer - Account signing contract calls
 * @property {string} publicKey - Transaction source account
 * @property {SignTransactionCallback} signTransaction
 */
