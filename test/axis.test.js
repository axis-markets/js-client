import {Axis, AxisStreamClient, OrderKind, TradeDirection, canonicalPair, pairKey, compareAssets, invertTicker, planApproval, parseApiDate} from '../src/index.js'

const CONTRACT = 'CBJ747MKAGQO2LMJPOTCOONAWBLIIBSLOQE325R457TE5MIS6RTDJ4DC'
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
const EURC = 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ'
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const CETES = 'CC72F57YTPX76HAA64JQOEGHQAPSADQWSY5DWVBR66JINPFDLNCQYHIC'
const TRADER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const P = 10n ** 18n

/** In-memory WebSocket double: the test plays the server */
class MockWebSocket {
    static instances = []

    constructor(url) {
        this.url = url
        this.readyState = 0
        this.sent = []
        MockWebSocket.instances.push(this)
    }

    send(data) {
        this.sent.push(JSON.parse(data))
    }

    close() {
        if (this.readyState === 3)
            return
        this.readyState = 3
        this.onclose?.()
    }

    //server side
    open() {
        this.readyState = 1
        this.onopen?.()
    }

    push(message) {
        this.onmessage?.({data: JSON.stringify(message)})
    }

    lastSubscribe(channel) {
        return [...this.sent].reverse().find(m => m.op === 'subscribe' && m.channel === channel)
    }
}

function latestSocket() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/** Stub of fetch for the REST API */
function mockFetch(routes) {
    const calls = []
    globalThis.fetch = async url => {
        calls.push(url)
        const path = new URL(url).pathname
        const route = Object.keys(routes).find(r => path === r || path.startsWith(r + '/'))
        if (!route)
            return {ok: false, status: 404, statusText: 'Not found', json: async () => ({error: 'Not found', status: 404})}
        const body = typeof routes[route] === 'function' ? routes[route](url) : routes[route]
        return {ok: true, status: 200, json: async () => body}
    }
    return calls
}

const contractInfo = {
    frozen: false,
    markets: [
        {base: USDC, quote: XLM, created: '2026-09-01 00:00:00', refreshed: '2026-09-29 10:00:00'},
        {base: EURC, quote: CETES, created: '2026-09-01 00:00:00', refreshed: '2026-09-29 10:00:00'}
    ]
}

function apiOrder(id, overrides = {}) {
    return {
        id: String(id),
        status: 'ACTIVE',
        owner: TRADER,
        selling: XLM,
        buying: USDC,
        price: (P / 5n).toString(),
        quote: '1000000000',
        amount: '1000000000',
        backed: '1000000000',
        backing: {balance: '50000000000', allowance: '5000000000', liveUntil: 900_000, authorized: true, updated: '2026-09-29 10:00:00'},
        created: '2026-09-29 10:00:00',
        updated: '2026-09-29 10:00:00',
        cursor: String(id * 10),
        ...overrides
    }
}

const xlmBacking = {owner: TRADER, asset: XLM, balance: '50000000000', allowance: '5000000000', liveUntil: 900_000, authorized: true, budget: '5000000000', updated: '2026-09-29 10:00:00'}

/** Contract client double recording calls */
function stubContract() {
    const calls = []
    const stub = {
        calls,
        publicKey: TRADER,
        sellResult: [0n, 0n, undefined],
        storedOrder: undefined,
        async sell(payload) {
            calls.push(['sell', payload])
            return stub.sellResult
        },
        async buy(payload) {
            calls.push(['buy', payload])
            return stub.sellResult
        },
        async estimateSell(payload) {
            calls.push(['estimateSell', payload])
            return {fee: 600_000n, inclusionFee: 100_000n, resourceFee: 500_000n, sold: 0n, bought: 0n}
        },
        async estimateBuy(payload) {
            calls.push(['estimateBuy', payload])
            return {fee: 600_000n, inclusionFee: 100_000n, resourceFee: 500_000n, sold: 0n, bought: 0n}
        },
        async order(id) {
            calls.push(['order', id])
            return stub.storedOrder
        },
        async cancel(trader, ids) {
            calls.push(['cancel', trader, ids])
        },
        async update(params) {
            calls.push(['update', params])
            return params.updates.map(u => u.id)
        },
        async swap(params) {
            calls.push(['swap', params])
            return [params.sellingAmount, params.buyingAmount]
        },
        async requote(a, b) {
            calls.push(['requote', a, b])
        },
        async subsidize(params) {
            calls.push(['subsidize', params])
            return []
        }
    }
    return stub
}

function createAxis() {
    const axis = new Axis({apiUrl: 'http://aggregator.test', rpcUrl: 'http://rpc.test', contractId: CONTRACT, networkPassphrase: 'Test SDF Network ; September 2015', WebSocket: MockWebSocket})
    const contract = stubContract()
    axis.contractClient = () => contract
    const tokens = {allowance: 0n, ledger: 1000, reads: 0, ledgerReads: 0}
    axis.tokenBalances = {
        async getAllowance() {
            tokens.reads++
            return tokens.allowance
        },
        async getLatestLedger() {
            tokens.ledgerReads++
            return tokens.ledger
        }
    }
    return {axis, contract, tokens}
}

afterEach(() => {
    MockWebSocket.instances.length = 0
})

describe('canonical pair order', () => {
    test('follows the contract Address order, not string order', () => {
        expect(canonicalPair(CETES, EURC)).toEqual([EURC, CETES])
        expect(EURC > CETES).toBe(true)
        expect(pairKey(XLM, USDC)).toBe(`${USDC}/${XLM}`)
        expect(compareAssets(USDC, USDC)).toBe(0)
    })

    test('invertTicker flips prices and volumes', () => {
        const inverted = invertTicker({symbol: 'A/B', openPrice: '2', highPrice: '4', lowPrice: '1', lastPrice: '4', volume: '10', quoteVolume: '25', change: 100, avgPrice: '2.5', trades: 3})
        expect(inverted).toMatchObject({symbol: 'B/A', openPrice: '0.5', highPrice: '1', lowPrice: '0.25', lastPrice: '0.25', volume: '25', quoteVolume: '10', change: -50, avgPrice: '0.4', trades: 3})
    })

    test('parseApiDate reads the API UTC format', () => {
        expect(parseApiDate('2026-09-29 10:00:00')).toBe(Date.UTC(2026, 8, 29, 10))
        expect(parseApiDate(undefined)).toBe(0)
    })
})

describe('planApproval', () => {
    test('covers the call plus the committed orders, only when short', () => {
        expect(planApproval({required: 10n, committed: 90n, allowance: 100n, ledger: 1})).toBeUndefined()
        expect(planApproval({required: 11n, committed: 90n, allowance: 100n, ledger: 1})).toEqual({amount: 101n, liveUntil: 1 + 518_400})
    })

    test('renews an allowance about to expire', () => {
        expect(planApproval({required: 1n, committed: 0n, allowance: 100n, liveUntil: 2000, ledger: 1000})).toEqual({amount: 1n, liveUntil: 1000 + 518_400})
    })
})

describe('AxisStreamClient', () => {
    test('routes messages by topic and resubscribes after a reconnect', async () => {
        const stream = new AxisStreamClient('ws://x/ws', {WebSocket: MockWebSocket, minReconnectDelay: 1})
        const received = []
        stream.subscribe('account', {address: TRADER}, m => received.push(m))
        const first = latestSocket()
        first.open()
        const sub = first.lastSubscribe('account')
        expect(sub).toMatchObject({address: TRADER})
        first.push({type: 'account', id: sub.id, topic: 'account:' + TRADER, orders: [], backing: {}})
        first.push({type: 'order', topic: 'account:' + TRADER, action: 'new'})
        first.push({type: 'order', topic: 'account:OTHER', action: 'new'})
        expect(received.map(m => m.type)).toEqual(['account', 'order'])

        first.close()
        await new Promise(resolve => setTimeout(resolve, 10))
        const second = latestSocket()
        expect(second).not.toBe(first)
        second.open()
        expect(second.lastSubscribe('account')).toMatchObject({address: TRADER})
        stream.close()
    })

    test('delivers a subscription rejection and drops the subscription', () => {
        const stream = new AxisStreamClient('ws://x/ws', {WebSocket: MockWebSocket})
        const received = []
        stream.subscribe('account', {address: 'bad'}, m => received.push(m))
        const socket = latestSocket()
        socket.open()
        socket.push({type: 'error', id: socket.lastSubscribe('account').id, error: 'Invalid account address'})
        expect(received).toEqual([expect.objectContaining({type: 'error'})])
        expect(stream.subscriptions.size).toBe(0)
        stream.close()
    })
})

describe('Axis', () => {
    test('loads the contract state, follows changes and finds markets in either order', async () => {
        mockFetch({'/contract': contractInfo})
        const {axis} = createAxis()
        const markets = []
        axis.on('market', e => markets.push(e.market.key))
        await axis.connect()
        expect(axis.getMarket(XLM, USDC).key).toBe(`${USDC}/${XLM}`)
        expect(axis.getMarket(CETES, EURC)).toMatchObject({base: EURC, quote: CETES})
        expect(axis.getMarket(USDC, EURC)).toBeUndefined()

        const socket = latestSocket()
        socket.open()
        const sub = socket.lastSubscribe('contract')
        const frozen = []
        axis.on('frozen', value => frozen.push(value))
        socket.push({type: 'contract', id: sub.id, topic: 'contract', data: contractInfo})
        socket.push({
            type: 'contract', topic: 'contract', kind: 'market',
            data: {...contractInfo, frozen: true, markets: [...contractInfo.markets, {base: USDC, quote: EURC, created: '2026-09-29 11:00:00', refreshed: '2026-09-29 11:00:00'}]}
        })
        expect(frozen).toEqual([true])
        expect(axis.frozen).toBe(true)
        expect(markets).toEqual([`${USDC}/${XLM}`, `${EURC}/${CETES}`, `${USDC}/${EURC}`])
        axis.close()
    })

    describe('contract address', () => {
        const OTHER = 'CA6P26K4QNNIMTYP22ILTSCXQQDEKNWJIZJPC34YEZYOLBNT7YUPX7XS'

        function createUnbound() {
            return new Axis({apiUrl: 'http://aggregator.test', rpcUrl: 'http://rpc.test', networkPassphrase: 'Test SDF Network ; September 2015', WebSocket: MockWebSocket})
        }

        test('comes from the AXIS API when the option is not set', async () => {
            mockFetch({'/contract': {...contractInfo, address: CONTRACT}})
            const axis = createUnbound()
            expect(axis.contractId).toBeUndefined()
            expect(await axis.getContractId()).toBe(CONTRACT)
            expect(axis.loaded).toBe(true)
            expect(axis.tokenBalances.spender).toBe(CONTRACT)
            axis.close()
        })

        test('fails the connection when the AXIS API does not report it', async () => {
            mockFetch({'/contract': contractInfo})
            const axis = createUnbound()
            await expect(axis.connect()).rejects.toThrow('set the `contractId` option')
            expect(axis.loaded).toBe(false)
            axis.close()
        })

        test('fails the connection when the AXIS API tracks another contract', async () => {
            mockFetch({'/contract': {...contractInfo, address: OTHER}})
            const {axis} = createAxis()
            await expect(axis.connect()).rejects.toThrow(`tracks contract ${OTHER}, not ${CONTRACT}`)
            expect(axis.loaded).toBe(false)
            axis.close()
        })

        test('ignores a pushed snapshot of another contract after connecting', async () => {
            mockFetch({'/contract': {...contractInfo, address: CONTRACT}})
            const {axis} = createAxis()
            await axis.connect()
            const socket = latestSocket()
            socket.open()
            socket.push({type: 'contract', topic: 'contract', kind: 'freeze', data: {...contractInfo, address: OTHER, frozen: true}})
            expect(axis.frozen).toBe(false)
            expect(axis.contractId).toBe(CONTRACT)
            axis.close()
        })
    })

    test('tracks the ledger pushed with the contract state', async () => {
        mockFetch({'/contract': contractInfo})
        const {axis, tokens} = createAxis()
        const ledgers = []
        axis.on('ledger', ledger => ledgers.push(ledger))
        await axis.connect()
        //not pushed yet: read over RPC
        expect(await axis.getLedger()).toBe(1000)
        expect(tokens.ledgerReads).toBe(1)
        const socket = latestSocket()
        socket.open()
        socket.push({type: 'contract', id: socket.lastSubscribe('contract').id, topic: 'contract', ledger: 500, data: contractInfo})
        socket.push({type: 'ledger', topic: 'contract', ledger: 501})
        expect(ledgers).toEqual([500, 501])
        expect(await axis.getLedger()).toBe(501)
        expect(tokens.ledgerReads).toBe(1)
        //a stale ledger is not trusted
        axis.ledgerTime -= 61_000
        expect(await axis.getLedger()).toBe(1000)
        axis.close()
    })

    test('market depth passes the price step to REST and the push API', async () => {
        const calls = mockFetch({'/contract': contractInfo, '/depth': {step: '0.05', bids: [], asks: []}})
        const {axis} = createAxis()
        await axis.connect()
        const market = axis.getMarket(XLM, USDC)
        await market.getDepth({base: XLM, depth: 100, step: '0.05', limit: 20})
        const url = new URL(calls.find(c => c.includes('/depth')))
        expect(Object.fromEntries(url.searchParams)).toEqual({market: `${XLM}/${USDC}`, depth: '100', step: '0.05', limit: '20'})
        const socket = latestSocket()
        socket.open()
        market.subscribeDepth({base: XLM, step: '0.001'}, () => {})
        expect(socket.lastSubscribe('depth')).toMatchObject({market: `${XLM}/${USDC}`, step: '0.001'})
        axis.close()
    })

    test('market candles stream the snapshot, then the changed candles', async () => {
        mockFetch({'/contract': contractInfo})
        const {axis} = createAxis()
        await axis.connect()
        const market = axis.getMarket(XLM, USDC)
        const socket = latestSocket()
        socket.open()
        const received = []
        market.subscribeCandles({base: XLM, resolution: '1h', limit: 2}, (candles, snapshot) => received.push([candles, snapshot]))
        const sub = socket.lastSubscribe('candles')
        expect(sub).toMatchObject({market: `${XLM}/${USDC}`, resolution: '1h', limit: 2})
        const topic = `candles:${XLM}/${USDC}/3600`
        const first = [3600, '0.2', '0.2', '0.2', '0.2', '100', '20', 1]
        const current = [7200, '0.3', '0.3', '0.25', '0.25', '200', '55', 2]
        socket.push({type: 'candles', id: sub.id, topic, market: `${XLM}/${USDC}`, resolution: 3600, candles: [first]})
        socket.push({type: 'candle', topic, market: `${XLM}/${USDC}`, resolution: 3600, candle: current})
        expect(received).toEqual([[[first], true], [[current], false]])
        axis.close()
    })

    test('market requote and subsidize use the canonical asset order', async () => {
        mockFetch({'/contract': contractInfo})
        const {axis, contract} = createAxis()
        await axis.connect()
        const market = axis.getMarket(CETES, EURC)
        await market.requote()
        await market.subsidize({amount: 18_000n})
        expect(contract.calls).toEqual([
            ['requote', EURC, CETES],
            ['subsidize', {sponsor: TRADER, selling: EURC, buying: CETES, amount: 18_000n}]
        ])
        axis.close()
    })
})

describe('AxisAccount', () => {
    async function setup(orders = [apiOrder(1)]) {
        const calls = mockFetch({
            '/contract': contractInfo,
            '/quote': {status: 'success', paths: [{sold: '0', bought: '0', path: [{selling: XLM, buying: USDC, orders: ['77'], worstPrice: (P / 4n).toString()}]}]}
        })
        const ctx = createAxis()
        const account = ctx.axis.account(TRADER, {signTransaction: async () => ({signedTxXdr: ''})})
        const socket = latestSocket()
        socket.open()
        const sub = socket.lastSubscribe('account')
        const events = []
        for (const event of ['new', 'pending', 'fill', 'filled', 'update', 'cancel', 'expire', 'remove', 'backing', 'approve']) {
            account.on(event, payload => events.push([event, payload?.id ?? payload?.order?.id ?? payload?.asset]))
        }
        socket.push({type: 'account', id: sub.id, topic: 'account:' + TRADER, address: TRADER, ledger: 1, orders, backing: {[XLM]: xlmBacking}})
        await account.ready
        return {...ctx, account, socket, events, calls, topic: 'account:' + TRADER}
    }

    test('keeps the open orders and backing in memory from the snapshot', async () => {
        const {account, axis} = await setup([apiOrder(1), apiOrder(2, {selling: USDC, buying: XLM, amount: '300', quote: '600', backed: '300', cursor: '5'})])
        expect(account.getOrders().map(o => o.id)).toEqual(['1', '2']) //newest first by cursor
        expect(account.getOrders({market: [XLM, USDC]}).length).toBe(2)
        expect(account.getOrders({selling: USDC}).map(o => o.id)).toEqual(['2'])
        expect(account.getOrder('2')).toMatchObject({amount: 300n, filledPct: 0.5, backedPct: 1, backingPending: false})
        expect(account.getAllowance(XLM)).toMatchObject({known: true, allowance: 5_000_000_000n, committed: 1_000_000_000n, available: 5_000_000_000n})
        expect(await axis.getOrder(2n)).toBe(account.getOrder('2'))
        axis.close()
    })

    test('emits order lifecycle events and applies the backing split', async () => {
        const {account, socket, events, topic, axis} = await setup()
        socket.push({type: 'order', topic, action: 'new', order: apiOrder(3, {cursor: '40', backed: '0', backing: {...apiOrder(3).backing, pending: true}})})
        expect(account.getOrder('3').backingPending).toBe(true)
        socket.push({type: 'backing', topic, asset: XLM, backing: xlmBacking, backed: {'1': '1000000000', '3': '1000000000'}})
        expect(account.getOrder('3')).toMatchObject({backed: 1_000_000_000n, backedPct: 1, backingPending: false})
        socket.push({type: 'order', topic, action: 'fill', order: apiOrder(1, {amount: '400000000'}), fill: {sold: '600000000', bought: '120000000', taker: 'GT', trade: '9', ts: 1_790_000_000}})
        socket.push({type: 'order', topic, action: 'filled', order: apiOrder(1, {amount: '0', status: 'FILLED'}), fill: {sold: '400000000', bought: '80000000', taker: 'GT', trade: '10', ts: 1_790_000_001}})
        socket.push({type: 'order', topic, action: 'cancel', order: apiOrder(3, {status: 'CANCELED'})})
        expect(events).toEqual([
            ['new', '3'],
            ['backing', XLM],
            ['fill', '1'],
            ['filled', '1'],
            ['remove', '1'],
            ['cancel', '3'],
            ['remove', '3']
        ])
        expect(account.getOrders()).toEqual([])
        axis.close()
    })

    test('a sell crosses the quoted orders and approves the trade plus the resting orders', async () => {
        const {account, contract, tokens, events, socket, topic, axis} = await setup()
        //the pushed allowance covers the resting order only
        socket.push({type: 'backing', topic, asset: XLM, backing: {...xlmBacking, allowance: '1000000000'}, backed: {'1': '1000000000'}})
        contract.sellResult = [0n, 0n, 55n]
        contract.storedOrder = {id: 55n, amount: 500_000_000n, price: P / 5n, expires: 0n}
        const res = await account.sell({selling: XLM, buying: USDC, amount: 500_000_000n, price: P / 5n})
        const [, payload] = contract.calls.find(c => c[0] === 'sell')
        expect(payload).toMatchObject({kind: OrderKind.Limit, trader: TRADER, orders: [77n], price: P / 5n})
        expect(payload.approve).toEqual({amount: 1_500_000_000n, liveUntil: 1000 + 518_400})
        expect(res).toMatchObject({orderId: '55', order: {id: '55', pending: true, amount: 500_000_000n}})
        //the unconfirmed order counts as committed until the indexer reports it
        expect(account.committed(XLM)).toBe(1_500_000_000n)
        expect(events).toContainEqual(['approve', XLM])
        expect(events).toContainEqual(['pending', '55'])
        expect(tokens.reads).toBe(0)
        axis.close()
    })

    test('a limit order quotes the crossing up to its price threshold', async () => {
        const {account, calls, tokens, axis} = await setup([])
        tokens.allowance = 10n ** 12n
        const quoteParams = () => new URL(calls.filter(url => url.includes('/quote')).at(-1)).searchParams
        //a sell crosses makers priced up to the inverted limit, like the contract
        await account.sell({selling: XLM, buying: USDC, amount: 500_000_000n, price: P / 5n})
        expect(quoteParams().get('direct')).toBe('true')
        expect(quoteParams().get('maxPrice')).toBe((5n * P).toString())
        //a buy crosses makers priced up to the limit itself
        await account.buy({selling: USDC, buying: XLM, amount: 100n, price: P / 4n})
        expect(quoteParams().get('maxPrice')).toBe((P / 4n).toString())
        //a market order quotes the full amount without a limit
        await account.buy({selling: USDC, buying: XLM, amount: 100n})
        expect(quoteParams().has('maxPrice')).toBe(false)
        axis.close()
    })

    test('a trade estimate simulates the same call without side effects', async () => {
        const {account, contract, events, socket, topic, axis} = await setup()
        socket.push({type: 'backing', topic, asset: XLM, backing: {...xlmBacking, allowance: '1000000000'}, backed: {'1': '1000000000'}})
        const estimate = await account.estimateSell({selling: XLM, buying: USDC, amount: 500_000_000n, price: P / 5n})
        expect(estimate.fee).toBe(600_000n)
        const [, payload] = contract.calls.find(c => c[0] === 'estimateSell')
        expect(payload).toMatchObject({kind: OrderKind.Limit, trader: TRADER, orders: [77n], price: P / 5n})
        expect(payload.approve).toEqual({amount: 1_500_000_000n, liveUntil: 1000 + 518_400})
        //nothing signed, no approval announced, nothing counted as spent
        expect(contract.calls.some(c => c[0] === 'sell')).toBe(false)
        expect(events).not.toContainEqual(['approve', XLM])
        expect(account.spent.has(XLM)).toBe(false)
        await account.estimateBuy({selling: USDC, buying: XLM, amount: 100n})
        expect(contract.calls.find(c => c[0] === 'estimateBuy')[1]).toMatchObject({kind: OrderKind.Fill, price: P / 4n})
        axis.close()
    })

    test('a market buy uses the worst quoted price and needs no approval when covered', async () => {
        const {account, contract, tokens, axis} = await setup([])
        tokens.allowance = 10n ** 12n
        await account.buy({selling: USDC, buying: XLM, amount: 100n})
        const [, payload] = contract.calls.find(c => c[0] === 'buy')
        expect(payload).toMatchObject({kind: OrderKind.Fill, price: P / 4n, orders: [77n]})
        expect(payload.approve).toBeUndefined()
        axis.close()
    })

    test('a sell of the inverted side inverts the worst price', async () => {
        const {account, contract, tokens, axis} = await setup([])
        tokens.allowance = 10n ** 12n
        await account.sell({selling: USDC, buying: XLM, amount: 100n})
        const [, payload] = contract.calls.find(c => c[0] === 'sell')
        expect(payload.price).toBe(4n * P)
        axis.close()
    })

    test('update raises the allowance by the extra commitment and cancelAll cancels a market', async () => {
        const {account, contract, socket, topic, axis} = await setup()
        socket.push({type: 'backing', topic, asset: XLM, backing: {...xlmBacking, allowance: '1000000000'}, backed: {'1': '1000000000'}})
        await account.update([{id: '1', amount: 1_200_000_000n}])
        const [, params] = contract.calls.find(c => c[0] === 'update')
        expect(params.updates).toEqual([{id: 1n, amount: 1_200_000_000n, price: P / 5n, expires: 0}])
        expect(params.approvals).toEqual([{asset: XLM, amount: 1_200_000_000n, liveUntil: 1000 + 518_400}])
        const canceled = await account.cancelAll({market: axis.getMarket(USDC, XLM)})
        expect(canceled).toEqual(['1'])
        expect(contract.calls.find(c => c[0] === 'cancel')).toEqual(['cancel', TRADER, [1n]])
        axis.close()
    })

    test('swap follows the quoted route with slippage and approval', async () => {
        const {account, contract, axis} = await setup([])
        mockFetch({'/quote': {status: 'success', paths: [{sold: '1000', bought: '5000', path: [{selling: USDC, buying: XLM, orders: ['1', '2']}, {selling: XLM, buying: EURC, orders: ['3']}]}]}})
        await account.swap({selling: USDC, buying: EURC, amount: 1000n, slippage: 0.01})
        const [, params] = contract.calls.find(c => c[0] === 'swap')
        expect(params).toMatchObject({
            direction: TradeDirection.Sell,
            sellingAmount: 1000n,
            buyingAmount: 4950n,
            path: [{asset: XLM, orders: [1n, 2n]}, {asset: EURC, orders: [3n]}],
            approve: {amount: 1000n}
        })
        axis.close()
    })

    test('plans approvals from the pushed allowance without RPC reads', async () => {
        const {account, contract, tokens, axis} = await setup()
        tokens.allowance = 0n //would require an approval if read
        await account.sell({selling: XLM, buying: USDC, amount: 1_000_000_000n, price: P / 5n})
        const [, payload] = contract.calls.find(c => c[0] === 'sell')
        expect(payload.approve).toBeUndefined() //5000 XLM allowance covers 100 + 100 XLM
        expect(tokens.reads).toBe(0)
        //no RPC at all: the pushed state is enough for a tracked token
        axis.tokenBalances = undefined
        axis.ledger = 1000
        account.spent.clear()
        expect(await account.planApproval(XLM, 10_000_000_000n)).toEqual({amount: 11_000_000_000n, liveUntil: 1000 + 518_400})
        await expect(account.planApproval(EURC, 1n)).rejects.toThrow('rpcUrl')
        axis.close()
    })

    test('reads the allowance over RPC right after a spend and while disconnected', async () => {
        const {account, tokens, socket, axis} = await setup()
        tokens.allowance = 10n ** 12n
        await account.sell({selling: XLM, buying: USDC, amount: 1_000_000_000n, price: P / 5n})
        expect(tokens.reads).toBe(0)
        //the push reporting the spend lags the call
        await account.planApproval(XLM, 1n)
        expect(tokens.reads).toBe(1)
        account.spent.set(XLM, Date.now() - 31_000)
        await account.planApproval(XLM, 1n)
        expect(tokens.reads).toBe(1)
        //changes are missed while disconnected
        socket.close()
        await account.planApproval(XLM, 1n)
        expect(tokens.reads).toBe(2)
        axis.close()
    })

    test('exposes the pushed balances and the account existence', async () => {
        const {account, socket, topic, axis} = await setup()
        expect(axis.nativeAsset).toBe(XLM)
        expect(account.getBalance(XLM)).toBe(50_000_000_000n)
        expect(account.getBalance(USDC)).toBeUndefined()
        expect(account.funded).toBe(true)
        socket.push({type: 'backing', topic, asset: USDC, backing: {owner: TRADER, asset: USDC, balance: '123', allowance: '0', liveUntil: 0, authorized: true, budget: '0', updated: '2026-09-29 10:00:01'}, backed: {}})
        expect([...account.balances]).toEqual([[XLM, 50_000_000_000n], [USDC, 123n]])
        //a missing account has no XLM entry
        socket.push({type: 'backing', topic, asset: XLM, backing: {...xlmBacking, balance: '0', authorized: false}, backed: {}})
        expect(account.funded).toBe(false)
        axis.close()
    })

    test('a REST snapshot keeps the balances it does not list', async () => {
        const {account, axis} = await setup()
        const usdc = {owner: TRADER, asset: USDC, balance: '7', allowance: '0', liveUntil: 0, authorized: true, budget: '0', updated: '2026-09-29 10:00:02'}
        mockFetch({'/account': {address: TRADER, ledger: 2, orders: [apiOrder(1)], backing: {[USDC]: usdc}}})
        await account.refresh()
        expect(account.getBalance(USDC)).toBe(7n)
        expect(account.getBalance(XLM)).toBe(50_000_000_000n)
        axis.close()
    })

    test('a snapshot after a reconnect reports orders changed meanwhile', async () => {
        const {account, socket, events, axis} = await setup([apiOrder(1)])
        socket.close()
        await new Promise(resolve => setTimeout(resolve, 1100))
        const next = latestSocket()
        next.open()
        const sub = next.lastSubscribe('account')
        next.push({type: 'account', id: sub.id, topic: 'account:' + TRADER, orders: [apiOrder(2)], backing: {}})
        expect(events).toEqual([['remove', '1'], ['new', '2']])
        expect(account.getOrders().map(o => o.id)).toEqual(['2'])
        axis.close()
    })
})
