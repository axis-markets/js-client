import {contract} from '@stellar/stellar-sdk'

/**
 * Standard contract errors
 */
export const ContractErrors = {
    701: {message: "NotAuthorized"},
    702: {message: "InsufficientBalance"},
    703: {message: "InsufficientAllowance"},
    704: {message: "InvalidMatch"},
    705: {message: "InvalidPrice"},
    706: {message: "InvalidAmount"},
    707: {message: "InvalidExpiration"},
    708: {message: "CannotReceive"},
    709: {message: "NotFilled"},
    710: {message: "OrderNotFound"},
    711: {message: "OrderExists"},
    712: {message: "IntermediaryCannotReceive"},
    720: {message: "OrderSizeTooSmall"},
    721: {message: "AssetsNotVerifiedByOracle"},
    722: {message: "AssetPriceOracleFetchFailed"},
    723: {message: "InvalidOracleConfig"},
    730: {message: "Frozen"},
    740: {message: "Overflow"}
}

/**
 * Errors of the Stellar Asset Contract, raised by the token transfers a trading call settles with
 */
export const TokenErrors = {
    1: {message: "InternalError"},
    2: {message: "OperationNotSupportedError"},
    3: {message: "AlreadyInitializedError"},
    4: {message: "UnauthorizedError"},
    5: {message: "AuthenticationError"},
    6: {message: "AccountMissingError"},
    7: {message: "AccountIsNotClassic"},
    8: {message: "NegativeAmountError"},
    9: {message: "AllowanceError"},
    10: {message: "BalanceError"},
    11: {message: "BalanceDeauthorizedError"},
    12: {message: "OverflowError"},
    13: {message: "TrustlineMissingError"}
}

/**
 * Handle simulation errors if any. A contract error raised by the DEX contract is mapped by its code. An error raised by
 * another contract the call invoked (the token whose transfer failed) is reported with `tokenError` set: a failed
 * payment to a maker fails the whole call with the token's own error, and the contract does not tell whether the payer
 * could not pay or the maker could not be credited (e.g. a full trustline), so neither side is assumed
 * @param {contract.AssembledTransaction} tx
 * @throws {Error} - Error with numeric `code` property for known contract errors, plus `tokenError` and `contract`
 *   for errors raised by a token
 * @internal
 */
export function processSimulationErrors(tx) {
    if (tx.simulation?.error) {
        const message = tx.simulation.error
        const contractErrorMatch = /HostError: Error\(Contract, #(\d+)\)/.exec(message)
        if (contractErrorMatch) {
            const code = parseInt(contractErrorMatch[1], 10)
            const source = findErrorSource(message, code)
            const dexContract = tx.options?.contractId
            const raisedByToken = source && dexContract ? source.contract !== dexContract : !ContractErrors[code] && !!TokenErrors[code]
            if (raisedByToken)
                throw tokenError(code, source?.contract)
            const err = ContractErrors[code]
            if (err) {
                const error = new Error(`Contract execution error: #${code} ${err.message}`)
                error.code = code
                throw error
            }
        }
        throw message
    }
}

/**
 * Locate the contract that raised the error in a simulation event log. The log lists events newest first and an error
 * is re-emitted by every frame it fails, so the oldest `error` event with the code is where it was raised (errors of
 * caught calls carry other codes)
 * @param {string} message - Simulation error with its diagnostic event log
 * @param {number} code - Error code the simulation failed with
 * @return {{contract: string}|null}
 * @private
 */
function findErrorSource(message, code) {
    let source = null
    for (const match of message.matchAll(/contract:(C[A-Z2-7]{55}),\s*topics:\[error, Error\(Contract, #(\d+)\)/g)) {
        if (parseInt(match[2], 10) === code) {
            source = {contract: match[1]}
        }
    }
    return source
}

/**
 * Error raised by a token transfer during settlement
 * @param {number} code - Token error code
 * @param {string} [contract] - Token contract address, when the event log names it
 * @return {Error}
 * @private
 */
function tokenError(code, contract) {
    const name = TokenErrors[code]?.message || 'token error'
    const error = new Error(`Token transfer failed: #${code} ${name}${contract ? ` (token ${contract})` : ''}. ` +
        `Either side of the transfer may be at fault: the payer's balance or allowance, or the recipient's trustline ` +
        `(e.g. a full trustline limit).`)
    error.code = code
    error.tokenError = true
    if (contract) {
        error.contract = contract
    }
    return error
}

/**
 * Handle the failure of a transaction applied on-chain
 * @param {contract.SentTransaction} sent
 * @throws {Error} - Error with the transaction `hash` and its result
 * @internal
 */
export function processTransactionErrors(sent) {
    const response = sent.getTransactionResponse
    if (response?.status !== 'FAILED')
        return
    const hash = sent.sendTransactionResponse?.hash
    const error = new Error(`Transaction ${hash} failed: ${JSON.stringify(response.resultXdr?.result, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`)
    error.hash = hash
    throw error
}
