import {xdr, Address, hash} from '@stellar/stellar-sdk'

const U64_MAX = (1n << 64n) - 1n

/**
 * Compute the id of the order `owner` creates with `nonce`.
 * Mirrors the contract: the first 16 bytes of `sha256(xdr(ScVec[owner: Address, nonce: u64]))`
 * interpreted as a big-endian `u128` (the full 128 bits, no mask).
 * @param {string} owner - Order owner address (account or contract)
 * @param {bigint|number|string} nonce - Client-chosen u64 nonce
 * @return {bigint} - u128 order id
 */
export function orderId(owner, nonce) {
    nonce = BigInt(nonce)
    if (nonce < 0n || nonce > U64_MAX)
        throw new RangeError('Nonce must fit u64')
    const payload = xdr.ScVal.scvVec([
        Address.fromString(owner).toScVal(),
        xdr.ScVal.scvU64(nonce)
    ]).toXDR()
    const digest = hash(payload)
    let id = 0n
    for (let i = 0; i < 16; i++) {
        id = (id << 8n) | BigInt(digest[i])
    }
    return id
}

/**
 * Generate a u64 order nonce: wall clock (in milliseconds) shifted left by 22 bits plus 22 random bits.
 * The clock part fits 42 bits until the year 2109, so the nonce never overflows u64; the random part makes
 * collisions among the orders an account creates within the same millisecond negligible.
 * Internal to the client - consumers never supply or observe nonces, `buy`/`sell` generate one per call.
 * @return {bigint}
 * @internal
 */
export function generateNonce() {
    return (BigInt(Date.now()) << 22n) | BigInt(randomBits22())
}

function randomBits22() {
    const crypto = globalThis.crypto
    if (crypto?.getRandomValues) {
        return crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffff
    }
    return Math.floor(Math.random() * 0x400000)
}
