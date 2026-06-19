/**
 * Error thrown when the Aggregator API responds with a non-success HTTP status
 */
export class AxisApiError extends Error {
    /**
     * @param {string} message - Error message returned by the API
     * @param {number} status - HTTP status code
     */
    constructor(message, status) {
        super(message)
        this.name = 'AxisApiError'
        this.status = status
    }

    /**
     * HTTP status code associated with the error
     * @type {number}
     * @readonly
     */
    status
}

/**
 * HTTP client for the AXIS Aggregator REST API
 */
export class ApiClient {
    /**
     * @param {string} serverUrl - Base URL of the Aggregator server
     */
    constructor(serverUrl) {
        if (!serverUrl || typeof serverUrl !== 'string')
            throw new TypeError('Aggregator server URL is required')
        //trim trailing slashes to avoid double slashes when building request paths
        this.serverUrl = serverUrl.replace(/\/+$/, '')
    }

    /**
     * Base URL of the Aggregator server
     * @type {string}
     * @readonly
     */
    serverUrl

    /**
     * Price quote and candidate trade routes for selling a fixed amount of the source asset
     * @param {QuoteParams} params - Quote request parameters
     * @return {Promise<QuoteResult>} - Best routes ranked by profitability
     * @throws {AxisApiError} - If the server is not ready or there is not enough liquidity
     */
    async quoteSell(params) {
        return this.quote(params, 'strict_send')
    }

    /**
     * Price quote and candidate trade routes for buying a fixed amount of the destination asset
     * @param {QuoteParams} params - Quote request parameters
     * @return {Promise<QuoteResult>} - Best routes ranked by profitability
     * @throws {AxisApiError} - If the server is not ready or there is not enough liquidity
     */
    async quoteBuy(params) {
        return this.quote(params, 'strict_receive')
    }

    /**
     * Find viable multi-hop paths between two assets, simulate trades on each path, and return the best routes
     * @param {QuoteParams} params - Quote request parameters
     * @param {'strict_send'|'strict_receive'} direction - Trade direction
     * @return {Promise<QuoteResult>}
     * @private
     */
    async quote({sellingAsset, buyingAsset, amount, direct}, direction) {
        return this.request('/quote', {sellingAsset, buyingAsset, amount, direction, direct})
    }

    /**
     * Order book depth aggregated into price buckets around the mid price
     * @param {DepthParams} params - Depth request parameters
     * @return {Promise<OrderbookDepth>} - Aggregated bids and asks
     */
    async getDepth({market, depth}) {
        return this.request('/depth', {market, depth})
    }

    /**
     * OHLCVT candlestick data (open, high, low, close, base volume, quote volume, trade count)
     * @param {CandlesParams} params - Candles request parameters
     * @return {Promise<Candle[]>} - Time-bucketed candles, max 200 per response
     */
    async getCandles({market, from, to, resolution, order}) {
        return this.request('/candles', {market, from, to, resolution, order})
    }

    /**
     * 24-hour ticker statistics for every available market
     * @return {Promise<Ticker24hResult>} - Aggregated 24h stats per market
     */
    async getTicker24h() {
        return this.request('/ticker/24h')
    }

    /**
     * List all active markets with pagination
     * @param {MarketsParams} [params] - Pagination parameters
     * @return {Promise<MarketInfo[]>} - Active markets
     */
    async getMarkets({cursor, limit} = {}) {
        return this.request('/markets', {cursor, limit})
    }

    /**
     * Retrieve active orders, filterable by owner or asset
     * @param {OrdersParams} [params] - Filter parameters
     * @return {Promise<ApiOrder[]>} - Active orders matching the filter
     */
    async getOrders({owner, asset, cursor, limit} = {}) {
        return this.request('/order', {owner, asset, cursor, limit})
    }

    /**
     * Retrieve a single order by ID
     * @param {bigint|string|number} id - Order ID
     * @return {Promise<ApiOrder|null>} - Order, or null if not found
     */
    async getOrder(id) {
        return this.request(`/order/${encodeURIComponent(id.toString())}`)
    }

    /**
     * Retrieve archived/historical orders
     * @param {OrderHistoryParams} [params] - Filter parameters
     * @return {Promise<ApiOrder[]>} - Archived orders matching the filter
     */
    async getOrderHistory({owner, pair, cursor, limit} = {}) {
        return this.request('/order-history', {owner, pair, cursor, limit})
    }

    /**
     * Retrieve recent trades
     * @param {TradesParams} [params] - Filter parameters
     * @return {Promise<ApiTrade[]>} - Recent trades matching the filter
     */
    async getTrades({trader, pair, cursor, limit} = {}) {
        return this.request('/trades', {trader, pair, cursor, limit})
    }

    /**
     * Execute a GET request against the Aggregator API
     * @param {string} path - Relative route path
     * @param {object} [query] - Query parameters (undefined/null values skipped, arrays expanded to repeated params)
     * @return {Promise<*>} - Parsed JSON response
     * @throws {AxisApiError} - If the API responds with a non-success status
     * @private
     */
    async request(path, query) {
        let url = this.serverUrl + path
        if (query) {
            const search = new URLSearchParams()
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined || value === null)
                    continue
                if (Array.isArray(value)) {
                    for (const item of value)
                        search.append(key, item)
                } else {
                    search.append(key, value)
                }
            }
            const qs = search.toString()
            if (qs)
                url += '?' + qs
        }
        const response = await fetch(url)
        let body
        try {
            body = await response.json()
        } catch (e) {
            //non-JSON response (e.g. proxy/gateway error) - fall back to status text
            body = null
        }
        if (!response.ok)
            throw new AxisApiError(body?.error || response.statusText, body?.status || response.status)
        return body
    }
}

/**
 * @typedef {{}} QuoteParams
 * @property {string} sellingAsset - Asset to sell (`XLM` | `CODE:Issuer` | `CODE-Issuer` | contractId)
 * @property {string} buyingAsset - Asset to buy (same format as `sellingAsset`)
 * @property {string|number} amount - Trade amount in stroops (1 unit = 10,000,000 stroops)
 * @property {boolean} [direct] - Restrict to the direct market only (no intermediate-asset routes)
 */

/**
 * @typedef {{}} QuoteResult
 * @property {string} id - Base58-encoded quote id
 * @property {'success'|'unfeasible'|'rejected'} status - Quote status
 * @property {'strict_send'|'strict_receive'} direction - Trade direction
 * @property {string} sellingAsset - Selling asset contract id
 * @property {string} buyingAsset - Buying asset contract id
 * @property {number} ledger - Ledger sequence the quote was computed for
 * @property {QuotePath[]} paths - Candidate routes ranked by profitability (up to 10)
 * @property {string} [error] - Error message (present only if status is not `success`)
 */

/**
 * @typedef {{}} QuotePath
 * @property {string} sold - Amount sold, in stroops
 * @property {string} bought - Amount bought, in stroops
 * @property {QuotePathStep[]} path - Ordered list of hops in the route
 */

/**
 * @typedef {{}} QuotePathStep
 * @property {string} selling - Selling asset contract id at this hop
 * @property {string} buying - Buying asset contract id at this hop
 * @property {string[]} orders - Maker order IDs matched at this hop
 */

/**
 * @typedef {{}} DepthParams
 * @property {string} market - Market identifier `BASE/QUOTE`
 * @property {number} [depth] - Percentage band (±) around the center price (0 < depth ≤ 100, default 20)
 */

/**
 * @typedef {{}} OrderbookDepth
 * @property {number} ledger - Ledger sequence
 * @property {number} timestamp - UNIX timestamp (seconds)
 * @property {Array<[string, string]>} bids - `[price, quantity]` pairs sorted descending by price
 * @property {Array<[string, string]>} asks - `[price, quantity]` pairs sorted ascending by price
 */

/**
 * @typedef {{}} CandlesParams
 * @property {string} market - Market identifier `BASE/QUOTE`
 * @property {number} [from] - Lower boundary (UNIX seconds, default 0)
 * @property {number} [to] - Upper boundary (UNIX seconds, defaults to `from + resolution * 200`)
 * @property {number|string} [resolution] - Resolution in seconds or alias (`5m`,`15m`,`30m`,`1h`,`2h`,`4h`,`12h`,`1d`,`3d`,`1w`,`2w`, default `auto`)
 * @property {'asc'|'desc'} [order] - Sort order (default `desc`)
 */

/**
 * OHLCVT candle row: `[timestamp, open, high, low, close, baseVolume, quoteVolume, tradeCount]`
 * @typedef {[number, string, string, string, string, string, string, number]} Candle
 */

/**
 * @typedef {{}} Ticker24hResult
 * @property {number} ledger - Ledger sequence
 * @property {number} timestamp - UNIX timestamp (seconds)
 * @property {TickerEntry[]} ticker - Per-market 24h stats, sorted by trade count descending
 */

/**
 * @typedef {{}} TickerEntry
 * @property {string} symbol - Market symbol `BASE/QUOTE`
 * @property {string} openPrice - Opening price 24h ago
 * @property {string} highPrice - Highest price in the 24h window
 * @property {string} lowPrice - Lowest price in the 24h window
 * @property {string} lastPrice - Most recent trade price
 * @property {string} volume - 24h base asset volume
 * @property {string} quoteVolume - 24h quote asset volume
 * @property {number} change - 24h price change (percent)
 * @property {string} avgPrice - Volume-weighted average price
 * @property {number} trades - 24h trade count
 */

/**
 * @typedef {{}} MarketsParams
 * @property {string} [cursor] - Pagination cursor (`baseAsset-quoteAsset`)
 * @property {number|string} [limit] - Max markets to return
 */

/**
 * @typedef {{}} MarketInfo
 * @property {string} baseAsset - Base asset contract id
 * @property {string} quoteAsset - Quote asset contract id
 * @property {string} cursor - Pagination cursor for this market
 * @property {string[]} orderTypes - Supported order types
 */

/**
 * @typedef {{}} OrdersParams
 * @property {string} [owner] - Filter by order owner address
 * @property {string|string[]} [asset] - Filter by asset(s) - matches orders selling or buying any of them
 * @property {string|bigint} [cursor] - Pagination cursor (order id)
 * @property {number|string} [limit] - Max orders to return
 */

/**
 * @typedef {{}} OrderHistoryParams
 * @property {string} [owner] - Filter by order owner address
 * @property {string[]} [pair] - Asset pair `[base, quote]` (contract ids)
 * @property {string|bigint} [cursor] - Pagination cursor (order id)
 * @property {number|string} [limit] - Max orders to return
 */

/**
 * @typedef {{}} TradesParams
 * @property {string} [trader] - Filter by trader address
 * @property {string[]} [pair] - Asset pair `[base, quote]` (contract ids)
 * @property {string|bigint} [cursor] - Pagination cursor (trade id)
 * @property {number|string} [limit] - Max trades to return
 */

/**
 * @typedef {{}} ApiOrder - Serialized order returned by the API
 * @property {string} id - Order ID
 * @property {string} status - Order status (`ACTIVE`|`FILLED`|`CANCELED`)
 * @property {string} kind - Order kind (`LIMIT`)
 * @property {string} buying - Buying asset contract id
 * @property {string} selling - Selling asset contract id
 * @property {string} price - Order price
 * @property {string} rprice - Rational price representation
 * @property {string} quote - Total quote amount
 * @property {string} amount - Amount left to sell/buy
 * @property {string} owner - Maker address
 * @property {string} [expires] - Expiration timestamp (UTC)
 * @property {string} [iceberg] - Iceberg amount
 * @property {string} [stop] - Stop price
 * @property {string} [created] - Creation timestamp (UTC)
 * @property {string} [updated] - Last update timestamp (UTC)
 * @property {string} [cursor] - Pagination cursor
 */

/**
 * @typedef {{}} ApiTrade - Serialized trade returned by the API
 * @property {string} id - Trade ID
 * @property {string} order - Matched order ID
 * @property {string} taker - Taker account address
 * @property {string} maker - Maker account address
 * @property {string} soldAsset - Sold asset contract id
 * @property {string} boughtAsset - Bought asset contract id
 * @property {string} sold - Sold tokens amount
 * @property {string} bought - Bought tokens amount
 * @property {string} price - Approximate trade price
 * @property {string} [cursor] - Pagination cursor
 * @property {string} timestamp - Trade timestamp (UTC)
 */
