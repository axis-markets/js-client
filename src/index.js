import {Networks} from '@stellar/stellar-sdk'
import ContractClient from './contract-client.js'
import {ContractErrors, processSimulationErrors} from './errors.js'
import {ApiClient, AxisApiError} from './api-client.js'

export {ContractErrors, ApiClient, AxisApiError}

/** Trading order type - instructions to contract how to execute the trade */
export const OrderKind = {
    /** Execute trade, create a limit order if not executed in full */
    Limit: 1,
    /** Execute trade without creating a limit order */
    Fill: 2,
    /** Execute trade, cancel if was not executed in full */
    FillOrKill: 3
}

/** Trade direction instructions */
export const TradeDirection = {
    Sell: 1,
    Buy: 2
}

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
    }

    /**
     * Retrieve last order id
     * @return {Promise<bigint>} - Last created order id
     */
    async last() {
        const tx = await this.client.last()
        processSimulationErrors(tx)
        return tx.result
    }

    /**
     * @param {bigint} id - ID of the order to fetch
     * @return {Promise<Order>} - Order fetched from the storage
     */
    async order(id) {
        const tx = await this.client.order({id})
        processSimulationErrors(tx)
        return tx.result
    }

    /**
     * Cancel existing order
     * @param {bigint[]} ids - ID of the order to cancel
     * @param {string} trader - Trader address
     * @return {Promise<void>}
     * @throws {Error} - If trader is not the owner of the order
     */
    async cancel(ids, trader) {
        const tx = await this.client.cancel({ids, trader}, {fee: this.fee})
        processSimulationErrors(tx)
        await tx.signAndSend()
    }

    /**
     * Fill existing orders using another matching order from the orderbook
     * @param {string} trader - Trader address
     * @param {bigint} takerOrderId - ID of the order that serves as a taker
     * @param {bigint[]} orders - List of order IDs to match before creating the order on chain
     * @return {Promise<[bigint, bigint]>} - Amount of sold and bought tokens
     * @throws {Error} - If the taker order was not found
     * @throws {Error} - If any of the orders provided do not match selling/buying asset
     * @throws {Error} - If the trade causes an overflow
     */
    async fill_order(trader, takerOrderId, orders) {
        const tx = await this.client.fill_order({trader, taker_order_id: takerOrderId, orders}, {fee: this.fee})
        processSimulationErrors(tx)
        const res = await tx.signAndSend()
        return [res.result.sold, res.result.bought]
    }

    /**
     * Trade with DEX and create buy limit order if quote not executed in full
     * @param {BuyTradeArguments} params
     * @return {Promise<[bigint, bigint, bigint]>} - Amount of sold and bought tokens, ID of the newly created order if any
     * @throws {Error} - If the trader has insufficient balance
     * @throws {Error} - If any of the orders provided do not match selling/buying asset
     * @throws {Error} - If the trade causes an overflow
     */
    async buy(params) {
        return await execTrade(params, TradeDirection.Buy, this)
    }

    /**
     * Trade with DEX and create sell limit order if quote not executed in full
     * @param {SellTradeArguments} params
     * @return {Promise<[bigint, bigint, bigint]>} - Amount of sold and bought tokens, ID of the newly created order if any
     * @throws {Error} - If the trader has insufficient balance
     * @throws {Error} - If any of the orders provided do not match selling/buying asset
     * @throws {Error} - If the trade causes an overflow
     */
    async sell(params) {
        return await execTrade(params, TradeDirection.Sell, this)
    }

    async swap(params) {
        const tx = await this.client.swap({
            direction: params.direction,
            trader: params.trader,
            selling: params.selling,
            selling_amount: params.sellingAmount,
            buying_amount: params.buyingAmount,
            path: params.path.map(step => ({asset: step.asset, orders: step.orders}))
        }, {fee: this.fee})
        processSimulationErrors(tx)
        const res = await tx.signAndSend()
        return [res.result.sold, res.result.bought]
    }
}

async function execTrade(params, direction, context) {
    const payload = {
        direction: direction,
        kind: params.kind,
        trader: params.trader,
        amount: params.amount,
        selling: params.selling,
        buying: params.buying,
        price: params.price,
        orders: params.orders
    }
    const tx = await context.client.trade(payload, {fee: context.fee})
    processSimulationErrors(tx)
    const {result} = await tx.signAndSend()
    return [result[0], result[1], result[2]]
}

/**
 * @typedef {{}} ClientInitializationParams
 * @property {string} publicKey - Public key of the account that will interact with the contract
 * @property {SignTransactionCallback} signTransaction - Callback for signing transactions generated by the client
 * @property {string} rpcUrl - URL of the RPC server
 * @property {string} contractId - DEX contract ID
 * @property {string} [networkPassphrase] - Network passphrase (Pubnet passphrase by default)
 * @property {string} [fee] - Transaction fee (0.1 XLM by default)
 */

/**
 * @callback SignTransactionCallback - Callback for signing transactions generated by the client
 * @param {string} tx - Transaction XDR to sign
 * @param {{network: string, networkPassphrase: string, accountToSign: string}} context - Signing context
 * @return {Promise<{signedTxXdr: string, [signerAddress]: string}>} - Signed transaction response
 */

/**
 * @typedef {{}} TradeArguments
 * @property {OrderKind} kind - Trading order behavior
 * @property {string} trader - Trader address
 * @property {bigint} amount - Tokens amount
 * @property {string} selling - Selling token address
 * @property {string} buying - Buying token address
 * @property {bigint} price - Price a trader willing to accept
 * @property {Array<bigint>} orders - List of order IDs to match before creating the order on-chain
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
 * @typedef {{}} SwapArguments
 * @property {TradeDirection} direction - Trade direction: `Sell` or `Buy`
 * @property {string} trader - Trader address
 * @property {string} selling - Token address sent by the trader
 * @property {bigint} selling_amount - Maximum amount of selling tokens to send
 * @property {bigint} buying_amount - Minimum amount of buying tokens to receive
 * @property {Array<TradeStep>} path - Ordered list of the trade route steps
 */

/**
 * @typedef {{}} MethodOptions
 * @property {string} [fee] - Transaction fee (0.1 XLM by default)
 */

/**
 * @typedef {{}} Order - Order properties, stored on-chain
 * @property {bigint} id - Order ID
 * @property {OrderKind} kind - Trading behavior
 * @property {string} owner - Owner of the order
 * @property {string} selling - Selling token address
 * @property {string} buying - Buying token address
 * @property {bigint} amount - Amount of tokens to sell
 * @property {bigint} price - Price of the order
 * @property {bigint} quote - Total amount of tokens to buy
 * @property {bigint} expires - Expiration time of the order
 */

