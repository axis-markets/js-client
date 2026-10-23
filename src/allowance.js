import {PRICE_SCALE} from './asset-pair.js'

/**
 * Longest allowance lifetime the client grants, in ledgers: ~180 days at 5s per ledger, one hour (720 ledgers) short of
 * the network maximum entry TTL (3,110,400 ledgers).
 */
export const MAX_APPROVAL_TTL_LEDGERS = 3_109_680

/** Default allowance lifetime granted with a trade, in ledgers (~180 days) */
export const APPROVAL_TTL_LEDGERS = MAX_APPROVAL_TTL_LEDGERS

/** An allowance expiring within this number of ledgers is renewed with the next trade (~1 day) */
export const APPROVAL_RENEW_LEDGERS = 17_280

/**
 * Decide whether a call needs an in-call approval and adjust it. The approval amount is absolute and one allowance backs
 * every order selling the token across all markets, so it has to cover this call plus every  order selling the same asset
 * @param {ApprovalPlanParams} params
 * @return {{amount: bigint, liveUntil: number}|undefined} - Approval to pass with the call, undefined when the current allowance already covers it
 */
export function planApproval({required, committed, allowance, liveUntil, ledger, ttl = APPROVAL_TTL_LEDGERS}) {
    const target = required + committed
    const expiring = liveUntil > 0 && liveUntil < ledger + APPROVAL_RENEW_LEDGERS
    if (allowance >= target && !expiring)
        return undefined
    return {amount: target, liveUntil: ledger + Math.min(ttl, MAX_APPROVAL_TTL_LEDGERS)}
}

/**
 * Decide whether the allowance can be lowered once the open orders selling the token have been canceled or shrunk.
 * @param {ReductionPlanParams} params
 * @return {{amount: bigint, liveUntil: number}|undefined} - Approval to pass with the call, undefined when the allowance does not exceed the target
 */
export function planReduction({target, allowance, liveUntil = 0, ledger, ttl = APPROVAL_TTL_LEDGERS}) {
    if (liveUntil > 0 && liveUntil < ledger)
        return undefined //an expired allowance reads as zero
    if (allowance <= target)
        return undefined
    if (target <= 0n)
        return {amount: 0n, liveUntil: 0} //the token checks no lifetime for a zero amount
    //a nonzero approval must outlive the ledger it applies in: keep a lifetime that does, renew a short one
    if (liveUntil > ledger + APPROVAL_RENEW_LEDGERS)
        return {amount: target, liveUntil}
    return {amount: target, liveUntil: ledger + Math.min(ttl, MAX_APPROVAL_TTL_LEDGERS)}
}

/**
 * Max amount of `selling` tokens a buy trade may cost: `ceil(amount × price / 10^18)`
 * @param {bigint} amount - Amount of `buying` tokens to acquire
 * @param {bigint} price - Limit price (`selling` per 1 `buying`, with AXIS standard price decimals)
 * @return {bigint}
 */
export function maxQuoteSpend(amount, price) {
    if (amount <= 0n || price <= 0n)
        return 0n
    return (amount * price + PRICE_SCALE - 1n) / PRICE_SCALE
}

/**
 * @typedef {{}} ApprovalPlanParams
 * @property {bigint} required - Max amount of the selling asset the call may spend
 * @property {bigint} committed - Remaining amount of orders in the book selling the asset
 * @property {bigint} allowance - Current allowance (0 once expired)
 * @property {number} ledger - Current ledger sequence
 * @property {number} [liveUntil] - Ledger the current allowance lives until (0 or omitted when unknown)
 * @property {number} [ttl] - Lifetime of a new allowance in ledgers, {@link APPROVAL_TTL_LEDGERS} by default, at most
 * {@link MAX_APPROVAL_TTL_LEDGERS}
 */

/**
 * @typedef {{}} ReductionPlanParams
 * @property {bigint} target - Amount the open orders selling the asset still need after the call
 * @property {bigint} allowance - Current allowance
 * @property {number} ledger - Current ledger sequence
 * @property {number} [liveUntil] - Ledger the current allowance lives until (0 or omitted when unknown)
 * @property {number} [ttl] - Lifetime of a renewed allowance in ledgers, {@link APPROVAL_TTL_LEDGERS} by default, at
 * most {@link MAX_APPROVAL_TTL_LEDGERS}
 */
