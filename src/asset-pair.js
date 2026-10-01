import {Address} from '@stellar/stellar-sdk'

/** Price scale of the contract (18 decimals) */
export const PRICE_SCALE = 10n ** 18n

/**
 * Serialized `ScAddress` by address string
 * @type {Map<string, Uint8Array>}
 */
const keyCache = new Map()

/**
 * @param {string} address
 * @return {Uint8Array}
 */
function getAddressKey(address) {
    let key = keyCache.get(address)
    if (!key) {
        key = Address.fromString(address).toScAddress().toXDR()
        if (keyCache.size >= 10_000) { //will never happen in real life
            keyCache.clear()
        }
        keyCache.set(address, key)
    }
    return key
}

/**
 * Compare two assets in the contract canonical order
 * @param {string} a - Token contract address
 * @param {string} b - Token contract address
 * @return {number} - Negative if `a` first, positive if `b` first, 0 if equal
 */
export function compareAssets(a, b) {
    if (a === b)
        return 0
    const key1 = getAddressKey(a)
    const key2 = getAddressKey(b)
    const length = Math.min(key1.length, key2.length)
    for (let i = 0; i < length; i++) {
        if (key1[i] !== key2[i])
            return key1[i] - key2[i]
    }
    return key1.length - key2.length
}

/**
 * Reorder an asset pair the way the contract stores markets
 * @param {string} x - Token contract address
 * @param {string} y - Token contract address
 * @return {[string, string]} - `[a, b]`: `a` is the base, `b` the quote of the canonical market symbol
 */
export function canonicalPair(x, y) {
    return compareAssets(x, y) <= 0 ? [x, y] : [y, x]
}

/**
 * Canonical market key `a/b`
 * @param {string} a - Token contract address
 * @param {string} b - Token contract address
 * @return {string}
 */
export function pairKey(a, b) {
    const [a1, a2] = canonicalPair(a, b)
    return a1 + '/' + a2
}

/**
 * Calculate inverted price, rounded down: `floor(10^36 / price)`
 * @param {bigint} price - Price in the contract scale
 * @return {bigint}
 */
export function invertPrice(price) {
    if (price <= 0n)
        return 0n
    return PRICE_SCALE * PRICE_SCALE / price
}

/**
 * 24h ticker entry of the market seen in the inverted orientation (`b/a`)
 * @param {TickerEntry} entry - Standard ticker entry
 * @return {TickerEntry}
 */
export function invertTicker(entry) {
    const [a, b] = entry.symbol.split('/')
    const inv = value => {
        const n = Number(value)
        return n > 0 ? String(1 / n) : '0'
    }
    const open = Number(entry.openPrice)
    const last = Number(entry.lastPrice)
    return {
        ...entry,
        symbol: b + '/' + a,
        openPrice: inv(entry.openPrice),
        highPrice: inv(entry.lowPrice),
        lowPrice: inv(entry.highPrice),
        lastPrice: inv(entry.lastPrice),
        volume: entry.quoteVolume,
        quoteVolume: entry.volume,
        change: open > 0 && last > 0 ? Math.round((open / last - 1) * 100_000) / 1000 : 0,
        avgPrice: inv(entry.avgPrice)
    }
}
