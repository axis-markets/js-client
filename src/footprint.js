import {xdr, Address, Asset, Keypair, StrKey, TransactionBuilder, nativeToScVal, scValToNative, contract, rpc} from '@stellar/stellar-sdk'

/**
 * Upper bound of a serialized `Order` ledger entry in bytes.
 * (positional vector of three addresses, i128 amount and price, optional u64 expires = at most 188-byte value,
 * about 264-byte ledger entry, rounded up to 320).
 * @type {number}
 */
export const ORDER_ENTRY_SIZE = 320

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
 * Upper bound of a maker balance (account, trustline or token balance) or allowance ledger entry in bytes.
 * @type {number}
 */
export const MAKER_ENTRY_SIZE = 256

/**
 * Resource fee (stroops) added for every maker entry declared read-write (write entry ~10k, its bytes charged as written ~6k).
 * @type {bigint}
 */
export const MAKER_ENTRY_RESOURCE_FEE = 20_000n

/**
 * CPU instructions added for every maker whose entries were declared (two token transfers, backing and receive checks).
 * @type {number}
 */
export const MAKER_INSTRUCTIONS = 3_000_000

/**
 * Resource fee (stroops) added for every maker whose entries were declared (instructions ~8k, two transfer events and
 * a `skip` event ~4k, rounded up).
 * @type {bigint}
 */
export const MAKER_RESOURCE_FEE = 20_000n

/**
 * Ledger entry types read from disk when a transaction is applied: every declared one counts towards the disk read
 * bytes, whether the execution touches it or not.
 * @type {Set<string>}
 */
const DISK_ENTRY_TYPES = new Set(['account', 'trustline'])

/**
 * Network-wide per-transaction instructions limit.
 * @type {number}
 */
const MAX_TX_INSTRUCTIONS = 400_000_000

/**
 * Network-wide per-transaction limits of read-write and total footprint entries.
 */
const MAX_READ_WRITE_ENTRIES = 200
const MAX_FOOTPRINT_ENTRIES = 400

/**
 * Keys per `getLedgerEntries` request accepted by RPC.
 */
const LEDGER_ENTRIES_BATCH = 200

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
 * Build persistent contract data ledger key of an order (the key is the raw u128 order id).
 * @param {string} contractId - DEX contract address
 * @param {bigint|number|string} orderId - Order id
 * @return {xdr.LedgerKey}
 */
export function orderLedgerKey(contractId, orderId) {
    return contractDataKey(contractId, nativeToScVal(BigInt(orderId), {type: 'u128'}), xdr.ContractDataDurability.persistent)
}

/**
 * Build the ledger key of a contract instance entry.
 * @param {string} contractId - Contract address
 * @return {xdr.LedgerKey}
 */
export function instanceLedgerKey(contractId) {
    return contractDataKey(contractId, xdr.ScVal.scvLedgerKeyContractInstance(), xdr.ContractDataDurability.persistent)
}

/**
 * Build the ledger key holding the balance of `owner` in a Stellar Asset Contract token.
 * @param {string} owner - Account or contract address
 * @param {string} token - Token contract address
 * @param {Asset|null} asset - Classic asset behind the token, `null` for a token that is not a Stellar Asset Contract
 * @return {xdr.LedgerKey|null} - `null` when the balance has no ledger entry of its own (issuer) or the token storage layout is unknown
 */
export function balanceLedgerKey(owner, token, asset) {
    if (!asset)
        return null
    if (StrKey.isValidContract(owner))
        return contractDataKey(token, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'), Address.fromString(owner).toScVal()]), xdr.ContractDataDurability.persistent)
    const accountId = Keypair.fromPublicKey(owner).xdrAccountId()
    if (asset.isNative())
        return xdr.LedgerKey.account(new xdr.LedgerKeyAccount({accountId}))
    //the issuer holds no trustline for its own asset
    if (asset.getIssuer() === owner)
        return null
    return xdr.LedgerKey.trustline(new xdr.LedgerKeyTrustLine({accountId, asset: asset.toTrustLineXDRObject()}))
}

/**
 * Build the ledger key of the allowance `owner` granted to `spender` in a Stellar Asset Contract token.
 * @param {string} owner - Account or contract address granting the allowance
 * @param {string} token - Token contract address
 * @param {string} spender - Spender address (the DEX contract)
 * @return {xdr.LedgerKey}
 */
export function allowanceLedgerKey(owner, token, spender) {
    const key = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Allowance'),
        xdr.ScVal.scvMap([
            new xdr.ScMapEntry({key: xdr.ScVal.scvSymbol('from'), val: Address.fromString(owner).toScVal()}),
            new xdr.ScMapEntry({key: xdr.ScVal.scvSymbol('spender'), val: Address.fromString(spender).toScVal()})
        ])
    ])
    return contractDataKey(token, key, xdr.ContractDataDurability.temporary)
}

/**
 * Decode a stored order entry value: a positional vector `[owner, selling, buying, amount, price, expires?]`.
 * @param {xdr.ScVal} val - Contract data value of the order entry
 * @return {{owner: string, selling: string, buying: string}}
 */
export function decodeStoredOrder(val) {
    const [owner, selling, buying] = scValToNative(val)
    return {owner, selling, buying}
}

/**
 * Resolve the classic asset behind a token from its contract instance entry.
 * @param {xdr.ScVal} val - Contract data value of the token instance entry
 * @return {Asset|null} - `null` for a token that is not a Stellar Asset Contract
 */
export function decodeSacAsset(val) {
    if (val.type !== 'scvContractInstance' || val.instance.executable.type !== 'contractExecutableStellarAsset')
        return null
    const entry = (val.instance.storage ?? []).find(({key}) => scValToNative(key)?.[0] === 'AssetInfo')
    if (!entry)
        return null
    const [type, info] = scValToNative(entry.val)
    if (type === 'Native')
        return Asset.native()
    //alphanum codes are padded with zero bytes
    const code = info.asset_code.replace(/\0+$/, '')
    return new Asset(code, StrKey.encodeEd25519PublicKey(info.issuer))
}

/**
 * Make sure every supplied order id declared in the read-write footprint of a simulated transaction.
 * @param {contract.AssembledTransaction} tx - Simulated transaction
 * @param {string} contractId - DEX contract address
 * @param {Array<bigint|number|string>} orderIds - Order ids passed to the contract call
 * @return {number} - Number of order entries added to the read-write footprint
 */
export function ensureOrdersFootprint(tx, contractId, orderIds) {
    if (!isPatchable(tx) || !orderIds?.length)
        return 0
    const data = tx.simulation.transactionData
    const added = declareReadWrite(data, collectOrderIds(orderIds).map(id => orderLedgerKey(contractId, id))).length
    if (added === 0)
        return 0
    applyResources(tx, data, {
        instructions: added * ORDER_INSTRUCTIONS,
        writeBytes: added * ORDER_ENTRY_SIZE,
        fee: BigInt(added) * ORDER_RESOURCE_FEE
    })
    return added
}

/**
 * Complete the footprint of a simulated trading transaction, so it still applies when the book moves between simulation
 * and execution (an order repriced back into range, a maker's backing restored, an earlier order shrunk). Every listed
 * order entry is declared read-write, and so is every entry the settlement may write for the order's maker: the balance
 * of the asset the maker sells, the allowance on it granted to the DEX contract, and the balance of the asset the maker
 * receives. Makers of tokens that are not Stellar Asset Contracts keep what the simulation recorded (their storage layout
 * is unknown). Entries are added in list order, orders first, while the footprint limits allow.
 * @param {contract.AssembledTransaction} tx - Simulated transaction
 * @param {string} contractId - DEX contract address
 * @param {Array<bigint|number|string>} orderIds - Order ids passed to the contract call
 * @param {FootprintOptions} options
 * @return {Promise<{orders: number, makerEntries: number}>} - Number of order and maker entries added to the read-write footprint
 */
export async function completeFootprint(tx, contractId, orderIds, {server, tokens = [], assetCache = new Map()}) {
    if (!isPatchable(tx) || !orderIds?.length)
        return {orders: 0, makerEntries: 0}
    const orderKeys = collectOrderIds(orderIds).map(id => orderLedgerKey(contractId, id))
    //one request for the orders and the known tokens, another one only for tokens first seen in the orders
    const knownTokens = unresolved(tokens, assetCache)
    const entries = await loadEntries(server, [...orderKeys, ...knownTokens.map(instanceLedgerKey)])
    cacheAssets(entries, knownTokens, assetCache)
    const orders = orderKeys
        .map(key => entries.get(key.toXDR('base64')))
        .filter(Boolean)
        .map(entry => decodeStoredOrder(entry.contractData.val))
    const newTokens = unresolved(orders.flatMap(({selling, buying}) => [selling, buying]), assetCache)
    if (newTokens.length) {
        cacheAssets(await loadEntries(server, newTokens.map(instanceLedgerKey)), newTokens, assetCache)
    }
    //entries the settlement writes for each maker, tagged with the maker
    const makerOf = new Map()
    const makerKeys = []
    for (const {owner, selling, buying} of orders) {
        const sold = assetCache.get(selling)
        const keys = [
            balanceLedgerKey(owner, selling, sold),
            sold ? allowanceLedgerKey(owner, selling, contractId) : null,
            balanceLedgerKey(owner, buying, assetCache.get(buying))
        ]
        for (const key of keys) {
            if (!key)
                continue
            makerOf.set(key.toXDR('base64'), owner)
            makerKeys.push(key)
        }
    }
    const data = tx.simulation.transactionData
    //entries promoted from the read-only part are already counted as disk reads by the simulation
    const readOnly = new Set(data.getReadOnly().map(key => key.toXDR('base64')))
    const added = declareReadWrite(data, [...orderKeys, ...makerKeys])
    if (!added.length)
        return {orders: 0, makerEntries: 0}
    const makers = new Set()
    let makerEntries = 0
    let diskEntries = 0
    for (const key of added) {
        const encoded = key.toXDR('base64')
        const maker = makerOf.get(encoded)
        if (maker === undefined)
            continue
        makerEntries++
        makers.add(maker)
        if (DISK_ENTRY_TYPES.has(key.type) && !readOnly.has(encoded)) {
            diskEntries++
        }
    }
    const orderEntries = added.length - makerEntries
    applyResources(tx, data, {
        instructions: orderEntries * ORDER_INSTRUCTIONS + makers.size * MAKER_INSTRUCTIONS,
        diskReadBytes: diskEntries * MAKER_ENTRY_SIZE,
        writeBytes: orderEntries * ORDER_ENTRY_SIZE + makerEntries * MAKER_ENTRY_SIZE,
        fee: BigInt(orderEntries) * ORDER_RESOURCE_FEE + BigInt(makerEntries) * MAKER_ENTRY_RESOURCE_FEE + BigInt(makers.size) * MAKER_RESOURCE_FEE
    })
    return {orders: orderEntries, makerEntries}
}

/**
 * @param {string} contractId
 * @param {xdr.ScVal} key
 * @param {xdr.ContractDataDurability} durability
 * @return {xdr.LedgerKey}
 * @private
 */
function contractDataKey(contractId, key, durability) {
    return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
        contract: Address.fromString(contractId).toScAddress(),
        key,
        durability
    }))
}

/**
 * Whether the simulation succeeded and can be patched
 * @param {contract.AssembledTransaction} tx
 * @return {boolean}
 * @private
 */
function isPatchable(tx) {
    const simulation = tx.simulation
    return !!simulation && !simulation.error && !simulation.restorePreamble && !!tx.built
}

/**
 * Fetch ledger entries, keyed by the base64 XDR of their ledger keys
 * @param {rpc.Server} server
 * @param {xdr.LedgerKey[]} keys
 * @return {Promise<Map<string, xdr.LedgerEntryData>>}
 * @private
 */
async function loadEntries(server, keys) {
    const res = new Map()
    for (let i = 0; i < keys.length; i += LEDGER_ENTRIES_BATCH) {
        const {entries} = await server.getLedgerEntries(...keys.slice(i, i + LEDGER_ENTRIES_BATCH))
        for (const entry of entries) {
            res.set(entry.key.toXDR('base64'), entry.val)
        }
    }
    return res
}

/**
 * Tokens from the list not resolved yet, deduplicated
 * @param {string[]} tokens
 * @param {Map<string, Asset|null>} assetCache
 * @return {string[]}
 * @private
 */
function unresolved(tokens, assetCache) {
    return [...new Set(tokens)].filter(token => !assetCache.has(token))
}

/**
 * Store the classic asset of every token from the loaded instance entries (`null` when unknown)
 * @param {Map<string, xdr.LedgerEntryData>} entries
 * @param {string[]} tokens
 * @param {Map<string, Asset|null>} assetCache
 * @private
 */
function cacheAssets(entries, tokens, assetCache) {
    for (const token of tokens) {
        const entry = entries.get(instanceLedgerKey(token).toXDR('base64'))
        assetCache.set(token, entry ? decodeSacAsset(entry.contractData.val) : null)
    }
}

/**
 * Add keys to the read-write part of a simulated footprint, dropping them from the read-only part, while the
 * footprint limits allow
 * @param {SorobanDataBuilder} data - Simulation data to patch
 * @param {xdr.LedgerKey[]} keys - Keys to declare, in priority order
 * @return {xdr.LedgerKey[]} - Keys actually added
 * @private
 */
function declareReadWrite(data, keys) {
    const readOnly = data.getReadOnly()
    const readWrite = data.getReadWrite()
    const roIndex = new Map(readOnly.map((key, i) => [key.toXDR('base64'), i]))
    const rwIndex = new Set(readWrite.map(key => key.toXDR('base64')))
    const dropFromReadOnly = new Set()
    const added = []
    for (const key of keys) {
        const encoded = key.toXDR('base64')
        if (rwIndex.has(encoded))
            continue
        //a key promoted from the read-only part does not grow the footprint
        const promoted = roIndex.has(encoded)
        const total = readOnly.length - dropFromReadOnly.size + readWrite.length
        if (readWrite.length >= MAX_READ_WRITE_ENTRIES || (!promoted && total >= MAX_FOOTPRINT_ENTRIES))
            continue
        //a key can't be listed in both parts of the footprint
        if (promoted) {
            dropFromReadOnly.add(roIndex.get(encoded))
        }
        readWrite.push(key)
        rwIndex.add(encoded)
        added.push(key)
    }
    if (added.length) {
        data.setFootprint(readOnly.filter((_, i) => !dropFromReadOnly.has(i)), readWrite)
    }
    return added
}

/**
 * Declare the resources of the added entries and rebuild the transaction from the patched simulation data
 * @param {contract.AssembledTransaction} tx - Simulated transaction
 * @param {SorobanDataBuilder} data - Patched simulation data
 * @param {{instructions: number, diskReadBytes?: number, writeBytes: number, fee: bigint}} extra - Resources and fee to add
 * @private
 */
function applyResources(tx, data, {instructions, diskReadBytes = 0, writeBytes, fee}) {
    const resources = data.build().resources
    data.setResources(Math.min(resources.instructions + instructions, MAX_TX_INSTRUCTIONS), resources.diskReadBytes + diskReadBytes, resources.writeBytes + writeBytes)
    data.setResourceFee((data.build().resourceFee + fee).toString())

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
}

/**
 * @typedef {{}} FootprintOptions
 * @property {rpc.Server} server - RPC server used to load the listed orders and the token instances
 * @property {string[]} [tokens] - Tokens the call trades, resolved together with the orders
 * @property {Map<string, Asset|null>} [assetCache] - Classic assets of resolved tokens (`null` for other tokens), reused between calls
 */
