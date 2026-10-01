import {Networks} from '@stellar/stellar-sdk'
import ContractClient from '../src/contract-client.js'
import {ContractErrors, processSimulationErrors, processTransactionErrors} from '../src/errors.js'

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

describe('ContractErrors', () => {
    test('mirrors the error enum of the embedded contract spec', () => {
        const client = new ContractClient({contractId: CONTRACT, rpcUrl: 'http://localhost', allowHttp: true, networkPassphrase: Networks.TESTNET})
        const fromSpec = Object.fromEntries(client.spec.errorCases().map(entry => [entry.value, entry.name.toString()]))
        const fromClient = Object.fromEntries(Object.entries(ContractErrors).map(([code, err]) => [code, err.message]))
        expect(fromClient).toEqual(fromSpec)
        expect(Object.keys(fromClient)).toHaveLength(17)
        expect(fromClient[707]).toBe('InvalidExpiration')
        expect(fromClient[740]).toBe('Overflow')
        expect(Object.values(fromClient)).not.toContain('MarketNotFound')
    })
})

describe('processSimulationErrors', () => {
    test('is a no-op for a successful simulation', () => {
        expect(() => processSimulationErrors({simulation: {}})).not.toThrow()
        expect(() => processSimulationErrors({})).not.toThrow()
    })

    test('maps known contract errors to a typed error with the numeric code', () => {
        const tx = {simulation: {error: 'HostError: Error(Contract, #711)\nEvent log: ...'}}
        let error
        try {
            processSimulationErrors(tx)
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe('Contract execution error: #711 OrderExists')
        expect(error.code).toBe(711)
    })

    test('rethrows unknown simulation errors as-is', () => {
        const tx = {simulation: {error: 'HostError: Error(WasmVm, InvalidAction)'}}
        expect(() => processSimulationErrors(tx)).toThrow('HostError: Error(WasmVm, InvalidAction)')
        const unknownCode = {simulation: {error: 'HostError: Error(Contract, #999)'}}
        expect(() => processSimulationErrors(unknownCode)).toThrow('HostError: Error(Contract, #999)')
    })
})

describe('processTransactionErrors', () => {
    test('is a no-op for a successful transaction', () => {
        expect(() => processTransactionErrors({getTransactionResponse: {status: 'SUCCESS', returnValue: {}}})).not.toThrow()
    })

    test('reports a transaction that failed on-chain with its hash and result', () => {
        const sent = {
            sendTransactionResponse: {status: 'PENDING', hash: 'abc123'},
            getTransactionResponse: {
                status: 'FAILED',
                returnValue: undefined,
                resultXdr: {result: {tx_failed: [{op_inner: {invoke_host_function: 'resource_limit_exceeded'}}]}}
            }
        }
        let error
        try {
            processTransactionErrors(sent)
        } catch (e) {
            error = e
        }
        expect(error.message).toBe('Transaction abc123 failed: {"tx_failed":[{"op_inner":{"invoke_host_function":"resource_limit_exceeded"}}]}')
        expect(error.hash).toBe('abc123')
    })
})
