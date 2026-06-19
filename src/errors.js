/**
 * Standard contract errors
 */
export const ContractErrors = {
    701: {message: "NotAuthorized"},
    702: {message: "InsufficientBalance"},
    703: {message: "OrderNotFound"},
    704: {message: "Overflow"},
    705: {message: "InvalidMatch"},
    706: {message: "InvalidPrice"}
}
/**
 * Handle simulation errors if any
 * @param {AssembledTransaction} tx
 * @internal
 */
export function processSimulationErrors(tx) {
    if (tx.simulation.error) {
        const contractErrorMatch = /HostError: Error\(Contract, #(\d+)\)/.exec(tx.simulation.error)
        if (contractErrorMatch) {
            const code = contractErrorMatch[1]
            const err = ContractErrors[code]
            if (err) {
                throw new Error(`Contract execution error: #${code} ${err.message} `)
            }
        }
        throw tx.simulation.error
    }
}