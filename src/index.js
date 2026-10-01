import {Networks, contract, rpc} from '@stellar/stellar-sdk'
import ContractClient from './contract-client.js'
import {ContractErrors, processSimulationErrors, processTransactionErrors} from './errors.js'
import {AxisApiClient, AxisApiError} from './api-client.js'
import {collectOrderIds, completeFootprint, ensureOrdersFootprint} from './footprint.js'
import {orderId, generateNonce} from './order-id.js'
import {OrderKind, TradeDirection} from './constants.js'

export {ContractErrors, AxisApiClient, AxisApiError, orderId, OrderKind, TradeDirection}
export {Axis, toWsUrl} from './axis.js'
export {AxisMarket} from './axis-market.js'
export {AxisAccount, parseApiOrder} from './axis-account.js'
export {AxisStreamClient} from './stream-client.js'
export {TokenBalance} from './token-balance.js'
export {Emitter} from './emitter.js'
export {planApproval, maxQuoteSpend, APPROVAL_TTL_LEDGERS, APPROVAL_RENEW_LEDGERS} from './allowance.js'
export {canonicalPair, compareAssets, pairKey, invertPrice, invertTicker, PRICE_SCALE} from './asset-pair.js'
export {parseApiDate} from './api-dates.js'

/**
 * Smart contract client for trading with AXIS DEX
 */
export class AxisContractClient {
    /**
     * @param {ClientInitializationParams} params
     */
    constructor(params) {
        const options = {
            publicKey: params.publicKey,
            signTransaction: params.signTransaction,
            rpcUrl: params.rpcUrl,
            allowHttp: true,
            networkPassphrase: params.networkPassphrase || Networks.PUBLIC,
            contractId: params.contractId
        }
        this.client = new ContractClient(options)
        this.fee = params.fee || '100000'
        this.autoFootprint = params.autoFootprint !== false
        this.server = new rpc.Server(params.rpcUrl, {allowHttp: true})
        this.assetCache = new Map()
    }

    /**
     * Account that signs and pays for the transactions
     * @return {string}
     */
    get publicKey() {
        return this.client.options.publicKey
    }

    /**
     * Fetch existing order.
     * @param {bigint} id - ID of the order to fetch
     * @return {Promise<Order|undefined>} - Order fetched from the storage, undefined if not found or expired
     */
    async order(id) {
        const tx = await this.client.order({id})
        processSimulationErrors(tx)
        return tx.result ?? undefined
    }

    /**
     * Fetch contract configuration.
     * @return {Promise<Config>}
     */
    async loadConfig() {
        const tx = await this.client.config()
        processSimulationErrors(tx)
        return tx.result
    }

    /**
     * Check whether the contract is frozen.
     * @return {Promise<boolean>} - `true` if contract is frozen (trading and order management operations blocked)
     */
    async isFrozen() {
        const tx = await this.client.frozen()
        processSimulationErrors(tx)
        return tx.result
    }

    /**
     * Fetch market for the given asset pair.
     * @param {string} selling - First market asset
     * @param {string} buying - Second market asset
     * @return {Promise<Market|undefined>} - Market record if the market exists
     */
    async getMarket(selling, buying) {
        const tx = await this.client.market({selling, buying})
        processSimulationErrors(tx)
        return tx.result ?? undefined
    }

    /**
     * Trade with DEX and create a buy limit order if the quote not executed in full.
     * @param {BuyTradeArguments} params
     * @return {Promise<[bigint, bigint, bigint|undefined]>} - Amount of sold and bought tokens, ID of the newly created order if any
     * @throws {Error} - If the trader has insufficient balance or allowance, invalid `expires` field specified, a `Limit` trade targets a pair without a market,
     * no reference price is available, any of the counter orders provided do not match selling/buying asset, or a live order with the same id exists
     */
    async buy(params) {
        return await execTrade(params, TradeDirection.Buy, this)
    }

    /**
     * Trade with DEX and create a sell limit order if the quote not executed in full.
     * @param {SellTradeArguments} params
     * @return {Promise<[bigint, bigint, bigint|undefined]>} - Amount of sold and bought tokens, ID of the newly created order if any
     * @throws {Error} - If the trader has insufficient balance or allowance, invalid `expires` field specified, a `Limit` trade targets a pair without a market,
     * no reference price is available, any of the counter orders provided do not match selling/buying asset, or a live order with the same id exists
     */
    async sell(params) {
        return await execTrade(params, TradeDirection.Sell, this)
    }

    /**
     * Update the amount, price, or expiration of several orders in place, or remove them.
     * Orders that no longer exist are skipped; expired orders revived with the new expiration.
     * A zero amount removes the order, expired ones included. An updated order's entry lifetime is
     * extended to cover its expiration +1 day. Approvals and removals work in a frozen contract.
     * A transaction can process up to 100 orders in one batch.
     * @param {UpdateArguments} params
     * @return {Promise<bigint[]>} - IDs of the orders to update
     * @throws {Error} - If the trader does not own an updated order, if order parameters are invalid, if an order is below the minimum value,
     * if the new amounts are not backed by the trader's balance and allowance, if the contract is frozen
     */
    async update(params) {
        const updates = params.updates.map(update => ({
            id: update.id,
            amount: update.amount,
            price: update.price,
            expires: BigInt(update.expires ?? 0)
        }))
        const approvals = (params.approvals ?? []).map(approval => {
            if (!approval.asset)
                throw new TypeError('An update approval must name its asset')
            return toApproval(approval, approval.asset)
        })
        const tx = await this.client.update({trader: params.trader, updates, approvals}, {fee: this.fee})
        processSimulationErrors(tx)
        this.updateFootprint(tx, updates.map(update => update.id))
        const result = await signAndSend(tx)
        return result
    }

    /**
     * Cancel existing orders, expired ones included. A transaction can process up to 100 orders in one batch.
     * @param {string} trader - Trader address
     * @param {bigint[]} ids - IDs of the orders to cancel (non-existent orders are ignored)
     * @return {Promise<void>}
     * @throws {Error} - If trader is not the owner of any existing order in `ids` or if the contract is frozen
     */
    async cancel(trader, ids) {
        await this.update({trader, updates: ids.map(id => ({id, amount: 0n, price: 0n}))})
    }

    /**
     * Fill an existing order against matching orders from the orderbook. Profits from inefficiencies go to the trader.
     * @param {string} trader - Trader address
     * @param {bigint} takerOrderId - ID of the order that serves as a taker
     * @param {bigint[]} orders - List of order IDs to match against
     * @return {Promise<[bigint, bigint, bigint]>} - Amount the taker order sold, amount the taker received, surplus paid to the trader
     * @throws {Error} - If the taker order does not exist or has expired, if any of the orders provided do not match selling/buying asset,
     * if the taker order's owner or the trader cannot receive the bought asset, if the contract is frozen
     */
    async crossfill(trader, takerOrderId, orders) {
        const tx = await this.client.crossfill({trader, taker_order_id: takerOrderId, orders}, {fee: this.fee})
        processSimulationErrors(tx)
        //the traded assets come from the taker order, resolved while completing the footprint
        await this.updateTradeFootprint(tx, [], [takerOrderId], orders)
        const result = await signAndSend(tx)
        return [result[0], result[1], result[2]]
    }

    /**
     * Swap tokens across several markets. The contract holds the intermediate hop proceeds only within the call.
     * @param {SwapArguments} params
     * @return {Promise<[bigint, bigint]>} - Amount of sold and bought tokens
     * @throws {Error} - If the route cannot satisfy the selling/buying amount, if `path` is empty or an amount is invalid,
     * if any of the orders provided do not match trade step selling/buying asset, if the trader cannot pay for the fills or receive tokens, if the contract is frozen
     */
    async swap(params) {
        const tx = await this.client.swap({
            direction: params.direction,
            trader: params.trader,
            selling: params.selling,
            selling_amount: params.sellingAmount,
            buying_amount: params.buyingAmount,
            path: params.path.map(step => ({asset: step.asset, orders: step.orders})),
            approve: toApproval(params.approve, params.selling)
        }, {fee: this.fee})
        processSimulationErrors(tx)
        const tokens = [params.selling, ...params.path.map(step => step.asset)]
        await this.updateTradeFootprint(tx, tokens, ...params.path.map(step => step.orders))
        const result = await signAndSend(tx)
        return [result[0], result[1]]
    }

    /**
     * Re-check both market assets against the price oracle and cache oracle prices.
     * A cached price is valid for up to 72 hours. A market without quoted assets stops accepting
     * new limit orders; its outstanding orders stay cancellable and fillable. The record and the
     * cached prices are rewritten only when they change. When the simulation writes nothing (the market and the
     * cached prices are current, or the oracle has no newer price), the simulated result is
     * returned and no transaction is submitted.
     * @param {string} selling - First market asset
     * @param {string} buying - Second market asset
     * @return {Promise<Market|undefined>} - Updated market record, undefined if the market does not exist
     * @throws {Error} - If the contract is frozen
     */
    async requote(selling, buying) {
        const tx = await this.client.requote({selling, buying}, {fee: this.fee})
        processSimulationErrors(tx)
        if (tx.isReadCall)
            return tx.result ?? undefined //nothing changed on-chain
        const result = await signAndSend(tx)
        return result ?? undefined
    }

    /**
     * Extend oracle price feeds access for a market, creating the market if it does not exist yet.
     * @param {SubsidizeArguments} params
     * @return {Promise<bigint[]>} - New access expiration UNIX timestamps (in seconds) per oracle-listed asset
     * @throws {Error} - If `amount` is invalid, if the market does not exist and the amount is below the market listing fee,
     * if neither market asset is quoted by the oracle, if the contract is frozen
     */
    async subsidize(params) {
        const tx = await this.client.subsidize({
            sponsor: params.sponsor,
            selling: params.selling,
            buying: params.buying,
            amount: params.amount
        }, {fee: this.fee})
        processSimulationErrors(tx)
        const result = await signAndSend(tx)
        return result
    }

    /**
     * Extend the contract instance and code lifetime.
     * @return {Promise<void>}
     */
    async keepalive() {
        const tx = await this.client.keepalive({fee: this.fee})
        processSimulationErrors(tx)
        await signAndSend(tx)
    }

    /**
     * Declare all order ids of a simulated call in the read-write footprint (if enabled).
     * @param {contract.AssembledTransaction} tx - Simulated transaction
     * @param {...Array<bigint>} idLists - Order ids passed to the contract call
     * @private
     */
    updateFootprint(tx, ...idLists) {
        if (this.autoFootprint) {
            const orderIds = collectOrderIds(...idLists)
            ensureOrdersFootprint(tx, this.client.options.contractId, orderIds)
        }
    }

    /**
     * Declare all order ids of a simulated trading call, and the entries the settlement may write for their makers,
     * in the read-write footprint (if enabled), so the transaction survives book changes before it is applied.
     * @param {contract.AssembledTransaction} tx - Simulated transaction
     * @param {string[]} tokens - Tokens the call trades
     * @param {...Array<bigint>} idLists - Order ids passed to the contract call
     * @return {Promise<void>}
     * @private
     */
    async updateTradeFootprint(tx, tokens, ...idLists) {
        if (this.autoFootprint) {
            const orderIds = collectOrderIds(...idLists)
            await completeFootprint(tx, this.client.options.contractId, orderIds, {server: this.server, tokens, assetCache: this.assetCache})
        }
    }
}

/**
 * Map the client-side approval to the contract `Approval` argument
 * @param {Approval} [approve]
 * @param {string} defaultAsset - Asset approved when `approve.asset` is not set
 * @return {{asset: string, amount: bigint, live_until: number}|undefined}
 * @internal
 */
function toApproval(approve, defaultAsset) {
    if (!approve)
        return undefined
    return {asset: approve.asset ?? defaultAsset, amount: approve.amount, live_until: approve.liveUntil}
}

/**
 * Sign and submit a simulated transaction
 * @param {contract.AssembledTransaction} tx
 * @return {Promise<*>} - Parsed contract call result
 * @throws {Error} - If the transaction failed on-chain
 * @internal
 */
async function signAndSend(tx) {
    const sent = await tx.signAndSend()
    processTransactionErrors(sent)
    return sent.result
}

async function execTrade(params, direction, context) {
    //the id of the order created for the remainder derives from the trader and this nonce; generated per call, never supplied by the caller
    const nonce = generateNonce()
    const payload = {
        direction: direction,
        kind: params.kind,
        trader: params.trader,
        amount: params.amount,
        selling: params.selling,
        buying: params.buying,
        price: params.price,
        orders: params.orders ?? [],
        nonce,
        expires: BigInt(params.expires ?? 0),
        approve: toApproval(params.approve, params.selling)
    }
    const tx = await context.client.trade(payload, {fee: context.fee})
    processSimulationErrors(tx)
    //the remainder of a Limit trade becomes an order under an id known in advance - declare it even if the simulation filled the quote
    const remainder = params.kind === OrderKind.Limit ? [orderId(params.trader, nonce)] : []
    await context.updateTradeFootprint(tx, [params.selling, params.buying], payload.orders, remainder)
    const result = await signAndSend(tx)
    return [result[0], result[1], result[2] ?? undefined]
}

/**
 * @typedef {{}} ClientInitializationParams
 * @property {string} publicKey - Public key of the account that will interact with the contract
 * @property {SignTransactionCallback} signTransaction - Callback for signing transactions generated by the client
 * @property {string} rpcUrl - URL of the RPC server
 * @property {string} contractId - DEX contract ID
 * @property {string} [networkPassphrase] - Network passphrase (Pubnet passphrase by default)
 * @property {string} [fee] - Transaction fee (0.1 XLM by default)
 * @property {boolean} [autoFootprint] - Declare every supplied order id, and the balances and allowances of the makers behind them, in the read-write footprint of trading transactions (enabled by default)
 */

/**
 * @callback SignTransactionCallback - Callback for signing transactions generated by the client
 * @param {string} tx - Transaction XDR to sign
 * @param {{network: string, networkPassphrase: string, accountToSign: string}} context - Signing context
 * @return {Promise<{signedTxXdr: string, [signerAddress]: string}>} - Signed transaction response
 */

/**
 * @typedef {{}} Approval - Token allowance granted to the contract as part of the call
 * @property {string} [asset] - Token the allowance is granted on
 * @property {bigint} amount - Absolute allowance amount (0 revokes the approval)
 * @property {number} liveUntil - Ledger sequence the allowance lives until
 */

/**
 * @typedef {{}} TradeArguments
 * @property {OrderKind} kind - Trading order behavior
 * @property {string} trader - Trader address
 * @property {bigint} amount - Tokens amount
 * @property {string} selling - Selling token address
 * @property {string} buying - Buying token address
 * @property {bigint} price - Price a trader willing to accept
 * @property {Array<bigint>} [orders] - List of order IDs to match before creating the order on-chain
 * @property {bigint|number} [expires] - Expiration UNIX timestamp (in seconds) of the order created for a `Limit` remainder, 0 or omitted = no expiration
 * @property {Approval} [approve] - Optional allowance granted to the contract before trading (on `selling` unless `asset` is set)
 */

/**
 * @typedef {{}} SellTradeArguments
 * @extends TradeArguments
 * @property {bigint} amount - Amount of `selling` tokens to sell
 * @property {bigint} price - Price a trader willing to accept, minimum `buying` tokens per 1 `selling`
 */

/**
 * @typedef {{}} BuyTradeArguments
 * @extends TradeArguments
 * @property {bigint} amount - Amount of `buying` tokens to acquire
 * @property {bigint} price - Price a trader willing to accept, maximum `selling` tokens per 1 `buying`
 */

/**
 * @typedef {{}} TradeStep - A trade step in a multi-market swap path
 * @property {string} asset - Asset to buy at this step
 * @property {Array<bigint>} orders - Maker order IDs to match
 */

/**
 * @typedef {{}} SwapArguments - Swap path and settings
 * @property {TradeDirection} direction - Trade direction: `Sell` or `Buy`
 * @property {string} trader - Trader address
 * @property {string} selling - Token address sent by the trader
 * @property {bigint} sellingAmount - Amount of selling tokens to send (`Sell`) or the maximum to spend (`Buy`)
 * @property {bigint} buyingAmount - Minimum amount of buying tokens to receive (`Sell`) or the exact amount (`Buy`)
 * @property {Array<TradeStep>} path - Ordered list of the trade route steps
 * @property {Approval} [approve] - Optional allowance granted to the contract before trading (on `selling` unless `asset` is set)
 */

/**
 * @typedef {{}} OrderUpdate - New amount, price and expiration for an existing order
 * @property {bigint} id - Order id
 * @property {bigint} amount - New amount to sell, 0 removes the order
 * @property {bigint} price - New order price (ignored for a removal)
 * @property {bigint|number} [expires] - New expiration UNIX timestamp (in seconds), 0 or omitted = no expiration
 */

/**
 * @typedef {{}} UpdateArguments
 * @property {string} trader - Orders owner
 * @property {Array<OrderUpdate>} updates - New amount, price and expiration per order
 * @property {Array<Approval>} [approvals] - Allowances granted before the backing check, each naming its `asset`; an asset
 * without an approval keeps its current allowance
 */

/**
 * @typedef {{}} SubsidizeArguments
 * @property {string} sponsor - Address paying for the oracle feeds (and the listing fee of a new market)
 * @property {string} selling - First market asset
 * @property {string} buying - Second market asset (either order opens the same market)
 * @property {bigint} amount - Amount of XRF fee tokens to burn, at least `Config.market_listing_fee` to open a market
 */

/**
 * @typedef {{}} MethodOptions
 * @property {string} [fee] - Transaction fee (0.1 XLM by default)
 */

/**
 * @typedef {{}} Order - Order properties, stored on-chain
 * @property {bigint} id - Unique order identifier, derived from the owner and the client nonce
 * @property {string} owner - Maker address
 * @property {string} selling - Selling token address
 * @property {string} buying - Buying token address
 * @property {bigint} amount - Amount left to sell
 * @property {bigint} price - Order price (`buying` per 1 `selling`, 18 decimals)
 * @property {bigint} expires - Expiration timestamp (0 = no expiration)
 */

/**
 * @typedef {{}} Config - Contract configuration
 * @property {string} oracle - Oracle contract address
 * @property {bigint} market_listing_fee - Amount of oracle tokens burned by the market creator to provision the oracle price feeds (always the oracle daily fee x 90)
 * @property {string} safety_admin - Address of the account allowed to freeze the contract, change the minimum trade size and replace the oracle
 * @property {bigint} min_trade_size - Minimum trade value in USD, with 7 decimals precision (0 disables the limit)
 */

/**
 * @typedef {{}} MarketSide - Market asset descriptor
 * @property {string} asset - Token contract address
 * @property {boolean} listed - Whether the asset is quoted by the oracle
 * @property {number} decimals - Token decimals (fetched only for listed assets)
 */

/**
 * @typedef {{}} Market - Market record, stored on-chain
 * @property {MarketSide} a - First asset (canonical order)
 * @property {MarketSide} b - Second asset (canonical order)
 * @property {bigint} created - Creation timestamp
 */

/**
 * @typedef {object} TradeContractEvent - Orderbook `trade` event, one per fill
 * @property {string} selling - Asset sold by the taker (topic)
 * @property {string} buying - Asset bought by the taker (topic)
 * @property {bigint} order - Maker order id
 * @property {string} taker - Trader account address
 * @property {string} maker - Seller account address
 * @property {bigint} sold - Sold tokens amount
 * @property {bigint} bought - Bought tokens amount
 * @property {bigint} left - Order amount left after the fill (0 = removed)
 */

/**
 * @typedef {object} SwapContractEvent - Orderbook `swap` event, one per call
 * @property {string} selling - Asset sold by the trader (topic)
 * @property {string} buying - Asset received by the trader (topic)
 * @property {string} trader - Trader account address
 * @property {bigint} sold - Amount of `selling` tokens sold
 * @property {bigint} bought - Amount of `buying` tokens received
 */

/**
 * @typedef {object} OrderCreatedContractEvent - Orderbook `new` event, an order created
 * @property {string} selling - Selling asset address (topic)
 * @property {string} buying - Buying asset address (topic)
 * @property {bigint} id - Unique order identifier
 * @property {string} owner - Maker address
 * @property {bigint} price - Order price
 * @property {bigint} amount - Current amount
 * @property {bigint} expires - Expiration timestamp (0 = no expiration)
 */

/**
 * @typedef {object} OrderUpdatedContractEvent - Orderbook `mod` event, an order changed outside a fill
 * @property {bigint} id - Unique order identifier
 * @property {bigint} price - Order price
 * @property {bigint} amount - Current amount (0 = removed)
 * @property {bigint} expires - Expiration timestamp (0 = no expiration)
 */

/**
 * @typedef {object} OrderSkippedContractEvent - Orderbook `skip` event, a listed order its maker could not settle
 * (backing short of the fill, cannot receive the taker's asset, or the transfer failed); the order is left unchanged
 * @property {bigint} order - Order id
 */

/**
 * @typedef {object} MarketRefreshContractEvent - Orderbook `refresh` event, a market checked against the oracle
 * (topics: `refresh`, `a`, `b`; no data)
 * @property {string} a - First market asset (canonical order, topic)
 * @property {string} b - Second market asset (canonical order, topic)
 */

/**
 * @typedef {object} FreezeContractEvent - `freeze` event
 * @property {boolean} frozen - Whether trading is blocked after the call
 */

/**
 * @typedef {object} ConfigChangedContractEvent - `config` update notification event
 * @property {Config} config - Contract configuration after the call
 */
