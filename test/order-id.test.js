import {nativeToScVal, hash} from '@stellar/stellar-sdk'
import * as rootEntry from '../src/index.js'
import {orderId, generateNonce} from '../src/order-id.js'

const ACCOUNT = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const U128_MAX = (1n << 128n) - 1n

/** Reference derivation through the typed SDK encoder */
function referenceId(owner, nonce) {
    const digest = hash(nativeToScVal([owner, nonce], {type: ['address', 'u64']}).toXDR())
    let id = 0n
    for (const byte of digest.subarray(0, 16)) {
        id = (id << 8n) | BigInt(byte)
    }
    return id
}

describe('orderId', () => {
    test('is a deterministic u128', () => {
        const id = orderId(ACCOUNT, 12345n)
        expect(typeof id).toBe('bigint')
        expect(id).toBeGreaterThanOrEqual(0n)
        expect(id).toBeLessThanOrEqual(U128_MAX)
        expect(orderId(ACCOUNT, 12345n)).toBe(id)
    })

    test('matches the ids computed by the contract', () => {
        //the former `order_id` view returned these with the top bit cleared; the contract now keeps all 128 bits
        expect(orderId(ACCOUNT, 12345n)).toBe(104716339259087188276464058217096427616n)
        expect(orderId(ACCOUNT, 0n)).toBe(87503119175631750522483667960259619256n)
        expect(orderId(ACCOUNT, 18446744073709551615n)).toBe(239482216881556756373704228044123948254n)
        expect(orderId(CONTRACT, 777n)).toBe(260602579416723494792706352430735587842n)
    })

    test('keeps the top bit of the digest prefix', () => {
        const ids = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n].map(nonce => orderId(ACCOUNT, nonce))
        expect(ids.some(id => id >> 127n === 1n)).toBe(true)
        expect(ids.some(id => id >> 127n === 0n)).toBe(true)
    })

    test('matches the typed SDK encoding of [owner, nonce]', () => {
        for (const [owner, nonce] of [[ACCOUNT, 0n], [ACCOUNT, 12345n], [ACCOUNT, (1n << 64n) - 1n], [CONTRACT, 777n]]) {
            expect(orderId(owner, nonce)).toBe(referenceId(owner, nonce))
        }
    })

    test('differs across nonces and owners', () => {
        expect(orderId(ACCOUNT, 1n)).not.toBe(orderId(ACCOUNT, 2n))
        expect(orderId(ACCOUNT, 1n)).not.toBe(orderId(CONTRACT, 1n))
    })

    test('accepts number and string nonces', () => {
        const id = orderId(ACCOUNT, 42n)
        expect(orderId(ACCOUNT, 42)).toBe(id)
        expect(orderId(ACCOUNT, '42')).toBe(id)
    })

    test('rejects nonces outside u64', () => {
        expect(() => orderId(ACCOUNT, -1n)).toThrow(RangeError)
        expect(() => orderId(ACCOUNT, 1n << 64n)).toThrow(RangeError)
    })
})

describe('generateNonce', () => {
    test('fits u64 and encodes the wall clock in the high bits', () => {
        const before = BigInt(Date.now())
        const nonce = generateNonce()
        const after = BigInt(Date.now())
        expect(nonce).toBeGreaterThanOrEqual(0n)
        expect(nonce).toBeLessThan(1n << 64n)
        const ms = nonce >> 22n
        expect(ms).toBeGreaterThanOrEqual(before)
        expect(ms).toBeLessThanOrEqual(after)
    })

    test('varies between calls through the 22 random bits', () => {
        const nonces = new Set()
        const randomParts = new Set()
        for (let i = 0; i < 100; i++) {
            const nonce = generateNonce()
            nonces.add(nonce)
            randomParts.add(nonce & 0x3fffffn)
        }
        expect(nonces.size).toBeGreaterThan(1)
        expect(randomParts.size).toBeGreaterThan(1)
    })

    test('keeps u64 headroom for the wall clock until 2100', () => {
        const ms2100 = BigInt(Date.UTC(2100, 0, 1))
        expect((ms2100 << 22n) | 0x3fffffn).toBeLessThan(1n << 64n)
    })

    test('is not part of the package entry', () => {
        expect('generateNonce' in rootEntry).toBe(false)
        expect(typeof rootEntry.orderId).toBe('function')
    })
})
