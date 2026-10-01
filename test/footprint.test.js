import {
    xdr,
    Address,
    Account,
    Asset,
    Contract,
    Keypair,
    Networks,
    SorobanDataBuilder,
    StrKey,
    TransactionBuilder,
    nativeToScVal,
    scValToBigInt
} from '@stellar/stellar-sdk'
import {
    allowanceLedgerKey,
    balanceLedgerKey,
    collectOrderIds,
    completeFootprint,
    decodeSacAsset,
    decodeStoredOrder,
    ensureOrdersFootprint,
    instanceLedgerKey,
    orderLedgerKey,
    MAKER_ENTRY_RESOURCE_FEE,
    MAKER_ENTRY_SIZE,
    MAKER_INSTRUCTIONS,
    MAKER_RESOURCE_FEE,
    ORDER_ENTRY_SIZE,
    ORDER_INSTRUCTIONS,
    ORDER_RESOURCE_FEE
} from '../src/footprint.js'
import {orderId} from '../src/order-id.js'

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const ACCOUNT = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const INCLUSION_FEE = 100000
const SIM_INSTRUCTIONS = 1_000_000
const SIM_WRITE_BYTES = 600
const SIM_RESOURCE_FEE = 50_000

const encode = key => key.toXDR('base64')

/** Non-order ledger keys that a real simulation would report */
function instanceKey() {
    return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
        contract: Address.fromString(CONTRACT).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent
    }))
}

function accountKey() {
    return xdr.LedgerKey.account(new xdr.LedgerKeyAccount({
        accountId: Keypair.fromPublicKey(ACCOUNT).xdrAccountId()
    }))
}

/**
 * Build a fake AssembledTransaction the way the SDK leaves it after a successful simulation
 * @param {xdr.LedgerKey[]} readOnly
 * @param {xdr.LedgerKey[]} readWrite
 */
function simulatedTx(readOnly, readWrite) {
    const transactionData = new SorobanDataBuilder()
        .setFootprint(readOnly, readWrite)
        .setResources(SIM_INSTRUCTIONS, 0, SIM_WRITE_BYTES)
        .setResourceFee(SIM_RESOURCE_FEE)
    const built = new TransactionBuilder(new Account(ACCOUNT, '1'), {
        fee: INCLUSION_FEE.toString(),
        networkPassphrase: Networks.TESTNET
    })
        .addOperation(new Contract(CONTRACT).call('trade'))
        .setTimeout(30)
        .setSorobanData(transactionData.build())
        .build()
    return {
        simulation: {
            transactionData,
            result: {auth: [], retval: xdr.ScVal.scvVoid()}
        },
        built,
        options: {timeoutInSeconds: 30}
    }
}

function footprintOf(tx) {
    return tx.simulation.transactionData.build().resources.footprint
}

describe('orderLedgerKey', () => {
    test('builds a persistent contract data key with u128 order id', () => {
        const key = orderLedgerKey(CONTRACT, 42n)
        expect(key.type).toBe('contractData')
        const data = key.contractData
        expect(Address.fromScAddress(data.contract).toString()).toBe(CONTRACT)
        expect(data.key.type).toBe('scvU128')
        expect(scValToBigInt(data.key)).toBe(42n)
        expect(data.durability.name).toBe('persistent')
    })

    test('encodes 128-bit ids', () => {
        for (const id of [(1n << 127n) + 1n, (1n << 128n) - 1n]) {
            expect(scValToBigInt(orderLedgerKey(CONTRACT, id).contractData.key)).toBe(id)
        }
    })

    test('matches the key of an id derived with the top bit set', () => {
        const id = orderId(ACCOUNT, 18446744073709551615n)
        expect(id >> 127n).toBe(1n)
        expect(encode(orderLedgerKey(CONTRACT, id).contractData.key)).toBe(encode(nativeToScVal(id, {type: 'u128'})))
    })

    test('accepts number and string ids', () => {
        expect(encode(orderLedgerKey(CONTRACT, 7))).toBe(encode(orderLedgerKey(CONTRACT, 7n)))
        expect(encode(orderLedgerKey(CONTRACT, '7'))).toBe(encode(orderLedgerKey(CONTRACT, 7n)))
    })
})

describe('collectOrderIds', () => {
    test('flattens, deduplicates and coerces to bigint', () => {
        expect(collectOrderIds([1n], [2, '3', 1n], undefined, null, [], [3n]))
            .toEqual([1n, 2n, 3n])
    })

    test('includes the taker id ahead of the maker ids', () => {
        expect(collectOrderIds([10n], [11n, 12n])).toEqual([10n, 11n, 12n])
    })

    test('skips undefined and null entries', () => {
        expect(collectOrderIds([undefined, 5n, null])).toEqual([5n])
    })
})

describe('ensureOrdersFootprint', () => {
    test('adds ids missing from the footprint to readWrite', () => {
        const tx = simulatedTx([instanceKey()], [accountKey(), orderLedgerKey(CONTRACT, 1n)])
        const added = ensureOrdersFootprint(tx, CONTRACT, [1n, 2n, 3n])
        expect(added).toBe(2)
        const fp = footprintOf(tx)
        expect(fp.readOnly.map(encode)).toEqual([encode(instanceKey())])
        expect(fp.readWrite.map(encode)).toEqual([
            encode(accountKey()),
            encode(orderLedgerKey(CONTRACT, 1n)),
            encode(orderLedgerKey(CONTRACT, 2n)),
            encode(orderLedgerKey(CONTRACT, 3n))
        ])
    })

    test('promotes readOnly order entries to readWrite', () => {
        const tx = simulatedTx([instanceKey(), orderLedgerKey(CONTRACT, 2n)], [orderLedgerKey(CONTRACT, 1n)])
        const added = ensureOrdersFootprint(tx, CONTRACT, [1n, 2n])
        expect(added).toBe(1)
        const fp = footprintOf(tx)
        expect(fp.readOnly.map(encode)).toEqual([encode(instanceKey())])
        expect(fp.readWrite.map(encode)).toEqual([
            encode(orderLedgerKey(CONTRACT, 1n)),
            encode(orderLedgerKey(CONTRACT, 2n))
        ])
    })

    test('scales resources and fee with the number of added entries only', () => {
        const tx = simulatedTx([], [orderLedgerKey(CONTRACT, 1n)])
        const added = ensureOrdersFootprint(tx, CONTRACT, [1n, 2n, 3n, 3n])
        expect(added).toBe(2)
        const data = tx.simulation.transactionData.build()
        expect(data.resources.instructions).toBe(SIM_INSTRUCTIONS + 2 * ORDER_INSTRUCTIONS)
        expect(data.resources.writeBytes).toBe(SIM_WRITE_BYTES + 2 * ORDER_ENTRY_SIZE)
        expect(data.resources.diskReadBytes).toBe(0)
        expect(data.resourceFee).toBe(BigInt(SIM_RESOURCE_FEE) + 2n * ORDER_RESOURCE_FEE)
    })

    test('caps declared instructions at the network limit', () => {
        const tx = simulatedTx([], [])
        tx.simulation.transactionData.setResources(399_000_000, 0, SIM_WRITE_BYTES)
        ensureOrdersFootprint(tx, CONTRACT, [1n, 2n])
        expect(tx.simulation.transactionData.build().resources.instructions).toBe(400_000_000)
    })

    test('is a no-op when every order is already read-write', () => {
        const tx = simulatedTx([instanceKey()], [orderLedgerKey(CONTRACT, 1n), orderLedgerKey(CONTRACT, 2n)])
        const before = tx.simulation.transactionData.build().toXDR('base64')
        const builtBefore = tx.built
        expect(ensureOrdersFootprint(tx, CONTRACT, [2n, 1n])).toBe(0)
        expect(tx.simulation.transactionData.build().toXDR('base64')).toBe(before)
        expect(tx.built).toBe(builtBefore)
    })

    test('does nothing without ids or for failed simulations', () => {
        const tx = simulatedTx([], [])
        expect(ensureOrdersFootprint(tx, CONTRACT, [])).toBe(0)
        expect(ensureOrdersFootprint(tx, CONTRACT, undefined)).toBe(0)
        const failed = {simulation: {error: 'boom'}, built: tx.built}
        expect(ensureOrdersFootprint(failed, CONTRACT, [1n])).toBe(0)
        const restore = {simulation: {restorePreamble: {}}, built: tx.built}
        expect(ensureOrdersFootprint(restore, CONTRACT, [1n])).toBe(0)
    })

    test('rebuilds tx.built with the patched data and consistent total fee', () => {
        const tx = simulatedTx([], [orderLedgerKey(CONTRACT, 1n)])
        tx.simulationTransactionData = tx.simulation.transactionData.build()
        expect(Number(tx.built.fee)).toBe(INCLUSION_FEE + SIM_RESOURCE_FEE)

        ensureOrdersFootprint(tx, CONTRACT, [1n, 2n])

        expect(tx.simulationTransactionData).toBeUndefined()
        const patched = tx.simulation.transactionData.build()
        const builtData = tx.built.toEnvelope().v1.tx.ext.sorobanData
        expect(builtData.toXDR('base64')).toBe(patched.toXDR('base64'))
        expect(Number(tx.built.fee)).toBe(INCLUSION_FEE + Number(patched.resourceFee))
        expect(tx.built.operations).toHaveLength(1)
        expect(tx.built.source).toBe(ACCOUNT)
        expect(tx.built.timeBounds.maxTime).not.toBe('0')
    })
})

describe('ORDER_ENTRY_SIZE', () => {
    test('covers a max-size stored order ledger entry', () => {
        const maxI128 = (1n << 127n) - 1n
        const maxU128 = (1n << 128n) - 1n
        const maxU64 = (1n << 64n) - 1n
        //positional vector [owner, selling, buying, amount, price, expires], an account owner is the larger address
        const val = storedOrder(ACCOUNT, CONTRACT, CONTRACT, {amount: maxI128, price: maxI128, expires: maxU64})
        const entry = new xdr.LedgerEntry({
            lastModifiedLedgerSeq: 0,
            data: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
                ext: xdr.ExtensionPoint.v0(),
                contract: Address.fromString(CONTRACT).toScAddress(),
                key: nativeToScVal(maxU128, {type: 'u128'}),
                durability: xdr.ContractDataDurability.persistent,
                val
            })),
            ext: xdr.LedgerEntryExt.v0()
        })
        const actual = entry.toXDR().length
        expect(ORDER_ENTRY_SIZE).toBeGreaterThanOrEqual(actual)
        //the documented entry size (about 264 bytes) must stay in the same ballpark
        expect(actual).toBeLessThanOrEqual(270)
    })
})

const DEX = 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ'
const ISSUER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(1)).publicKey()
const MAKER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(2)).publicKey()
const CONTRACT_MAKER = StrKey.encodeContract(new Uint8Array(32).fill(3))
const CUSTOM_TOKEN = StrKey.encodeContract(new Uint8Array(32).fill(4))
const USDC = new Asset('USDC', ISSUER)
const LONG = new Asset('LONGASSET01', ISSUER)
const USDC_TOKEN = USDC.contractId(Networks.TESTNET)
const XLM_TOKEN = Asset.native().contractId(Networks.TESTNET)
const LONG_TOKEN = LONG.contractId(Networks.TESTNET)

/** Stored order value: positional vector with `expires` only when set */
function storedOrder(owner, selling, buying, {amount = 100n, price = 10n ** 18n, expires = 0n} = {}) {
    const fields = [
        Address.fromString(owner).toScVal(),
        Address.fromString(selling).toScVal(),
        Address.fromString(buying).toScVal(),
        nativeToScVal(amount, {type: 'i128'}),
        nativeToScVal(price, {type: 'i128'})
    ]
    if (expires)
        fields.push(nativeToScVal(expires, {type: 'u64'}))
    return xdr.ScVal.scvVec(fields)
}

function contractDataEntry(key, val) {
    const data = key.contractData
    return {
        key,
        val: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
            ext: xdr.ExtensionPoint.v0(),
            contract: data.contract,
            key: data.key,
            durability: data.durability,
            val
        }))
    }
}

function orderEntry(id, owner, selling, buying) {
    return contractDataEntry(orderLedgerKey(DEX, id), storedOrder(owner, selling, buying))
}

/** Instance entry of a Stellar Asset Contract, as the SAC stores its asset info */
function sacInstance(asset) {
    let info
    if (asset.isNative()) {
        info = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Native')])
    } else {
        const code = asset.getCode()
        const padded = code.padEnd(code.length > 4 ? 12 : 4, '\0')
        info = xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol(code.length > 4 ? 'AlphaNum12' : 'AlphaNum4'),
            xdr.ScVal.scvMap([
                new xdr.ScMapEntry({key: xdr.ScVal.scvSymbol('asset_code'), val: xdr.ScVal.scvString(padded)}),
                new xdr.ScMapEntry({key: xdr.ScVal.scvSymbol('issuer'), val: xdr.ScVal.scvBytes(Keypair.fromPublicKey(asset.getIssuer()).rawPublicKey())})
            ])
        ])
    }
    return xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
        storage: [
            new xdr.ScMapEntry({key: xdr.ScVal.scvSymbol('METADATA'), val: xdr.ScVal.scvVoid()}),
            new xdr.ScMapEntry({key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('AssetInfo')]), val: info})
        ]
    }))
}

function wasmInstance() {
    return xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableWasm(new Uint8Array(32)),
        storage: null
    }))
}

function tokenEntries() {
    return [
        contractDataEntry(instanceLedgerKey(USDC_TOKEN), sacInstance(USDC)),
        contractDataEntry(instanceLedgerKey(XLM_TOKEN), sacInstance(Asset.native())),
        contractDataEntry(instanceLedgerKey(LONG_TOKEN), sacInstance(LONG)),
        contractDataEntry(instanceLedgerKey(CUSTOM_TOKEN), wasmInstance())
    ]
}

/** RPC stand-in answering `getLedgerEntries` from a fixed set of entries */
function mockServer(entries) {
    const index = new Map(entries.map(entry => [encode(entry.key), entry]))
    const requests = []
    return {
        requests,
        async getLedgerEntries(...keys) {
            requests.push(keys.map(encode))
            return {entries: keys.map(key => index.get(encode(key))).filter(Boolean), latestLedger: 1}
        }
    }
}

function trustline(account, asset) {
    return xdr.LedgerKey.trustline(new xdr.LedgerKeyTrustLine({
        accountId: Keypair.fromPublicKey(account).xdrAccountId(),
        asset: asset.toTrustLineXDRObject()
    }))
}

function accountEntryKey(account) {
    return xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId: Keypair.fromPublicKey(account).xdrAccountId()}))
}

describe('ledger keys', () => {
    test('balance of an account: account entry for XLM, trustline for a classic asset', () => {
        expect(encode(balanceLedgerKey(MAKER, XLM_TOKEN, Asset.native()))).toBe(encode(accountEntryKey(MAKER)))
        expect(encode(balanceLedgerKey(MAKER, USDC_TOKEN, USDC))).toBe(encode(trustline(MAKER, USDC)))
    })

    test('the issuer has no balance entry for its own asset', () => {
        expect(balanceLedgerKey(ISSUER, USDC_TOKEN, USDC)).toBeNull()
    })

    test('balance of a contract is a persistent Balance entry of the token', () => {
        const key = balanceLedgerKey(CONTRACT_MAKER, USDC_TOKEN, USDC).contractData
        expect(Address.fromScAddress(key.contract).toString()).toBe(USDC_TOKEN)
        expect(key.durability.name).toBe('persistent')
        expect(encode(key.key)).toBe(encode(xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'), Address.fromString(CONTRACT_MAKER).toScVal()])))
    })

    test('no balance key for a token of unknown layout', () => {
        expect(balanceLedgerKey(MAKER, CUSTOM_TOKEN, null)).toBeNull()
    })

    test('allowance is a temporary entry keyed by owner and spender', () => {
        const key = allowanceLedgerKey(MAKER, USDC_TOKEN, DEX).contractData
        expect(Address.fromScAddress(key.contract).toString()).toBe(USDC_TOKEN)
        expect(key.durability.name).toBe('temporary')
        const [name, map] = key.key.vec
        expect(name.sym.toString()).toBe('Allowance')
        expect(map.map.map(entry => entry.key.sym.toString())).toEqual(['from', 'spender'])
        expect(Address.fromScVal(map.map[0].val).toString()).toBe(MAKER)
        expect(Address.fromScVal(map.map[1].val).toString()).toBe(DEX)
    })

    test('instance key of a contract', () => {
        const key = instanceLedgerKey(USDC_TOKEN).contractData
        expect(key.key.type).toBe('scvLedgerKeyContractInstance')
        expect(key.durability.name).toBe('persistent')
    })
})

describe('decoders', () => {
    test('stored order with and without expiration', () => {
        expect(decodeStoredOrder(storedOrder(MAKER, USDC_TOKEN, XLM_TOKEN))).toEqual({owner: MAKER, selling: USDC_TOKEN, buying: XLM_TOKEN})
        expect(decodeStoredOrder(storedOrder(CONTRACT_MAKER, XLM_TOKEN, USDC_TOKEN, {expires: 1_900_000_000n})))
            .toEqual({owner: CONTRACT_MAKER, selling: XLM_TOKEN, buying: USDC_TOKEN})
    })

    test('asset of a Stellar Asset Contract', () => {
        expect(decodeSacAsset(sacInstance(Asset.native())).isNative()).toBe(true)
        const usdc = decodeSacAsset(sacInstance(USDC))
        expect([usdc.getCode(), usdc.getIssuer()]).toEqual(['USDC', ISSUER])
        //alphanum-12 codes lose their zero padding
        expect(decodeSacAsset(sacInstance(LONG)).getCode()).toBe('LONGASSET01')
    })

    test('no asset for a wasm token', () => {
        expect(decodeSacAsset(wasmInstance())).toBeNull()
    })
})

describe('completeFootprint', () => {
    function dexTx(readOnly = [], readWrite = []) {
        return simulatedTx(readOnly, readWrite)
    }

    test('declares the order and the entries its account maker needs', async () => {
        const server = mockServer([orderEntry(1n, MAKER, USDC_TOKEN, XLM_TOKEN), ...tokenEntries()])
        const tx = dexTx([instanceKey()])
        const added = await completeFootprint(tx, DEX, [1n], {server, tokens: [XLM_TOKEN, USDC_TOKEN]})
        expect(added).toEqual({orders: 1, makerEntries: 3})
        const fp = footprintOf(tx)
        expect(fp.readOnly.map(encode)).toEqual([encode(instanceKey())])
        expect(fp.readWrite.map(encode)).toEqual([
            encode(orderLedgerKey(DEX, 1n)),
            encode(trustline(MAKER, USDC)),
            encode(allowanceLedgerKey(MAKER, USDC_TOKEN, DEX)),
            encode(accountEntryKey(MAKER))
        ])
        const data = tx.simulation.transactionData.build()
        expect(data.resources.instructions).toBe(SIM_INSTRUCTIONS + ORDER_INSTRUCTIONS + MAKER_INSTRUCTIONS)
        expect(data.resources.writeBytes).toBe(SIM_WRITE_BYTES + ORDER_ENTRY_SIZE + 3 * MAKER_ENTRY_SIZE)
        //the trustline and the account are read from disk when applied, the contract entries are not
        expect(data.resources.diskReadBytes).toBe(2 * MAKER_ENTRY_SIZE)
        expect(data.resourceFee).toBe(BigInt(SIM_RESOURCE_FEE) + ORDER_RESOURCE_FEE + 3n * MAKER_ENTRY_RESOURCE_FEE + MAKER_RESOURCE_FEE)
        //orders and traded tokens are loaded in one request
        expect(server.requests).toHaveLength(1)
    })

    test('uses the token Balance entries of a contract maker', async () => {
        const server = mockServer([orderEntry(1n, CONTRACT_MAKER, XLM_TOKEN, USDC_TOKEN), ...tokenEntries()])
        const tx = dexTx()
        await completeFootprint(tx, DEX, [1n], {server})
        expect(footprintOf(tx).readWrite.map(encode)).toEqual([
            encode(orderLedgerKey(DEX, 1n)),
            encode(balanceLedgerKey(CONTRACT_MAKER, XLM_TOKEN, Asset.native())),
            encode(allowanceLedgerKey(CONTRACT_MAKER, XLM_TOKEN, DEX)),
            encode(balanceLedgerKey(CONTRACT_MAKER, USDC_TOKEN, USDC))
        ])
        //token Balance entries are contract data, not disk reads
        expect(tx.simulation.transactionData.build().resources.diskReadBytes).toBe(0)
    })

    test('adds no trustline for an issuer maker', async () => {
        const server = mockServer([orderEntry(1n, ISSUER, USDC_TOKEN, XLM_TOKEN), ...tokenEntries()])
        const tx = dexTx()
        const added = await completeFootprint(tx, DEX, [1n], {server})
        expect(added).toEqual({orders: 1, makerEntries: 2})
        expect(footprintOf(tx).readWrite.map(encode)).toEqual([
            encode(orderLedgerKey(DEX, 1n)),
            encode(allowanceLedgerKey(ISSUER, USDC_TOKEN, DEX)),
            encode(accountEntryKey(ISSUER))
        ])
    })

    test('declares the entries of a maker behind several orders once', async () => {
        const server = mockServer([
            orderEntry(1n, MAKER, USDC_TOKEN, XLM_TOKEN),
            orderEntry(2n, MAKER, USDC_TOKEN, XLM_TOKEN),
            ...tokenEntries()
        ])
        const tx = dexTx()
        const added = await completeFootprint(tx, DEX, [1n, 2n], {server})
        expect(added).toEqual({orders: 2, makerEntries: 3})
        const data = tx.simulation.transactionData.build()
        expect(data.resources.instructions).toBe(SIM_INSTRUCTIONS + 2 * ORDER_INSTRUCTIONS + MAKER_INSTRUCTIONS)
        expect(data.resourceFee).toBe(BigInt(SIM_RESOURCE_FEE) + 2n * ORDER_RESOURCE_FEE + 3n * MAKER_ENTRY_RESOURCE_FEE + MAKER_RESOURCE_FEE)
    })

    test('skips maker entries of tokens that are not Stellar Asset Contracts', async () => {
        const server = mockServer([orderEntry(1n, MAKER, USDC_TOKEN, CUSTOM_TOKEN), ...tokenEntries()])
        const tx = dexTx()
        const added = await completeFootprint(tx, DEX, [1n], {server})
        expect(added).toEqual({orders: 1, makerEntries: 2})
        expect(footprintOf(tx).readWrite.map(encode)).toEqual([
            encode(orderLedgerKey(DEX, 1n)),
            encode(trustline(MAKER, USDC)),
            encode(allowanceLedgerKey(MAKER, USDC_TOKEN, DEX))
        ])
    })

    test('promotes maker entries the simulation recorded read-only', async () => {
        const server = mockServer([orderEntry(1n, MAKER, USDC_TOKEN, XLM_TOKEN), ...tokenEntries()])
        const tx = dexTx([instanceKey(), trustline(MAKER, USDC)], [orderLedgerKey(DEX, 1n)])
        const added = await completeFootprint(tx, DEX, [1n], {server})
        expect(added).toEqual({orders: 0, makerEntries: 3})
        const fp = footprintOf(tx)
        expect(fp.readOnly.map(encode)).toEqual([encode(instanceKey())])
        expect(fp.readWrite.map(encode)).toContain(encode(trustline(MAKER, USDC)))
        //the promoted trustline was already counted by the simulation, only the account is a new disk read
        expect(tx.simulation.transactionData.build().resources.diskReadBytes).toBe(MAKER_ENTRY_SIZE)
    })

    test('adds no disk reads for maker entries the simulation declared read-write', async () => {
        const server = mockServer([orderEntry(1n, MAKER, USDC_TOKEN, XLM_TOKEN), ...tokenEntries()])
        const tx = dexTx([instanceKey()], [orderLedgerKey(DEX, 1n), trustline(MAKER, USDC), allowanceLedgerKey(MAKER, USDC_TOKEN, DEX), accountEntryKey(MAKER)])
        expect(await completeFootprint(tx, DEX, [1n], {server})).toEqual({orders: 0, makerEntries: 0})
        expect(tx.simulation.transactionData.build().resources.diskReadBytes).toBe(0)
    })

    test('declares only the order entry of a missing order', async () => {
        const server = mockServer(tokenEntries())
        const tx = dexTx()
        expect(await completeFootprint(tx, DEX, [9n], {server})).toEqual({orders: 1, makerEntries: 0})
        expect(footprintOf(tx).readWrite.map(encode)).toEqual([encode(orderLedgerKey(DEX, 9n))])
    })

    test('resolves tokens first seen in the orders with a second request and caches them', async () => {
        const server = mockServer([orderEntry(1n, MAKER, USDC_TOKEN, XLM_TOKEN), ...tokenEntries()])
        const assetCache = new Map()
        await completeFootprint(dexTx(), DEX, [1n], {server, assetCache})
        expect(server.requests).toHaveLength(2)
        expect(server.requests[0]).toEqual([encode(orderLedgerKey(DEX, 1n))])
        expect(assetCache.get(USDC_TOKEN).getCode()).toBe('USDC')
        expect(assetCache.get(XLM_TOKEN).isNative()).toBe(true)
        //cached tokens are not requested again
        await completeFootprint(dexTx(), DEX, [1n], {server, assetCache, tokens: [USDC_TOKEN, XLM_TOKEN]})
        expect(server.requests).toHaveLength(3)
        expect(server.requests[2]).toEqual([encode(orderLedgerKey(DEX, 1n))])
    })

    test('stops at the read-write entry limit, orders first', async () => {
        const server = mockServer([orderEntry(1n, MAKER, USDC_TOKEN, XLM_TOKEN), ...tokenEntries()])
        const filler = Array.from({length: 198}, (_, i) => orderLedgerKey(CONTRACT, 1000n + BigInt(i)))
        const tx = dexTx([], filler)
        const added = await completeFootprint(tx, DEX, [1n], {server})
        expect(added).toEqual({orders: 1, makerEntries: 1})
        const readWrite = footprintOf(tx).readWrite.map(encode)
        expect(readWrite).toHaveLength(200)
        expect(readWrite.slice(-2)).toEqual([encode(orderLedgerKey(DEX, 1n)), encode(trustline(MAKER, USDC))])
    })

    test('does nothing without ids or for failed simulations', async () => {
        const server = mockServer(tokenEntries())
        expect(await completeFootprint(dexTx(), DEX, [], {server})).toEqual({orders: 0, makerEntries: 0})
        const failed = {simulation: {error: 'boom'}, built: dexTx().built}
        expect(await completeFootprint(failed, DEX, [1n], {server})).toEqual({orders: 0, makerEntries: 0})
        expect(server.requests).toHaveLength(0)
    })
})
