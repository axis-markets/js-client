import {Emitter} from './emitter.js'
import {pairKey, invertPrice} from './asset-pair.js'
import {parseApiDate} from './api-dates.js'
import {planApproval, maxQuoteSpend} from './allowance.js'
import {OrderKind, TradeDirection} from './constants.js'

/** Orders per `update` transaction  */
const UPDATE_BATCH = 90
/** Time to wait for the account state before trading, in milliseconds */
const READY_TIMEOUT = 15_000
/** How long an order created by this client counts as committed before the indexer reports it, in milliseconds */
const LOCAL_ORDER_TTL = 120_000

/**
 * Trader wrapper that tracks every open order of an account across all markets and the account backing.
 * Create it with {@link import('./axis.js').Axis#account}.
 *
 * Emits:
 * - `ready` - the account state was loaded
 * - `new` {@link AccountOrder} - an order was created (confirmed by the indexer)
 * - `pending` {@link AccountOrder} - an order created by this client, not reported by the indexer yet
 * - `fill` {@link AccountFill} - an order was partially filled
 * - `filled` {@link AccountFill} - an order was filled in full
 * - `update` {@link AccountOrder} - an order changed (amount, price, expiration, revived)
 * - `cancel` {@link AccountOrder} - an order was removed by the owner
 * - `expire` {@link AccountOrder} - an order expired
 * - `remove` {@link AccountOrder} - an order left the open orders (after `filled`, `cancel`, `expire`)
 * - `order` `{action, order, fill?}` - any order change
 * - `backing` `{asset, backing}` - the balance, allowance or the backing split of the orders selling a token changed
 * - `approve` `{asset, amount, liveUntil}` - a trading call is about to grant an allowance
 * - `trade` {ApiTrade} - the account performed a trade
 * - `swap` {ApiSwap} - the account performed a swap
 * - `change` - the open orders or the backing changed
 * - `error` `Error` - the push API rejected the account subscription
 */
export class AxisAccount extends Emitter {
    /**
     * @param {Axis} axis
     * @param {string} address - Trader address
     * @param {{signTransaction?: SignTransactionCallback}} [options]
     */
    constructor(axis, address, {signTransaction} = {}) {
        super()
        this.axis = axis
        this.address = address
        this.signTransaction = signTransaction
        this.ready = new Promise(resolve => this.resolveReady = resolve)
    }

    /**
     * Trader address
     * @type {string}
     * @readonly
     */
    address
    /**
     * Wallet signing callback, required to trade
     * @type {SignTransactionCallback|undefined}
     */
    signTransaction
    /**
     * Open orders by id
     * @type {Map<string, AccountOrder>}
     * @readonly
     */
    orders = new Map()
    /**
     * Account backing by token contract id
     * @type {Map<string, AccountBacking>}
     * @readonly
     */
    backing = new Map()
    /**
     * Resolves once the account state has been loaded
     * @type {Promise<void>}
     * @readonly
     */
    ready
    /**
     * Whether the account state has been loaded
     * @type {boolean}
     */
    loaded = false
    /**
     * Orders created by this client that the indexer has not reported yet
     * @type {Map<string, {order: AccountOrder, expires: number}>}
     * @private
     */
    local = new Map()
    /**
     * Whether the backing in memory get updated from the push API
     * @type {boolean}
     * @private
     */
    live = false
    /**
     * Last taker spend of this client by token, UNIX milliseconds
     * @type {Map<string, number>}
     * @private
     */
    spent = new Map() //TODO: drop this
    /**
     * @type {function(): void}
     * @private
     */
    resolveReady

    /**
     * Start tracking this account
     * @internal
     */
    start() {
        const {stream} = this.axis
        this.unsubscribe = stream.subscribe('account', {address: this.address}, message => this.handle(message))
        this.offOpen = stream.on('open', () => this.stopFallback())
        this.offClose = stream.on('close', () => {
            this.live = false //changes are missed until the next snapshot
            this.startFallback()
        })
        //load over REST if the push API does not deliver the snapshot soon
        this.initTimer = setTimeout(() => {
            if (!this.loaded) {
                this.refresh().catch(() => this.startFallback())
            }
        }, 3_000)
    }

    /**
     * Stop tracking this account
     */
    close() {
        clearTimeout(this.initTimer)
        this.stopFallback()
        this.unsubscribe?.()
        this.offOpen?.()
        this.offClose?.()
        this.axis.releaseAccount(this)
    }

    /**
     * Reload current account state from the REST API
     * @return {Promise<void>}
     */
    async refresh() {
        //the REST state lists only the tokens of the orders once nobody subscribes: keep the other balances
        this.applySnapshot(await this.axis.api.getAccount(this.address), true)
    }

    /**
     * Retrieve open orders, newest first
     * @param {{market?: string|{base: string, quote: string}|string[], selling?: string, buying?: string}} [filter] - `market` is an {AxisMarket} or a pair of assets in any order
     * @return {AccountOrder[]}
     */
    getOrders({market, selling, buying} = {}) { //TODO: simplify market argument
        const key = toMarketKey(market)
        const res = []
        for (const order of this.allOrders()) {
            if (key && order.market !== key)
                continue
            if (selling && order.selling !== selling)
                continue
            if (buying && order.buying !== buying)
                continue
            res.push(order)
        }
        return res.sort(newestFirst)
    }

    /**
     * Get open order by id
     * @param {bigint|string} id
     * @return {AccountOrder|undefined}
     */
    getOrder(id) {
        const key = id.toString()
        return this.orders.get(key) ?? this.localOrders().find(order => order.id === key)
    }

    /**
     * Calculate the remaining amount of the open orders selling the token across every market (what the allowance must cover)
     * @param {string} asset - Token contract id
     * @return {bigint}
     */
    committed(asset) {
        let sum = 0n
        for (const order of this.allOrders()) {
            if (order.selling === asset) {
                sum += order.amount
            }
        }
        return sum
    }

    /**
     * Get spendable balance of the account in a token
     * @param {string} asset - Token contract id
     * @return {bigint|undefined} - Undefined if not tracked
     */
    getBalance(asset) {
        const backing = this.backing.get(asset)
        return backing?.updated ? backing.balance : undefined
    }

    /**
     * Get spendable balances in every tracked token by token contract id
     * @return {Map<string, bigint>}
     */
    get balances() {
        const res = new Map()
        for (const [asset, backing] of this.backing) {
            if (backing.updated) {
                res.set(asset, backing.balance)
            }
        }
        return res
    }

    /**
     * Whether the account exists on the ledger
     * @return {boolean|undefined}
     */
    get funded() {
        const backing = this.backing.get(this.axis.nativeAsset)
        return backing?.updated ? backing.authorized : undefined
    }

    /**
     * Get balance, allowance and commitments of the account in a token
     * @param {string} asset - Token contract id
     * @return {AccountAllowance}
     */
    getAllowance(asset) {
        const backing = this.backing.get(asset)
        const committed = this.committed(asset)
        if (!backing?.updated)
            return {asset, known: false, committed}
        return {
            asset,
            known: true,
            balance: backing.balance,
            allowance: backing.allowance,
            liveUntil: backing.liveUntil,
            authorized: backing.authorized,
            pending: backing.pending,
            available: backing.budget,
            committed
        }
    }

    /**
     * Sell tokens creating a limit remainder order if not executed in full
     * @param {TradeParams} params - `amount` of `selling` to sell; `price` is the minimum `buying` per 1 `selling`
     * @return {Promise<TradeResult>}
     */
    async sell(params) {
        return this.trade(TradeDirection.Sell, params)
    }

    /**
     * Buy tokens creating a limit remainder order if not executed in full
     * @param {TradeParams} params - `amount` of `buying` to acquire; `price` is the maximum `selling` per 1 `buying`
     * @return {Promise<TradeResult>}
     */
    async buy(params) {
        return this.trade(TradeDirection.Buy, params)
    }

    /**
     * Simulate a sell with the same crossing and approval as `sell`, without signing or submitting it
     * @param {TradeParams} params - Same as `sell`
     * @return {Promise<import('./index.js').TradeEstimate>} - Network fee and expected result
     */
    async estimateSell(params) {
        const {payload} = await this.prepareTrade(TradeDirection.Sell, params)
        const client = await this.client()
        return client.estimateSell(payload)
    }

    /**
     * Simulate a buy with the same crossing and approval as `buy`, without signing or submitting it
     * @param {TradeParams} params - Same as `buy`
     * @return {Promise<import('./index.js').TradeEstimate>} - Network fee and expected result
     */
    async estimateBuy(params) {
        const {payload} = await this.prepareTrade(TradeDirection.Buy, params)
        const client = await this.client()
        return client.estimateBuy(payload)
    }

    /**
     * Change the amount, price or expiration of open orders (omitted fields keep their current values)
     * @param {Array<{id: bigint|string, amount?: bigint, price?: bigint, expires?: number}>} updates
     * @return {Promise<bigint[]>} - Updated order ids
     */
    async update(updates) {
        await this.whenReady()
        const normalized = updates.map(update => {
            const current = this.getOrder(update.id)
            if (!current && (update.amount === undefined || update.price === undefined))
                throw new Error(`Order ${update.id} is not an open order of ${this.address}`)
            return {
                current,
                update: {
                    id: BigInt(update.id),
                    amount: update.amount ?? current.amount,
                    price: update.price ?? current.price,
                    expires: update.expires ?? current?.expires ?? 0
                }
            }
        })
        //extra commitment per sold token
        const growth = new Map()
        for (const {current, update} of normalized) {
            if (!current)
                continue
            growth.set(current.selling, (growth.get(current.selling) ?? 0n) + update.amount - current.amount)
        }
        const approvals = []
        for (const [asset, delta] of growth) {
            if (delta <= 0n)
                continue
            const approve = await this.planApproval(asset, delta)
            if (approve) {
                this.emit('approve', {asset, ...approve})
                approvals.push({asset, ...approve})
            }
        }
        const client = await this.client()
        const res = []
        for (let i = 0; i < normalized.length; i += UPDATE_BATCH) {
            const batch = normalized.slice(i, i + UPDATE_BATCH).map(n => n.update)
            //approvals travel with the first batch, before its backing check
            const ids = await client.update({trader: this.address, updates: batch, approvals: i === 0 ? approvals : []})
            res.push(...ids)
        }
        return res
    }

    /**
     * Cancel open orders
     * @param {Array<bigint|string>} ids
     * @return {Promise<void>}
     */
    async cancel(ids) {
        const client = await this.client()
        const all = ids.map(id => BigInt(id))
        for (let i = 0; i < all.length; i += UPDATE_BATCH) {
            await client.cancel(this.address, all.slice(i, i + UPDATE_BATCH))
        }
        for (const id of all) {
            this.local.delete(id.toString())
        }
    }

    /**
     * Cancel all open orders
     * @param {{market?: string|{base: string, quote: string}|string[]}} [filter]
     * @return {Promise<string[]>} - Canceled order ids
     */
    async cancelAll({market} = {}) {
        await this.whenReady()
        const ids = this.getOrders({market}).map(order => order.id)
        if (ids.length) {
            await this.cancel(ids)
        }
        return ids
    }

    /**
     * Fill an open order against the book while keeping profits from price inefficiencies
     * @param {bigint|string} takerOrderId - Order acting as the taker
     * @param {Array<bigint|string>} [orders] - Counter orders, looked up automatically when omitted
     * @return {Promise<{sold: bigint, bought: bigint, surplus: bigint}>}
     */
    async crossfill(takerOrderId, orders) {
        if (!orders) {
            const taker = this.getOrder(takerOrderId) ?? await this.axis.getOrder(takerOrderId)
            if (!taker)
                throw new Error(`Order ${takerOrderId} not found`)
            orders = (await this.findQuote(TradeDirection.Sell, taker.selling, taker.buying, taker.amount)).orders
        }
        const client = await this.client()
        const [sold, bought, surplus] = await client.crossfill(this.address, BigInt(takerOrderId), orders.map(id => BigInt(id)))
        return {sold, bought, surplus}
    }

    /**
     * Swap across one or several markets along the best route found by the AXIS API
     * @param {SwapParams} params
     * @return {Promise<{sold: bigint, bought: bigint, approve?: import('./index.js').Approval}>}
     */
    async swap({selling, buying, amount, direction = TradeDirection.Sell, slippage = 0}) {
        await this.whenReady()
        const params = {sellingAsset: selling, buyingAsset: buying, amount: amount.toString()}
        const quote = direction === TradeDirection.Buy ?
            await this.axis.api.quoteBuy(params) :
            await this.axis.api.quoteSell(params)
        const best = quote.paths?.[0]
        if (quote.status !== 'success' || !best?.path?.length)
            throw new Error(quote.error || 'No route available')
        const path = best.path.map(hop => ({asset: hop.buying, orders: hop.orders.filter(Boolean).map(id => BigInt(id))}))
        const tolerance = BigInt(Math.round(slippage * 10_000))
        let sellingAmount = BigInt(best.sold)
        let buyingAmount = BigInt(best.bought)
        if (direction === TradeDirection.Buy) {
            sellingAmount = (sellingAmount * (10_000n + tolerance) + 9_999n) / 10_000n
        } else {
            buyingAmount = buyingAmount * (10_000n - tolerance) / 10_000n
        }
        //`sellingAmount` is the exact spend of a sell and the most a buy may spend
        const approve = await this.planApproval(selling, sellingAmount)
        if (approve) {
            this.emit('approve', {asset: selling, ...approve})
        }
        const client = await this.client()
        const [sold, bought] = await client.swap({
            direction,
            trader: this.address,
            selling,
            sellingAmount,
            buyingAmount,
            path,
            approve
        })
        this.spent.set(selling, Date.now())
        return {sold, bought, approve}
    }

    /**
     * Compute approval for a call
     * @param {string} asset - Token contract id
     * @param {bigint} required - Max amount the call may spend
     * @return {Promise<{amount: bigint, liveUntil: number}|undefined>}
     */
    async planApproval(asset, required) {
        await this.whenReady()
        const backing = this.backing.get(asset)
        let allowance
        if (this.isAllowanceCurrent(asset) || (backing?.updated && !this.axis.tokenBalances)) {
            allowance = backing.allowance
        } else {
            const {tokenBalances} = this.axis
            if (!tokenBalances)
                throw new Error(`The allowance of ${this.address} in ${asset} is not tracked: set the \`rpcUrl\` option to read it`)
            await this.axis.getContractId() //the allowance spender
            allowance = await tokenBalances.getAllowance(asset, this.address).catch(() => 0n) //unknown: a redundant approval, never a shortfall
        }
        return planApproval({
            required,
            committed: this.committed(asset),
            allowance,
            liveUntil: backing?.liveUntil ?? 0,
            ledger: await this.axis.getLedger()
        })
    }

    /**
     * Check whether the pushed allowance of a token can be used as is
     * @param {string} asset - Token contract id
     * @return {boolean}
     * @private
     */
    isAllowanceCurrent(asset) {
        const backing = this.backing.get(asset)
        if (!this.live || !this.axis.stream.connected || !backing?.updated || backing.pending)
            return false
        const spent = this.spent.get(asset)
        if (spent === undefined)
            return true
        if (Date.now() - spent < 30_000) //the spend lowers the allowance before the push reporting it arrives
            return false //TODO: try to read allowance change from tx result meta changes
        this.spent.delete(asset)
        return true
    }

    /**
     * @param {number} direction
     * @param {TradeParams} params
     * @return {Promise<TradeResult>}
     * @private
     */
    async trade(direction, params) {
        const {payload, planned} = await this.prepareTrade(direction, params)
        const {selling, buying, amount, price, expires, approve} = payload
        if (planned && approve) {
            this.emit('approve', {asset: selling, ...approve})
        }
        const client = await this.client()
        const [sold, bought, createdId] = direction === TradeDirection.Buy ?
            await client.buy(payload) :
            await client.sell(payload)
        this.spent.set(selling, Date.now())
        let order
        if (createdId) {
            order = await this.trackCreated(createdId, {direction, selling, buying, amount, price, sold, bought, expires})
        }
        return {sold, bought, orderId: createdId ? createdId.toString() : undefined, order, approve}
    }

    /**
     * Resolve the crossing orders, the price of a market order and the approval of a trade
     * @param {number} direction
     * @param {TradeParams} params
     * @return {Promise<{payload: import('./index.js').TradeArguments, planned: boolean}>} - Contract call arguments,
     * `planned` if the approval was planned by the account rather than supplied
     * @private
     */
    async prepareTrade(direction, {selling, buying, amount, price, kind, expires, orders, approve}) {
        await this.whenReady()
        amount = BigInt(amount)
        const market = price === undefined || price === null
        if (kind === undefined) {
            kind = market ? OrderKind.Fill : OrderKind.Limit
        }
        let crossing
        if (!orders || market) {
            //a limit order crosses only the orders its price reaches (the contract threshold: the price of a buy, the
            //inverted price of a sell) and rests with the remainder, so a partial crossing is quoted as well
            const maxPrice = market ? undefined : direction === TradeDirection.Buy ? BigInt(price) : invertPrice(BigInt(price))
            crossing = await this.findQuote(direction, selling, buying, amount, maxPrice)
        }
        if (market) {
            //cross everything the quote found: the limit is the worst maker price (makers price `selling` per
            //`buying` of a buyer; seen from a seller, invert it)
            if (!crossing.worstPrice)
                throw new Error('Not enough liquidity for a market order')
            price = direction === TradeDirection.Buy ? crossing.worstPrice : invertPrice(crossing.worstPrice)
        }
        price = BigInt(price)
        const planned = approve === undefined
        if (planned) {
            const required = direction === TradeDirection.Buy ? maxQuoteSpend(amount, price) : amount
            approve = await this.planApproval(selling, required)
        }
        const payload = {
            kind,
            trader: this.address,
            amount,
            selling,
            buying,
            price,
            orders: (orders ?? crossing.orders).map(id => BigInt(id)),
            expires,
            approve: approve || undefined
        }
        return {payload, planned}
    }

    /**
     * Count an order this client created as committed until the indexer reports it
     * @param {bigint} id
     * @param {{}} trade - Trade parameters and result, for an estimate if the order cannot be read
     * @return {Promise<AccountOrder|undefined>}
     * @private
     */
    async trackCreated(id, {direction, selling, buying, amount, price, sold, bought, expires}) {
        const key = id.toString()
        if (this.orders.has(key))
            return this.orders.get(key) //already reported
        let stored
        try {
            const client = await this.client()
            stored = await client.order(id)
        } catch (e) {
            //estimate below
        }
        if (this.orders.has(key))
            return this.orders.get(key)
        let orderAmount
        let orderPrice
        if (stored) {
            orderAmount = stored.amount
            orderPrice = stored.price
        } else if (direction === TradeDirection.Sell) {
            orderAmount = amount - sold
            orderPrice = price
        } else {
            //the remainder of a buy sells `selling` for the rest of `buying` at the limit
            orderAmount = maxQuoteSpend(amount - bought, price)
            orderPrice = invertPrice(price)
        }
        const now = Date.now()
        /** @type {AccountOrder} */
        const order = {
            id: key,
            owner: this.address,
            selling,
            buying,
            market: pairKey(selling, buying),
            status: 'ACTIVE',
            price: orderPrice,
            amount: orderAmount,
            quote: orderAmount,
            expires: Number(stored?.expires ?? expires ?? 0),
            created: now,
            updated: now,
            cursor: undefined,
            backed: null,
            backedPct: null,
            backingPending: true,
            filledPct: 0,
            pending: true
        }
        this.local.set(key, {order, expires: now + LOCAL_ORDER_TTL})
        this.emit('pending', order)
        this.emit('change')
        return order
    }

    /**
     * Crossing orders of a direct-market trade and the worst price among them
     * @param {number} direction
     * @param {string} selling
     * @param {string} buying
     * @param {bigint} amount - `selling` amount of a sell, `buying` amount of a buy
     * @param {bigint} [maxPrice] - Highest maker price to cross, for a limit order
     * @return {Promise<{orders: string[], worstPrice: bigint|null}>}
     * @private
     */
    async findQuote(direction, selling, buying, amount, maxPrice) {
        const params = {sellingAsset: selling, buyingAsset: buying, amount: amount.toString(), direct: true, maxPrice}
        try {
            const quote = direction === TradeDirection.Buy ?
                await this.axis.api.quoteBuy(params) :
                await this.axis.api.quoteSell(params)
            const hop = quote.status === 'success' ? quote.paths?.[0]?.path?.[0] : null
            if (hop)
                return {orders: hop.orders ?? [], worstPrice: hop.worstPrice ? BigInt(hop.worstPrice) : null}
        } catch (e) {
            //nothing to cross: a limit order simply rests
        }
        return {orders: [], worstPrice: null}
    }

    /**
     * @return {Promise<AxisContractClient>}
     * @private
     */
    async client() {
        if (!this.signTransaction)
            throw new Error(`No signTransaction callback for ${this.address}: pass it to axis.account()`)
        return this.axis.contractClient({publicKey: this.address, signTransaction: this.signTransaction})
    }

    /**
     * @param {number} [timeout]
     * @return {Promise<void>}
     * @private
     */
    async whenReady(timeout = READY_TIMEOUT) {
        if (this.loaded)
            return
        let timer
        try {
            await Promise.race([
                this.ready,
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('The account state is not available: check the AXIS API connection')), timeout)
                })
            ])
        } finally {
            clearTimeout(timer)
        }
    }

    /**
     * @param {StreamMessage} message
     * @private
     */
    handle(message) {
        switch (message.type) {
            case 'account':
                this.live = true
                return this.applySnapshot(message)
            case 'order':
                return this.applyOrder(message)
            case 'backing':
                return this.applyBacking(message)
            case 'trade':
                return this.emit('trade', message.trade)
            case 'swap':
                return this.emit('swap', message.swap)
            case 'error':
                return this.emit('error', new Error(message.error))
        }
    }

    /**
     * Replace the state with a snapshot
     * @param {ApiAccount} state
     * @param {boolean} [mergeBacking] - Keep the tokens missing from the snapshot
     * @private
     */
    applySnapshot(state, mergeBacking = false) {
        const previous = this.orders
        const next = new Map()
        for (const raw of state.orders || []) {
            const order = parseApiOrder(raw)
            next.set(order.id, order)
            this.local.delete(order.id)
        }
        this.orders = next
        const backing = mergeBacking ? new Map(this.backing) : new Map()
        for (const [asset, raw] of Object.entries(state.backing || {})) {
            backing.set(asset, parseBacking(asset, raw))
        }
        this.backing = backing
        if (this.loaded) {
            for (const [id, order] of previous) {
                if (!next.has(id)) {
                    this.emit('remove', order)
                }
            }
            for (const [id, order] of next) {
                if (!previous.has(id)) {
                    this.emit('new', order)
                }
            }
        }
        if (!this.loaded) {
            this.loaded = true
            this.resolveReady()
            this.emit('ready')
        }
        this.emit('change')
    }

    /**
     * @param {{action: string, order: import('./api-client.js').ApiOrder, fill?: {}}} message
     * @private
     */
    applyOrder({action, order: raw, fill: rawFill}) {
        const order = parseApiOrder(raw)
        this.local.delete(order.id)
        const previous = this.orders.get(order.id)
        const removed = action === 'filled' || action === 'cancel' || action === 'expire'
        if (removed) {
            this.orders.delete(order.id)
        } else {
            if (previous && order.backed === null) {
                //the event serialization may lack the split; keep the last known one until the backing update
                order.backed = previous.backed
                order.backedPct = previous.backedPct
                order.backingPending = previous.backingPending
            }
            this.orders.set(order.id, order)
        }
        const fill = rawFill && {
            order,
            sold: BigInt(rawFill.sold),
            bought: BigInt(rawFill.bought),
            taker: rawFill.taker,
            trade: rawFill.trade?.toString(),
            ts: Number(rawFill.ts) * 1000,
            partial: action === 'fill'
        }
        this.emit(action, fill || order)
        if (removed) {
            this.emit('remove', order)
        }
        this.emit('order', {action, order, fill})
        this.emit('change')
    }

    /**
     * @param {{asset: string, backing: import('./api-client.js').ApiBacking|null, backed?: Object<string, string>}} message
     * @private
     */
    applyBacking({asset, backing: raw, backed}) {
        const backing = raw ? parseBacking(asset, raw) : undefined
        if (backing) {
            this.backing.set(asset, backing)
        } else {
            this.backing.delete(asset)
        }
        for (const [id, amount] of Object.entries(backed || {})) {
            const order = this.orders.get(id)
            if (!order)
                continue
            order.backed = BigInt(amount)
            order.backedPct = share(order.backed, order.amount)
            order.backingPending = !backing || backing.pending || !backing.updated
        }
        this.emit('backing', {asset, backing})
        this.emit('change')
    }

    /**
     * @return {Iterable<AccountOrder>}
     * @private
     */
    * allOrders() {
        yield* this.orders.values()
        yield* this.localOrders()
    }

    /**
     * Get local orders that haven't expired
     * @return {AccountOrder[]}
     * @private
     */
    localOrders() {
        const now = Date.now()
        const res = []
        for (const [id, {order, expires}] of this.local) {
            if (expires < now || this.orders.has(id)) {
                this.local.delete(id)
            } else {
                res.push(order)
            }
        }
        return res
    }

    /**
     * @private
     */
    startFallback() {
        if (this.fallbackTimer)
            return
        this.fallbackTimer = setInterval(() => {
            this.refresh().catch(() => {
                //retried on the next tick
            })
        }, this.axis.fallbackPollInterval)
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
 * Convert an API order to the client form (bigint amounts and prices, numeric timestamps)
 * @param {ApiOrder} raw
 * @return {AccountOrder}
 */
export function parseApiOrder(raw) {
    const amount = BigInt(raw.amount)
    const quote = BigInt(raw.quote ?? raw.amount)
    //unconfirmed until loaded, and while a reload confirming the latest event is due
    const confirmed = raw.backed !== undefined && !!raw.backing?.updated && !raw.backing?.pending
    const backed = raw.backed !== undefined ? BigInt(raw.backed) : null
    return {
        id: raw.id,
        owner: raw.owner,
        selling: raw.selling,
        buying: raw.buying,
        market: pairKey(raw.selling, raw.buying),
        status: raw.status,
        price: BigInt(raw.price),
        amount,
        quote,
        expires: raw.expires ? Math.floor(parseApiDate(raw.expires) / 1000) : 0,
        created: parseApiDate(raw.created),
        updated: parseApiDate(raw.updated),
        cursor: raw.cursor !== undefined ? BigInt(raw.cursor) : undefined,
        backed,
        backedPct: backed === null ? null : share(backed, amount),
        backingPending: !confirmed,
        filledPct: quote > 0n ? Math.max(0, Math.min(1, 1 - Number(amount * 10_000n / quote) / 10_000)) : 0,
        pending: false
    }
}

/**
 * @param {string} asset
 * @param {ApiBacking} raw
 * @return {AccountBacking}
 */
function parseBacking(asset, raw) {
    return {
        asset,
        balance: BigInt(raw.balance),
        allowance: BigInt(raw.allowance),
        liveUntil: raw.liveUntil || 0,
        authorized: raw.authorized !== false,
        budget: BigInt(raw.budget ?? 0),
        updated: parseApiDate(raw.updated),
        skipped: parseApiDate(raw.skipped),
        pending: raw.pending === true
    }
}

/**
 * @param {bigint} part
 * @param {bigint} total
 * @return {number} - 0..1
 */
function share(part, total) {
    if (total <= 0n)
        return 1
    return Math.max(0, Math.min(1, Number(part * 10_000n / total) / 10_000))
}

/**
 * @param {string|{base: string, quote: string}|string[]|undefined} market
 * @return {string|undefined}
 */
function toMarketKey(market) {
    if (!market)
        return undefined
    if (typeof market === 'string') {
        const [x, y] = market.split('/')
        return pairKey(x, y)
    }
    if (Array.isArray(market))
        return pairKey(market[0], market[1])
    return pairKey(market.base, market.quote)
}

/**
 * Newest first: unconfirmed local orders, then by creation position
 * @param {AccountOrder} x
 * @param {AccountOrder} y
 * @return {number}
 */
function newestFirst(x, y) {
    if (x.cursor === undefined || y.cursor === undefined)
        return (x.cursor === undefined ? 0 : 1) - (y.cursor === undefined ? 0 : 1) || y.created - x.created
    return x.cursor < y.cursor ? 1 : x.cursor > y.cursor ? -1 : 0
}

/**
 * @typedef {{}} AccountOrder - Open order of a tracked account
 * @property {string} id - Order id (decimal u128)
 * @property {string} owner - Maker address
 * @property {string} selling - Sold token
 * @property {string} buying - Bought token
 * @property {string} market - Market key
 * @property {'ACTIVE'|'FILLED'|'CANCELED'|'EXPIRED'} status - Current status
 * @property {bigint} price - `buying` per 1 `selling`, contract scale (18 decimals)
 * @property {bigint} amount - Amount of `selling` left
 * @property {bigint} quote - Amount of `selling` at creation
 * @property {number} expires - Expiration UNIX timestamp in seconds, 0 = none
 * @property {number} created - Creation time, UNIX milliseconds
 * @property {number} updated - Last change, UNIX milliseconds
 * @property {bigint} [cursor] - Paging cursor (undefined for unconfirmed local orders)
 * @property {bigint|null} backed - Share of the account budget in `selling` that backs the order
 * @property {number|null} backedPct - `backed / amount` (0..1), null when unknown
 * @property {boolean} backingPending - The backing is not confirmed yet
 * @property {number} filledPct - Filled share of the initial amount (0..1)
 * @property {boolean} pending - Created by this client, not reported by the indexer yet
 */

/**
 * @typedef {{}} AccountBacking - Balance and allowance of the account in a token, as tracked by the indexer
 * @property {string} asset
 * @property {bigint} balance - Spendable amount (balance minus reserve and liabilities)
 * @property {bigint} allowance - Allowance granted to the AXIS contract
 * @property {number} liveUntil - Ledger sequence the allowance lives until
 * @property {boolean} authorized - Whether the account can send and receive the token
 * @property {bigint} budget - min(balance, allowance), 0 when unauthorized or expired
 * @property {number} updated - Last load, UNIX milliseconds (0 = not loaded)
 * @property {number} skipped - Last skipped fill of an order selling the token, UNIX milliseconds (0 = none)
 * @property {boolean} pending - A reload confirming the latest change is due
 */

/**
 * @typedef {{}} AccountAllowance
 * @property {string} asset
 * @property {boolean} known - Whether the backing is tracked and loaded
 * @property {bigint} [balance]
 * @property {bigint} [allowance]
 * @property {number} [liveUntil]
 * @property {boolean} [authorized]
 * @property {boolean} [pending]
 * @property {bigint} [available] - min(balance, allowance)
 * @property {bigint} committed - Remaining amount of the open orders selling the token
 */

/**
 * @typedef {{}} AccountFill
 * @property {AccountOrder} order - Order after the fill
 * @property {bigint} sold - Amount of `selling` delivered
 * @property {bigint} bought - Amount of `buying` received
 * @property {string} taker - Taker address
 * @property {string} trade - Trade id
 * @property {number} ts - Trade time, UNIX milliseconds
 * @property {boolean} partial - Whether the order is still open
 */

/**
 * @typedef {{}} TradeParams
 * @property {string} selling - Token sent
 * @property {string} buying - Token received
 * @property {bigint|string} amount - `selling` amount of a sell, `buying` amount of a buy (raw units)
 * @property {bigint|string} [price] - Limit price, contract scale; omitted for a market order
 * @property {number} [kind] - {@link OrderKind}: `Limit` by default, `Fill` for a market order
 * @property {number} [expires] - Expiration UNIX timestamp (seconds) of the resting remainder
 * @property {Array<bigint|string>} [orders] - Counter orders to cross, looked up automatically when omitted
 * @property {Approval|null} [approve] - Explicit approval (`null` for none)
 */

/**
 * @typedef {{}} TradeResult
 * @property {bigint} sold - Amount of `selling` sent
 * @property {bigint} bought - Amount of `buying` received
 * @property {string} [orderId] - ID of the order created for a limit remainder
 * @property {AccountOrder} [order] - The created order (unconfirmed until the indexer reports it)
 * @property {Approval} [approve] - Approval granted with the trade
 */

/**
 * @typedef {{}} SwapParams
 * @property {string} selling - Token sent
 * @property {string} buying - Token received
 * @property {bigint|string} amount - `selling` amount of a sell, `buying` amount of a buy (raw units)
 * @property {number} [direction] - {@link TradeDirection}, `Sell` by default
 * @property {number} [slippage] - Price tolerance as a fraction (0.005 = 0.5%), 0 by default
 */
