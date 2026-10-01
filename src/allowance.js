import {PRICE_SCALE} from './asset-pair.js'

/**
 * Allowance lifetime granted with a trade, in ledgers: ~30 days at 5s per ledger (the maximum entry TTL ~180 days)
 */
export const APPROVAL_TTL_LEDGERS = 518_400

/**
 * An allowance expiring within this number of ledgers is renewed with the next trade (~1 day)
 */
export const APPROVAL_RENEW_LEDGERS = 17_280

/**
 * Decide whether a call needs an in-call approval and adjust it. The approval amount is absolute and one allowance backs
 * every order selling the token across all markets, so it has to cover this call plus every  order selling the same asset
 * @param {ApprovalPlanParams} params
 * @return {{amount: bigint, liveUntil: number}|undefined} - Approval to pass with the call, undefined when the current allowance already covers it
 */
export function planApproval({required, committed, allowance, liveUntil, ledger}) {
    const target = required + committed
    const expiring = liveUntil > 0 && liveUntil < ledger + APPROVAL_RENEW_LEDGERS
    if (allowance >= target && !expiring)
        return undefined //TODO: reduce outstanding allowances if the backed amount is reduced (expired or cancelled)
    return {amount: target, liveUntil: ledger + APPROVAL_TTL_LEDGERS}
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
 */
