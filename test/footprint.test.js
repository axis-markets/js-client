import {
    xdr,
    Address,
    Account,
    Contract,
    Keypair,
    Networks,
    SorobanDataBuilder,
    TransactionBuilder
} from '@stellar/stellar-sdk'
import ContractClient from '../src/contract-client.js'
import {
    collectOrderIds,
    ensureOrdersFootprint,
    orderLedgerKey,
    ORDER_ENTRY_SIZE,
    ORDER_INSTRUCTIONS,
    ORDER_RESOURCE_FEE
} from '../src/footprint.js'

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
        durability: xdr.ContractDataDurability.persistent()
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
    return tx.simulation.transactionData.build().resources().footprint()
}

describe('orderLedgerKey', () => {
    test('builds a persistent contract data key with u64 order id', () => {
        const key = orderLedgerKey(CONTRACT, 42n)
        expect(key.switch().name).toBe('contractData')
        const data = key.contractData()
        expect(Address.fromScAddress(data.contract()).toString()).toBe(CONTRACT)
        expect(data.key().switch().name).toBe('scvU64')
        expect(data.key().u64().toBigInt()).toBe(42n)
        expect(data.durability().name).toBe('persistent')
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
        expect(fp.readOnly().map(encode)).toEqual([encode(instanceKey())])
        expect(fp.readWrite().map(encode)).toEqual([
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
        expect(fp.readOnly().map(encode)).toEqual([encode(instanceKey())])
        expect(fp.readWrite().map(encode)).toEqual([
            encode(orderLedgerKey(CONTRACT, 1n)),
            encode(orderLedgerKey(CONTRACT, 2n))
        ])
    })

    test('scales resources and fee with the number of added entries only', () => {
        const tx = simulatedTx([], [orderLedgerKey(CONTRACT, 1n)])
        const added = ensureOrdersFootprint(tx, CONTRACT, [1n, 2n, 3n, 3n])
        expect(added).toBe(2)
        const data = tx.simulation.transactionData.build()
        expect(data.resources().instructions()).toBe(SIM_INSTRUCTIONS + 2 * ORDER_INSTRUCTIONS)
        expect(data.resources().writeBytes()).toBe(SIM_WRITE_BYTES + 2 * ORDER_ENTRY_SIZE)
        expect(data.resources().diskReadBytes()).toBe(0)
        expect(data.resourceFee().toBigInt()).toBe(BigInt(SIM_RESOURCE_FEE) + 2n * ORDER_RESOURCE_FEE)
    })

    test('caps declared instructions at the network limit', () => {
        const tx = simulatedTx([], [])
        tx.simulation.transactionData.setResources(99_000_000, 0, SIM_WRITE_BYTES)
        ensureOrdersFootprint(tx, CONTRACT, [1n, 2n])
        expect(tx.simulation.transactionData.build().resources().instructions()).toBe(100_000_000)
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
        const builtData = tx.built.toEnvelope().v1().tx().ext().value()
        expect(builtData.toXDR('base64')).toBe(patched.toXDR('base64'))
        expect(Number(tx.built.fee)).toBe(INCLUSION_FEE + Number(patched.resourceFee().toBigInt()))
        expect(tx.built.operations).toHaveLength(1)
        expect(tx.built.source).toBe(ACCOUNT)
        expect(tx.built.timeBounds.maxTime).not.toBe('0')
    })
})

describe('ORDER_ENTRY_SIZE', () => {
    test('covers a max-size Order ledger entry encoded through the contract spec', () => {
        const client = new ContractClient({
            contractId: CONTRACT,
            rpcUrl: 'http://localhost',
            allowHttp: true,
            networkPassphrase: Networks.TESTNET
        })
        const maxI128 = (1n << 127n) - 1n
        const maxU64 = (1n << 64n) - 1n
        const order = {
            id: maxU64,
            kind: 3,
            selling: CONTRACT,
            buying: CONTRACT,
            amount: maxI128,
            quote: maxI128,
            owner: CONTRACT,
            price: maxI128,
            expires: maxU64
        }
        const orderType = xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({name: 'Order'}))
        const val = client.spec.nativeToScVal(order, orderType)
        const entry = new xdr.LedgerEntry({
            lastModifiedLedgerSeq: 0,
            data: xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
                ext: new xdr.ExtensionPoint(0),
                contract: Address.fromString(CONTRACT).toScAddress(),
                key: xdr.ScVal.scvU64(new xdr.Uint64(maxU64)),
                durability: xdr.ContractDataDurability.persistent(),
                val
            })),
            ext: new xdr.LedgerEntryExt(0)
        })
        const actual = entry.toXDR().length
        expect(actual).toBeGreaterThan(0)
        expect(ORDER_ENTRY_SIZE).toBeGreaterThanOrEqual(actual)
    })
})
