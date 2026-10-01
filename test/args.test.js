import {Networks, xdr, nativeToScVal, scValToNative} from '@stellar/stellar-sdk'
import ContractClient from '../src/contract-client.js'
import {AxisContractClient, OrderKind, TradeDirection, orderId} from '../src/index.js'

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const ASSET_A = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
const ASSET_B = 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ'
const TRADER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

const client = new ContractClient({contractId: CONTRACT, rpcUrl: 'http://localhost', allowHttp: true, networkPassphrase: Networks.TESTNET})

const kind = value => value.type
//an id with the top bit set, as `orderId` yields for about half of all orders
const HIGH_ID = (1n << 127n) + 1n

function tradePayload(overrides = {}) {
    return {
        direction: TradeDirection.Sell,
        kind: OrderKind.Limit,
        trader: TRADER,
        amount: 1000n,
        selling: ASSET_A,
        buying: ASSET_B,
        price: 10n ** 18n,
        orders: [1n, 2n],
        nonce: 5n,
        expires: 0n,
        approve: undefined,
        ...overrides
    }
}

//safety admin entry points, never invoked through the client
const ADMIN = ['freeze', 'delegate', 'set_oracle', 'set_floor']
//client methods wrapping a contract function under another name
const RENAMED = {loadConfig: 'config', isFrozen: 'frozen', getMarket: 'market'}
const contractName = name => RENAMED[name] ?? name

describe('contract entry points', () => {
    test('the client mirrors every non-admin function of the embedded contract spec', () => {
        //`trade` is wrapped by `buy`/`sell`, the constructor is not a client call
        const skipped = ['trade', '__constructor', ...ADMIN]
        const fromSpec = client.spec.funcs().map(fn => fn.name.toString()).filter(name => !skipped.includes(name))
        const exposed = Object.getOwnPropertyNames(AxisContractClient.prototype).map(contractName)
        expect(fromSpec.filter(name => !exposed.includes(name))).toEqual([])
    })

    test('the client exposes no method the contract spec lacks', () => {
        //`cancel` is sugar over `update`, the contract has no such function; `publicKey` is the signing account
        const clientOnly = ['constructor', 'updateFootprint', 'updateTradeFootprint', 'buy', 'sell', 'cancel', 'publicKey']
        const fromSpec = client.spec.funcs().map(fn => fn.name.toString())
        const exposed = Object.getOwnPropertyNames(AxisContractClient.prototype).filter(name => !clientOnly.includes(name))
        expect(exposed.filter(name => !fromSpec.includes(contractName(name)))).toEqual([])
    })

    test('the client exposes no safety admin method', () => {
        const exposed = Object.getOwnPropertyNames(AxisContractClient.prototype).map(contractName)
        expect(exposed.filter(name => ADMIN.includes(name))).toEqual([])
    })
})

describe('contract argument encoding', () => {
    test('trade encodes u128 order ids, a u64 nonce, a u64 expiration and a void approval', () => {
        const vals = client.spec.funcArgsToScVals('trade', tradePayload({orders: [1n, HIGH_ID], expires: 1_900_000_000n}))
        expect(vals).toHaveLength(11)
        expect(vals.map(kind)).toEqual([
            'scvU32', 'scvU32', 'scvAddress', 'scvI128', 'scvAddress', 'scvAddress', 'scvI128', 'scvVec', 'scvU64', 'scvU64', 'scvVoid'
        ])
        expect(vals[7].vec.map(kind)).toEqual(['scvU128', 'scvU128'])
        expect(scValToNative(vals[7])).toEqual([1n, HIGH_ID])
        expect(scValToNative(vals[8])).toBe(5n)
        expect(scValToNative(vals[9])).toBe(1_900_000_000n)
    })

    test('trade encodes an approval as a struct map', () => {
        const approve = {asset: ASSET_A, amount: 500n, live_until: 12345}
        const vals = client.spec.funcArgsToScVals('trade', tradePayload({approve}))
        expect(kind(vals[10])).toBe('scvMap')
        expect(scValToNative(vals[10])).toEqual(approve)
    })

    test('update encodes OrderUpdate structs and a separate vector of approvals', () => {
        const update = {id: HIGH_ID, amount: 100n, price: 2n * 10n ** 18n, expires: 0n}
        const approval = {asset: ASSET_A, amount: 100n, live_until: 12345}
        const vals = client.spec.funcArgsToScVals('update', {trader: TRADER, updates: [update], approvals: [approval]})
        expect(vals.map(kind)).toEqual(['scvAddress', 'scvVec', 'scvVec'])
        const fields = Object.fromEntries(vals[1].vec[0].map.map(entry => [scValToNative(entry.key), kind(entry.val)]))
        expect(fields).toEqual({amount: 'scvI128', expires: 'scvU64', id: 'scvU128', price: 'scvI128'})
        expect(scValToNative(vals[1])).toEqual([update])
        const approvalFields = Object.fromEntries(vals[2].vec[0].map.map(entry => [scValToNative(entry.key), kind(entry.val)]))
        expect(approvalFields).toEqual({amount: 'scvI128', asset: 'scvAddress', live_until: 'scvU32'})
        expect(scValToNative(vals[2])).toEqual([approval])
        const empty = client.spec.funcArgsToScVals('update', {trader: TRADER, updates: [], approvals: []})
        expect(empty[2].vec).toEqual([])
    })

    test('requote and subsidize encode addresses', () => {
        const requote = client.spec.funcArgsToScVals('requote', {selling: ASSET_A, buying: ASSET_B})
        expect(requote.map(kind)).toEqual(['scvAddress', 'scvAddress'])
        const subsidize = client.spec.funcArgsToScVals('subsidize', {sponsor: TRADER, selling: ASSET_A, buying: ASSET_B, amount: 5n})
        expect(subsidize.map(kind)).toEqual(['scvAddress', 'scvAddress', 'scvAddress', 'scvI128'])
    })

    test('crossfill, order and swap steps use u128 ids', () => {
        const fill = client.spec.funcArgsToScVals('crossfill', {trader: TRADER, taker_order_id: HIGH_ID, orders: [3n]})
        expect(fill.map(kind)).toEqual(['scvAddress', 'scvU128', 'scvVec'])
        expect(fill[2].vec.map(kind)).toEqual(['scvU128'])
        const order = client.spec.funcArgsToScVals('order', {id: HIGH_ID})
        expect(kind(order[0])).toBe('scvU128')
        const swap = client.spec.funcArgsToScVals('swap', {
            direction: TradeDirection.Sell, trader: TRADER, selling: ASSET_A, selling_amount: 1n, buying_amount: 1n,
            path: [{asset: ASSET_B, orders: [HIGH_ID]}], approve: undefined
        })
        const step = Object.fromEntries(swap[5].vec[0].map.map(entry => [scValToNative(entry.key), entry.val]))
        expect(step.orders.vec.map(kind)).toEqual(['scvU128'])
    })

    test('tuple results decode to arrays', () => {
        const optionalId = nativeToScVal(HIGH_ID, {type: 'u128'})
        const trade = client.spec.funcResToNative('trade', xdr.ScVal.scvVec([nativeToScVal(1n, {type: 'i128'}), nativeToScVal(2n, {type: 'i128'}), optionalId]))
        expect(trade).toEqual([1n, 2n, HIGH_ID])
        const noRest = client.spec.funcResToNative('trade', xdr.ScVal.scvVec([nativeToScVal(1n, {type: 'i128'}), nativeToScVal(2n, {type: 'i128'}), xdr.ScVal.scvVoid()]))
        expect(noRest[2] ?? undefined).toBeUndefined()
        const fill = client.spec.funcResToNative('crossfill', xdr.ScVal.scvVec([1n, 2n, 3n].map(v => nativeToScVal(v, {type: 'i128'}))))
        expect(Array.isArray(fill)).toBe(true)
        expect(fill).toEqual([1n, 2n, 3n])
        const updated = client.spec.funcResToNative('update', xdr.ScVal.scvVec([nativeToScVal(HIGH_ID, {type: 'u128'})]))
        expect(updated).toEqual([HIGH_ID])
    })
})

describe('AxisContractClient argument mapping', () => {
    /** Replace the inner contract client with a recorder returning a canned result */
    function stub(axis, method, result) {
        const calls = []
        axis.client[method] = async (args, options) => {
            calls.push({args, options})
            return {
                simulation: {},
                built: null,
                signAndSend: async () => ({result})
            }
        }
        const footprints = []
        const tokens = []
        axis.updateFootprint = (tx, ...idLists) => footprints.push(idLists)
        axis.updateTradeFootprint = async (tx, traded, ...idLists) => {
            tokens.push(traded)
            footprints.push(idLists)
        }
        return {calls, footprints, tokens}
    }

    function makeClient() {
        return new AxisContractClient({publicKey: TRADER, contractId: CONTRACT, rpcUrl: 'http://localhost', networkPassphrase: Networks.TESTNET})
    }

    test('sell generates a nonce, passes the expiration, maps the approval and pre-declares the remainder order', async () => {
        const axis = makeClient()
        const {calls, footprints, tokens} = stub(axis, 'trade', [10n, 20n, 42n])
        const res = await axis.sell({
            kind: OrderKind.Limit, trader: TRADER, amount: 10n, selling: ASSET_A, buying: ASSET_B, price: 10n ** 18n,
            orders: [1n], expires: 1_900_000_000, approve: {amount: 1000n, liveUntil: 777}
        })
        expect(res).toEqual([10n, 20n, 42n])
        const {args, options} = calls[0]
        expect(options).toEqual({fee: '100000'})
        expect(args.direction).toBe(TradeDirection.Sell)
        expect(typeof args.nonce).toBe('bigint')
        expect(args.expires).toBe(1_900_000_000n)
        //the approval defaults to the selling asset
        expect(args.approve).toEqual({asset: ASSET_A, amount: 1000n, live_until: 777})
        expect(footprints[0]).toEqual([[1n], [orderId(TRADER, args.nonce)]])
        //the traded tokens are resolved together with the listed orders
        expect(tokens[0]).toEqual([ASSET_A, ASSET_B])
    })

    test('buy generates its own nonce, ignores a supplied one and skips the remainder for Fill trades', async () => {
        const axis = makeClient()
        const {calls, footprints} = stub(axis, 'trade', [10n, 20n, undefined])
        const before = BigInt(Date.now())
        const res = await axis.buy({kind: OrderKind.Fill, trader: TRADER, amount: 10n, selling: ASSET_A, buying: ASSET_B, price: 10n ** 18n, nonce: 99n})
        const after = BigInt(Date.now())
        expect(res).toEqual([10n, 20n, undefined])
        const {nonce} = calls[0].args
        expect(typeof nonce).toBe('bigint')
        expect(nonce).not.toBe(99n)
        expect(nonce >> 22n).toBeGreaterThanOrEqual(before)
        expect(nonce >> 22n).toBeLessThanOrEqual(after)
        expect(calls[0].args.orders).toEqual([])
        expect(calls[0].args.expires).toBe(0n)
        expect(calls[0].args.approve).toBeUndefined()
        expect(footprints[0]).toEqual([[], []])
    })

    test('consecutive trades get distinct nonces', async () => {
        const axis = makeClient()
        const {calls} = stub(axis, 'trade', [10n, 20n, undefined])
        const params = {kind: OrderKind.Fill, trader: TRADER, amount: 10n, selling: ASSET_A, buying: ASSET_B, price: 10n ** 18n}
        await axis.buy(params)
        await axis.buy(params)
        expect(calls[0].args.nonce).not.toBe(calls[1].args.nonce)
    })

    test('crossfill returns the profit and declares the taker and maker orders', async () => {
        const axis = makeClient()
        const {calls, footprints, tokens} = stub(axis, 'crossfill', [5n, 7n, 1n])
        expect(await axis.crossfill(TRADER, 9n, [1n, 2n])).toEqual([5n, 7n, 1n])
        expect(calls[0].args).toEqual({trader: TRADER, taker_order_id: 9n, orders: [1n, 2n]})
        expect(footprints[0]).toEqual([[9n], [1n, 2n]])
        //the pair comes from the taker order
        expect(tokens[0]).toEqual([])
    })

    test('swap maps camelCase amounts and the approval', async () => {
        const axis = makeClient()
        const {calls, footprints, tokens} = stub(axis, 'swap', [5n, 7n])
        const res = await axis.swap({
            direction: TradeDirection.Buy, trader: TRADER, selling: ASSET_A, sellingAmount: 100n, buyingAmount: 90n,
            path: [{asset: ASSET_B, orders: [3n]}], approve: {amount: 100n, liveUntil: 1}
        })
        expect(res).toEqual([5n, 7n])
        expect(calls[0].args).toEqual({
            direction: TradeDirection.Buy, trader: TRADER, selling: ASSET_A, selling_amount: 100n, buying_amount: 90n,
            path: [{asset: ASSET_B, orders: [3n]}], approve: {asset: ASSET_A, amount: 100n, live_until: 1}
        })
        expect(footprints[0]).toEqual([[3n]])
        expect(tokens[0]).toEqual([ASSET_A, ASSET_B])
    })

    test('an explicit approval asset is kept', async () => {
        const axis = makeClient()
        const {calls} = stub(axis, 'trade', [10n, 20n, undefined])
        await axis.buy({
            kind: OrderKind.Fill, trader: TRADER, amount: 10n, selling: ASSET_A, buying: ASSET_B, price: 10n ** 18n,
            approve: {asset: ASSET_B, amount: 5n, liveUntil: 9}
        })
        expect(calls[0].args.approve).toEqual({asset: ASSET_B, amount: 5n, live_until: 9})
    })

    test('update maps expirations and approvals, declares every updated id and returns the contract result', async () => {
        const axis = makeClient()
        const {calls, footprints} = stub(axis, 'update', [1n])
        const res = await axis.update({
            trader: TRADER,
            updates: [
                {id: 1n, amount: 5n, price: 6n, expires: 1_900_000_000},
                {id: 2n, amount: 0n, price: 0n}
            ],
            approvals: [{asset: ASSET_A, amount: 100n, liveUntil: 777}]
        })
        expect(res).toEqual([1n])
        expect(calls[0].args).toEqual({
            trader: TRADER,
            updates: [
                {id: 1n, amount: 5n, price: 6n, expires: 1_900_000_000n},
                {id: 2n, amount: 0n, price: 0n, expires: 0n}
            ],
            approvals: [{asset: ASSET_A, amount: 100n, live_until: 777}]
        })
        expect(footprints[0]).toEqual([[1n, 2n]])
        //the mapped payload is accepted by the contract spec
        expect(() => axis.client.spec.funcArgsToScVals('update', calls[0].args)).not.toThrow()
    })

    test('update sends no approvals by default and rejects one without an asset', async () => {
        const axis = makeClient()
        const {calls} = stub(axis, 'update', [])
        await axis.update({trader: TRADER, updates: [{id: 1n, amount: 5n, price: 6n}]})
        expect(calls[0].args.approvals).toEqual([])
        await expect(axis.update({
            trader: TRADER, updates: [], approvals: [{amount: 1n, liveUntil: 1}]
        })).rejects.toThrow(TypeError)
        expect(calls).toHaveLength(1)
    })

    test('cancel removes the orders through update', async () => {
        const axis = makeClient()
        const {calls, footprints} = stub(axis, 'update', [1n, HIGH_ID])
        expect(await axis.cancel(TRADER, [1n, HIGH_ID])).toBeUndefined()
        expect(calls[0].args).toEqual({
            trader: TRADER,
            updates: [
                {id: 1n, amount: 0n, price: 0n, expires: 0n},
                {id: HIGH_ID, amount: 0n, price: 0n, expires: 0n}
            ],
            approvals: []
        })
        expect(footprints[0]).toEqual([[1n, HIGH_ID]])
        expect(() => axis.client.spec.funcArgsToScVals('update', calls[0].args)).not.toThrow()
    })

    test('subsidize maps its arguments to contract names', async () => {
        const axis = makeClient()
        const subsidize = stub(axis, 'subsidize', [1n, 2n])
        expect(await axis.subsidize({sponsor: TRADER, selling: ASSET_A, buying: ASSET_B, amount: 5n})).toEqual([1n, 2n])
        expect(subsidize.calls[0].args).toEqual({sponsor: TRADER, selling: ASSET_A, buying: ASSET_B, amount: 5n})
    })

    test('loadConfig, isFrozen and getMarket read the config, frozen and market views', async () => {
        const axis = makeClient()
        const config = {oracle: ASSET_A, market_listing_fee: 90n, safety_admin: TRADER, min_trade_size: 0n}
        const markets = []
        axis.client.config = async () => ({simulation: {}, result: config})
        axis.client.frozen = async () => ({simulation: {}, result: false})
        axis.client.market = async args => {
            markets.push(args)
            return {simulation: {}, result: undefined}
        }
        expect(await axis.loadConfig()).toEqual(config)
        expect(await axis.isFrozen()).toBe(false)
        expect(await axis.getMarket(ASSET_A, ASSET_B)).toBeUndefined()
        expect(markets).toEqual([{selling: ASSET_A, buying: ASSET_B}])
    })

    test('requote returns undefined for an unknown pair', async () => {
        const axis = makeClient()
        stub(axis, 'requote', undefined)
        expect(await axis.requote(ASSET_A, ASSET_B)).toBeUndefined()
    })

    test('requote returns the updated market record', async () => {
        const axis = makeClient()
        const market = {
            a: {asset: ASSET_A, listed: true, decimals: 7},
            b: {asset: ASSET_B, listed: false, decimals: 0},
            created: 1n
        }
        const requote = stub(axis, 'requote', market)
        expect(await axis.requote(ASSET_A, ASSET_B)).toEqual(market)
        expect(requote.calls[0].args).toEqual({selling: ASSET_A, buying: ASSET_B})
    })

    test('requote returns the simulated record without sending when nothing changes', async () => {
        const axis = makeClient()
        const market = {a: {asset: ASSET_A, listed: true, decimals: 7}, b: {asset: ASSET_B, listed: true, decimals: 7}, created: 1n}
        axis.client.requote = async () => ({
            simulation: {},
            isReadCall: true,
            result: market,
            signAndSend: async () => {
                throw new Error('This is a read call. It requires no signature or sending.')
            }
        })
        expect(await axis.requote(ASSET_A, ASSET_B)).toEqual(market)
    })
})
