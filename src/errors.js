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
    720: {message: "OrderSizeTooSmall"},
    721: {message: "AssetsNotVerifiedByOracle"},
    722: {message: "AssetPriceOracleFetchFailed"},
    723: {message: "InvalidOracleConfig"},
    730: {message: "Frozen"},
    740: {message: "Overflow"}
}

/**
 * Handle simulation errors if any
 * @param {AssembledTransaction} tx
 * @throws {Error} - Error with numeric `code` property for known contract errors
 * @internal
 */
export function processSimulationErrors(tx) {
    if (tx.simulation?.error) {
        const contractErrorMatch = /HostError: Error\(Contract, #(\d+)\)/.exec(tx.simulation.error)
        if (contractErrorMatch) {
            const code = contractErrorMatch[1]
            const err = ContractErrors[code]
            if (err) {
                const error = new Error(`Contract execution error: #${code} ${err.message}`)
                error.code = parseInt(code, 10)
                throw error
            }
        }
        throw tx.simulation.error
    }
}
