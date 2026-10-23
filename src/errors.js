import {StrKey, contract} from '@stellar/stellar-sdk'

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
            const error = contractError(code, findErrorSource(message, code)?.contract, tx.options?.contractId)
            if (error)
                throw error
        }
        throw message
    }
}

/**
 * Wrapped aggregated error - token error when another contract than the DEX raised it, a DEX contract error otherwise
 * @param {number} code - Contract error code
 * @param {string} [source] - Contract that raised the error, when known
 * @param {string} [dexContract] - DEX contract address, when known
 * @return {Error|null} - Null for an unknown code of the DEX
 * @private
 */
function contractError(code, source, dexContract) {
    const raisedByToken = source && dexContract ? source !== dexContract : !ContractErrors[code] && !!TokenErrors[code]
    if (raisedByToken)
        return tokenError(code, source)
    const err = ContractErrors[code]
    if (!err)
        return null
    const error = new Error(`Contract execution error: #${code} ${err.message}`)
    error.code = code
    return error
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
 * Transaction-related error
 * @param {'ERROR'|'TRY_AGAIN_LATER'|'FAILED'|'TIMEOUT'} status - `ERROR`: rejected with a result code (`errorResult`
 * of `sendTransaction`), `TRY_AGAIN_LATER`: not accepted for now (congestion, or another transaction of the account
 * pending), `FAILED`: applied and failed, `TIMEOUT`: not seen before its time bounds expired
 * @param {{hash?: string, result?: xdr.TransactionResult, resultCode?: string, events?: xdr.DiagnosticEvent[], contractId?: string}} [details] -
 * Transaction hash, its result (or its result code, when known without the result), the diagnostic events of a failed
 * call and the DEX contract address
 * @return {Error} - Error with `status`, `hash`, `result` (Horizon-style transaction result code, e.g. `tx_bad_seq`),
 * `opResult` (operation result code of `tx_failed`, e.g. `invoke_host_function_trapped`), and `code` (plus `tokenError`
 * and `contract` for a token) when the diagnostic events name the contract error the call failed with
 * @internal
 */
export function transactionError(status, {hash, result, resultCode: knownCode, events, contractId} = {}) {
    const resultCode = knownCode ?? (result?.result?.type ? snakeCase(result.result.type) : undefined)
    const opResult = operationResultCode(result)
    const cause = events?.length ? findEventError(events) : undefined
    const causeError = cause ? contractError(cause.code, cause.contract, contractId) : null
    let message
    switch (status) {
        case 'ERROR':
            message = `Transaction ${hash} was not accepted by the network: ${resultCode ?? 'unknown result'}`
            break
        case 'TRY_AGAIN_LATER':
            message = `Transaction ${hash} was not accepted by the network for now, try again later`
            break
        case 'FAILED':
            message = `Transaction ${hash} failed: ${resultCode ?? 'unknown result'}${opResult ? ` (${opResult})` : ''}`
            break
        default:
            message = `Transaction ${hash} was not confirmed before its time bounds expired`
    }
    if (causeError) {
        message += `. ${causeError.message}`
    }
    const error = new Error(message)
    error.status = status
    error.hash = hash
    if (resultCode) {
        error.result = resultCode
    }
    if (opResult) {
        error.opResult = opResult
    }
    if (causeError) {
        error.code = causeError.code
        if (causeError.tokenError) {
            error.tokenError = true
            if (causeError.contract) {
                error.contract = causeError.contract
            }
        }
    }
    return error
}

/**
 * Code of the first failed operation of a `tx_failed` result
 * @param {xdr.TransactionResult} [result]
 * @return {string|undefined} - Horizon-style code, e.g. `invoke_host_function_trapped`
 * @private
 */
function operationResultCode(result) {
    if (result?.result?.type !== 'txFailed')
        return undefined
    for (const op of result.result.results || []) {
        //an applied operation reports its own result code, an operation that could not run the outer code
        const code = op.type === 'opInner' ? op.tr?.value?.type : op.type
        if (code && !/Success$/.test(code))
            return snakeCase(code)
    }
    return undefined
}

/**
 * Contract error a failed call raised, from its diagnostic events (oldest first). An error is re-emitted by every frame
 * it fails, so the last error event carries the code the call failed with and the oldest event with that code names the
 * contract that raised it
 * @param {xdr.DiagnosticEvent[]} events
 * @return {{code: number, contract?: string}|undefined}
 * @private
 */
function findEventError(events) {
    const errors = []
    for (const event of events) {
        const code = eventErrorCode(event)
        if (code !== undefined) {
            errors.push({code, contract: eventContract(event)})
        }
    }
    if (!errors.length)
        return undefined
    const {code} = errors[errors.length - 1]
    return {code, contract: errors.find(error => error.code === code && error.contract)?.contract}
}

/**
 * Contract error code of an `error` diagnostic event
 * @param {xdr.DiagnosticEvent} event
 * @return {number|undefined}
 * @private
 */
function eventErrorCode(event) {
    const topics = event?.event?.body?.value?.topics
    if (!topics || topics.length < 2)
        return undefined
    const [name, value] = topics
    if (name.type !== 'scvSymbol' || name.sym.toString() !== 'error')
        return undefined
    if (value.type !== 'scvError' || value.error.type !== 'sceContract')
        return undefined
    return value.error.contractCode
}

/**
 * @param {xdr.DiagnosticEvent} event
 * @return {string|undefined} - Address of the contract that emitted the event
 * @private
 */
function eventContract(event) {
    const id = event.event.contractId
    return id ? StrKey.encodeContract(id.toBytes()) : undefined
}

/**
 * @param {string} name - XDR union arm name, e.g. `txBadSeq`
 * @return {string} - Horizon-style code, e.g. `tx_bad_seq`
 * @private
 */
function snakeCase(name) {
    return name.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())
}
