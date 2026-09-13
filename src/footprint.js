import {xdr, Address, TransactionBuilder, contract} from '@stellar/stellar-sdk'

/**
 * Upper bound of a serialized `Order` ledger entry in bytes.
 * (u64 id/expires, u32 kind, three 32-byte addresses, three i128 amounts = 428 bytes, rounded up to 512).
 * @type {number}
 */
export const ORDER_ENTRY_SIZE = 512

/**
 * CPU instructions added to the declared budget for every order that was not matched at simulation time.
 * @type {number}
 */
export const ORDER_INSTRUCTIONS = 2_000_000

/**
 * Resource fee (stroops) added for every order that was not matched at simulation time.
 * (write entry ~10k, read entry ~6k, writes ~12k, 2M instructions ~5k, trade/order events ~10k).
 * @type {bigint}
 */
export const ORDER_RESOURCE_FEE = 100_000n

/**
 * Network-wide per-transaction instructions limit.
 * @type {number}
 */
const MAX_TX_INSTRUCTIONS = 100_000_000

/**
 * Flatten and deduplicate order ids from several lists, coercing them to bigint.
 * @param {...(Array<bigint|number|string>|undefined|null)} idLists - Lists of order ids
 * @return {bigint[]} - Unique order ids in the order of first appearance
 */
export function collectOrderIds(...idLists) {
    const seen = new Set()
    const res = []
    for (const list of idLists) {
        if (!list)
            continue
        for (const id of list) {
            if (id === undefined || id === null)
                continue
            const value = BigInt(id)
            const key = value.toString()
            if (seen.has(key))
                continue
            seen.add(key)
            res.push(value)
        }
    }
    return res
}

/**
 * Build persistent contract data ledger key of an order.
 * @param {string} contractId - DEX contract address
 * @param {bigint|number|string} orderId - Order id
 * @return {xdr.LedgerKey}
 */
export function orderLedgerKey(contractId, orderId) {
    return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
        contract: Address.fromString(contractId).toScAddress(),
        key: xdr.ScVal.scvU64(new xdr.Uint64(BigInt(orderId))),
        durability: xdr.ContractDataDurability.persistent()
    }))
}

/**
 * Make sure every supplied order id declared in the read-write footprint of a simulated transaction.
 * @param {contract.AssembledTransaction} tx - Simulated transaction
 * @param {string} contractId - DEX contract address
 * @param {Array<bigint|number|string>} orderIds - Order ids passed to the contract call
 * @return {number} - Number of order entries added to the read-write footprint
 */
export function ensureOrdersFootprint(tx, contractId, orderIds) {
    const simulation = tx.simulation
    if (!simulation || simulation.error || simulation.restorePreamble || !tx.built || !orderIds?.length)
        return 0
    /** @type {SorobanDataBuilder} */
    const data = simulation.transactionData
    const readOnly = data.getReadOnly()
    const readWrite = data.getReadWrite()
    const roIndex = new Map(readOnly.map((key, i) => [key.toXDR('base64'), i]))
    const rwIndex = new Set(readWrite.map(key => key.toXDR('base64')))
    const dropFromReadOnly = new Set()
    let added = 0
    for (const id of collectOrderIds(orderIds)) {
        const key = orderLedgerKey(contractId, id)
        const encoded = key.toXDR('base64')
        if (rwIndex.has(encoded))
            continue
        //a key can't be listed in both parts of the footprint
        if (roIndex.has(encoded)) {
            dropFromReadOnly.add(roIndex.get(encoded))
        }
        readWrite.push(key)
        rwIndex.add(encoded)
        added++
    }
    if (added === 0)
        return 0
    const newReadOnly = readOnly.filter((_, i) => !dropFromReadOnly.has(i))
    data.setFootprint(newReadOnly, readWrite)

    //declare resources for the orders that may get matched at execution time
    const resources = data.build().resources()
    const instructions = Math.min(resources.instructions() + added * ORDER_INSTRUCTIONS, MAX_TX_INSTRUCTIONS)
    data.setResources(instructions, resources.diskReadBytes(), resources.writeBytes() + added * ORDER_ENTRY_SIZE)
    const resourceFee = data.build().resourceFee().toBigInt() + BigInt(added) * ORDER_RESOURCE_FEE
    data.setResourceFee(resourceFee.toString())

    //drop cached simulation data so the SDK picks up the patched builder when signing
    delete tx.simulationTransactionData
    //keep the built transaction consistent with the patched footprint and fee
    const timeout = tx.options?.timeoutInSeconds ?? 300
    tx.built = TransactionBuilder.cloneFrom(tx.built, {
        sorobanData: data.build(),
        timebounds: undefined
    })
        .setTimeout(timeout)
        .build()
    return added
}
