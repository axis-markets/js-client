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
 * Token functions whose failure is a failed transfer, which either side may have caused
 */
const TRANSFER_FUNCTIONS = new Set(['transfer', 'transfer_from'])

/**
 * Diagnostic `error` event of a contract error
 * @typedef {object} ErrorEvent
 * @property {number} code - Contract error code
 * @property {string} [contract] - Contract that emitted the event, absent for the host outside any contract
 * @property {string} [fn] - Function of the contract whose call failed, on the event its caller emits for the failure
 * @property {boolean} [caught] - The caller caught that failure (`try_call`)
 * @private
 */

/**
 * Contract call an error failed on its way up
 * @typedef {object} ErrorFrame
 * @property {string} [contract] - Contract address, when the event log names it
 * @property {string} [fn] - Function its caller called it with, absent for the invoked contract itself
 * @private
 */

/**
 * Handle simulation errors if any. A contract error raised by the DEX contract is mapped by its code. An error raised by
 * a token transfer the call made is reported with `tokenError` set: a failed payment to a maker fails the whole call
 * with the token's own error, and the contract does not tell whether the payer could not pay or the maker could not be
 * credited (e.g. a full trustline), so neither side is assumed. An error raised by any other contract (the oracle, a
 * token burn) is reported with the `contract` and the `fn` it failed in
 * @param {contract.AssembledTransaction} tx
 * @throws {Error} - Error with numeric `code` property for known contract errors, plus `contract` and `fn` for errors
 *   raised by another contract, and `tokenError` for a failed token transfer; any other failure as an Error with the
 *   raw simulation error in `details`
 * @internal
 */
export function processSimulationErrors(tx) {
    if (tx.simulation?.error) {
        const message = tx.simulation.error
        const contractErrorMatch = /HostError: Error\(Contract, #(\d+)\)/.exec(message)
        if (contractErrorMatch) {
            const code = parseInt(contractErrorMatch[1], 10)
            //RPC servers return the event log in `events`, older ones appended it to the error message
            let events = diagnosticErrorEvents(tx.simulation.events ?? [])
            if (!events.length) {
                events = parseErrorEvents(message)
            }
            const error = contractError(code, findErrorChain(events, code), tx.options?.contractId)
            if (error)
                throw error
        }
        throw simulationError(message)
    }
}

/**
 * Simulation failure without a known contract error (a host or authorization error, an unknown contract code)
 * @param {string} message - Raw simulation error, followed by its diagnostic event log
 * @return {Error} - Error named after the first line of the raw error, which it keeps in `details`
 * @private
 */
function simulationError(message) {
    const error = new Error(`Simulation failed: ${String(message).split('\n', 1)[0].trim()}`)
    error.details = message
    return error
}

/**
 * Wrapped aggregated error: a DEX contract error when the DEX raised it, a token error when a token transfer the DEX
 * made failed (in the token or in a contract the token called), an error of another contract otherwise
 * @param {number} code - Contract error code
 * @param {ErrorFrame[]} chain - Calls the error failed, from the invoked contract down to the one that raised it
 * @param {string} [dexContract] - DEX contract address, when known
 * @return {Error|null} - Null for an unknown code of the DEX, or an error of another contract the log does not name
 * @private
 */
function contractError(code, chain, dexContract) {
    const {contract, fn} = chain[chain.length - 1]
    //only the invoked contract runs without a caller: contracts cannot be re-entered
    const raisedByDex = contract && dexContract ? contract === dexContract : !fn
    if (raisedByDex) {
        const err = ContractErrors[code]
        if (!err)
            return null
        const error = new Error(`Contract execution error: #${code} ${err.message}`)
        error.code = code
        return error
    }
    //the call the DEX made tells a settlement transfer, whatever the token called in turn
    const dexFrame = dexContract ? chain.findIndex(frame => frame.contract === dexContract) : -1
    const call = chain[Math.max(dexFrame, 0) + 1]
    if (TRANSFER_FUNCTIONS.has(call?.fn))
        return tokenError(code, call.contract, call.fn)
    if (!contract)
        return null
    const error = new Error(`Contract ${contract} failed${fn ? ` in ${fn}` : ''}: #${code}`)
    error.code = code
    error.contract = contract
    if (fn) {
        error.fn = fn
    }
    return error
}

/**
 * Calls the error failed on its way up. Every frame the error fails re-emits it, and a failed contract call makes the
 * caller emit an event naming the function it called, which starts the frame of the contract that emitted the older
 * events. The last frame raised the error. A failure its caller caught (`try_call`), or an older event of another
 * contract with no failed call between, ends the chain: errors of caught calls normally carry other codes
 * @param {ErrorEvent[]} events - Error events, newest first
 * @param {number} code - Error code the call failed with
 * @return {ErrorFrame[]} - From the invoked contract down, never empty
 * @private
 */
function findErrorChain(events, code) {
    const chain = [{}]
    for (const event of events) {
        if (event.code !== code)
            continue
        if (event.caught)
            break
        const frame = chain[chain.length - 1]
        if (frame.contract && event.contract && event.contract !== frame.contract)
            break
        frame.contract ??= event.contract
        if (event.fn) {
            chain.push({fn: event.fn})
        }
    }
    return chain
}

/**
 * Contract error events of a simulation error message with the event log appended
 * @param {string} message - Simulation error with its diagnostic event log (newest first)
 * @return {ErrorEvent[]} - Newest first
 * @private
 */
function parseErrorEvents(message) {
    const events = []
    for (const line of message.split('\n')) {
        const match = /\[[^\]]*Event[^\]]*\]\s*(?:contract:(C[A-Z2-7]{55}),\s*)?topics:\[error, Error\(Contract, #(\d+)\)\](?:,\s*data:(.*))?/.exec(line)
        if (!match)
            continue
        const call = /^\["contract (try_)?call failed", (\w+)/.exec(match[3] ?? '')
        events.push({code: parseInt(match[2], 10), contract: match[1], fn: call?.[2], caught: !!call?.[1]})
    }
    return events
}

/**
 * Error raised by a token transfer during settlement
 * @param {number} code - Error code of the token, or of a contract its transfer called
 * @param {string} [contract] - Token contract address, when the event log names it
 * @param {string} fn - Transfer function that failed
 * @return {Error}
 * @private
 */
function tokenError(code, contract, fn) {
    const name = TokenErrors[code]?.message || 'token error'
    const error = new Error(`Token transfer failed: #${code} ${name}${contract ? ` (token ${contract})` : ''}. ` +
        `Either side of the transfer may be at fault: the payer's balance or allowance, or the recipient's trustline ` +
        `(e.g. a full trustline limit).`)
    error.code = code
    error.tokenError = true
    if (contract) {
        error.contract = contract
    }
    error.fn = fn
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
 * `opResult` (operation result code of `tx_failed`, e.g. `invoke_host_function_trapped`), and `code` (plus `contract`
 * and `fn` for another contract, and `tokenError` for a token transfer) when the diagnostic events name the contract
 * error the call failed with
 * @internal
 */
export function transactionError(status, {hash, result, resultCode: knownCode, events, contractId} = {}) {
    const resultCode = knownCode ?? (result?.result?.type ? snakeCase(result.result.type) : undefined)
    const opResult = operationResultCode(result)
    const cause = events?.length ? findEventError(events) : undefined
    const causeError = cause ? contractError(cause.code, cause.chain, contractId) : null
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
        for (const key of ['code', 'tokenError', 'contract', 'fn']) {
            if (causeError[key] !== undefined) {
                error[key] = causeError[key]
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
 * it fails, so the last error event carries the code the call failed with
 * @param {xdr.DiagnosticEvent[]} events
 * @return {{code: number, chain: ErrorFrame[]}|undefined}
 * @private
 */
function findEventError(events) {
    const errors = diagnosticErrorEvents(events)
    if (!errors.length)
        return undefined
    const {code} = errors[0]
    return {code, chain: findErrorChain(errors, code)}
}

/**
 * Contract error events among diagnostic events
 * @param {xdr.DiagnosticEvent[]} events - Oldest first
 * @return {ErrorEvent[]} - Newest first
 * @private
 */
function diagnosticErrorEvents(events) {
    const errors = []
    for (const event of events) {
        const error = errorEvent(event)
        if (error) {
            errors.unshift(error)
        }
    }
    return errors
}

/**
 * Contract error of an `error` diagnostic event
 * @param {xdr.DiagnosticEvent} event
 * @return {ErrorEvent|undefined}
 * @private
 */
function errorEvent(event) {
    const body = event?.event?.body?.value
    const topics = body?.topics
    if (!topics || topics.length < 2)
        return undefined
    const [name, value] = topics
    if (name.type !== 'scvSymbol' || name.sym.toString() !== 'error')
        return undefined
    if (value.type !== 'scvError' || value.error.type !== 'sceContract')
        return undefined
    const error = {code: value.error.contractCode, contract: eventContract(event)}
    //the caller of a failed contract call reports it as ["contract call failed", fn, args]
    const [message, fn] = body.data?.type === 'scvVec' ? body.data.vec ?? [] : []
    const call = message?.type === 'scvString' && /^contract (try_)?call failed$/.exec(message.str.toString())
    if (call && fn?.type === 'scvSymbol') {
        error.fn = fn.sym.toString()
        error.caught = !!call[1]
    }
    return error
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
