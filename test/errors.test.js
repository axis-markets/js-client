import {jest} from '@jest/globals'
import {Account, Networks, Operation, StrKey, TransactionBuilder, xdr} from '@stellar/stellar-sdk'
import ContractClient from '../src/contract-client.js'
import {ContractErrors, processSimulationErrors, transactionError} from '../src/errors.js'
import {AxisContractClient} from '../src/index.js'

const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const TOKEN = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
const TRADER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

/** Result of a transaction rejected with a result code */
const rejected = code => new xdr.TransactionResult({feeCharged: 155_847n, result: xdr.TransactionResultResult[code](), ext: xdr.TransactionResultExt.v0()})

/** Result of a contract call that failed on-chain */
const trapped = () => new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txFailed([
        xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped()))
    ]),
    ext: xdr.TransactionResultExt.v0()
})

/** Diagnostic `error` event of a contract (none for an event the host emits outside a contract) */
function errorEvent(code, contract) {
    return new xdr.DiagnosticEvent({
        inSuccessfulContractCall: false,
        event: new xdr.ContractEvent({
            ext: xdr.ExtensionPoint.v0(),
            contractId: contract ? new xdr.ContractId(StrKey.decodeContract(contract)) : null,
            type: xdr.ContractEventType.diagnostic,
            body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
                topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
                data: xdr.ScVal.scvVoid()
            }))
        })
    })
}

describe('ContractErrors', () => {
    test('mirrors the error enum of the embedded contract spec', () => {
        const client = new ContractClient({contractId: CONTRACT, rpcUrl: 'http://localhost', allowHttp: true, networkPassphrase: Networks.TESTNET})
        const fromSpec = Object.fromEntries(client.spec.errorCases().map(entry => [entry.value, entry.name.toString()]))
        const fromClient = Object.fromEntries(Object.entries(ContractErrors).map(([code, err]) => [code, err.message]))
        expect(fromClient).toEqual(fromSpec)
        expect(Object.keys(fromClient)).toHaveLength(18)
        expect(fromClient[712]).toBe('IntermediaryCannotReceive')
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

    test('reports an error raised by a token transfer as a token error, blaming neither side', () => {
        const token = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
        const tx = {
            options: {contractId: CONTRACT},
            simulation: {
                error: 'HostError: Error(Contract, #10)\n\nEvent log (newest first):\n' +
                    `   0: [Diagnostic Event] contract:${CONTRACT}, topics:[error, Error(Contract, #10)], data:["contract call failed", transfer_from]\n` +
                    `   1: [Diagnostic Event] contract:${token}, topics:[error, Error(Contract, #10)], data:"balance"\n` +
                    //a maker transfer that failed earlier, caught by the contract (the maker was skipped)
                    `   2: [Diagnostic Event] contract:${token}, topics:[error, Error(Contract, #11)], data:"deauthorized"\n`
            }
        }
        let error
        try {
            processSimulationErrors(tx)
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(Error)
        expect(error).toMatchObject({code: 10, tokenError: true, contract: token})
        expect(error.message).toContain('BalanceError')
        expect(error.message).toContain('Either side')
    })

    test('a DEX error stays a contract error even when a caught token error preceded it', () => {
        const token = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
        const tx = {
            options: {contractId: CONTRACT},
            simulation: {
                error: 'HostError: Error(Contract, #708)\n\nEvent log (newest first):\n' +
                    `   0: [Diagnostic Event] contract:${CONTRACT}, topics:[error, Error(Contract, #708)], data:"escalating"\n` +
                    `   1: [Diagnostic Event] contract:${token}, topics:[error, Error(Contract, #10)], data:"limit"\n`
            }
        }
        expect(() => processSimulationErrors(tx)).toThrow('Contract execution error: #708 CannotReceive')
        //without an event log, a code of the Stellar Asset Contract is a token error
        const bare = {simulation: {error: 'HostError: Error(Contract, #9)'}}
        expect(() => processSimulationErrors(bare)).toThrow(expect.objectContaining({code: 9, tokenError: true}))
        const axis = {simulation: {error: 'HostError: Error(Contract, #712)'}}
        expect(() => processSimulationErrors(axis)).toThrow('Contract execution error: #712 IntermediaryCannotReceive')
    })

    test('rethrows unknown simulation errors as-is', () => {
        const tx = {simulation: {error: 'HostError: Error(WasmVm, InvalidAction)'}}
        expect(() => processSimulationErrors(tx)).toThrow('HostError: Error(WasmVm, InvalidAction)')
        const unknownCode = {simulation: {error: 'HostError: Error(Contract, #999)'}}
        expect(() => processSimulationErrors(unknownCode)).toThrow('HostError: Error(Contract, #999)')
    })
})

describe('transactionError', () => {
    test('names the result code of a transaction the network did not accept', () => {
        const error = transactionError('ERROR', {hash: 'abc', result: rejected('txBadSeq')})
        expect(error).toMatchObject({status: 'ERROR', result: 'tx_bad_seq', hash: 'abc'})
        expect(error.message).toBe('Transaction abc was not accepted by the network: tx_bad_seq')
        //wallets report a declined signature as "rejected": a network error must not read like one
        expect(error.message).not.toMatch(/rejected|denied|declined/i)
        expect(transactionError('ERROR', {result: rejected('txInsufficientFee')}).result).toBe('tx_insufficient_fee')
        expect(transactionError('TRY_AGAIN_LATER', {hash: 'abc'})).toMatchObject({status: 'TRY_AGAIN_LATER', hash: 'abc'})
        expect(transactionError('TIMEOUT', {hash: 'abc'}).message).toBe('Transaction abc was not confirmed before its time bounds expired')
    })

    test('reports the operation result and the contract error of a failed call', () => {
        const error = transactionError('FAILED', {
            hash: 'abc',
            result: trapped(),
            //oldest first: the DEX raised NotFilled, the host escalated it outside any contract
            events: [errorEvent(709, CONTRACT), errorEvent(709)],
            contractId: CONTRACT
        })
        expect(error).toMatchObject({status: 'FAILED', result: 'tx_failed', opResult: 'invoke_host_function_trapped', code: 709})
        expect(error.tokenError).toBeUndefined()
        expect(error.message).toBe('Transaction abc failed: tx_failed (invoke_host_function_trapped). Contract execution error: #709 NotFilled')
    })

    test('blames no side of a token transfer that failed on-chain', () => {
        const error = transactionError('FAILED', {
            result: trapped(),
            //a maker transfer caught earlier, then the token error the DEX re-raised
            events: [errorEvent(11, TOKEN), errorEvent(10, TOKEN), errorEvent(10, CONTRACT)],
            contractId: CONTRACT
        })
        expect(error).toMatchObject({code: 10, tokenError: true, contract: TOKEN})
        expect(error.message).toContain('BalanceError')
    })

    test('omits the code when the network kept no diagnostic events', () => {
        const error = transactionError('FAILED', {hash: 'abc', result: trapped(), events: []})
        expect(error).toMatchObject({status: 'FAILED', result: 'tx_failed', opResult: 'invoke_host_function_trapped'})
        expect(error.code).toBeUndefined()
    })
})

describe('transaction submission', () => {
    /** Signed transaction double, valid until `maxTime` */
    function signedTx(maxTime = Math.floor(Date.now() / 1000) + 300) {
        return new TransactionBuilder(new Account(TRADER, '1'), {fee: '100', networkPassphrase: Networks.TESTNET, timebounds: {minTime: 0, maxTime}})
            .addOperation(Operation.bumpSequence({bumpTo: '2'}))
            .build()
    }

    /** Client whose `update` call is submitted to the given RPC server double */
    function setup(server, tx = signedTx()) {
        const axis = new AxisContractClient({publicKey: TRADER, contractId: CONTRACT, rpcUrl: 'http://localhost', networkPassphrase: Networks.TESTNET})
        axis.updateFootprint = () => {}
        axis.client.update = async () => ({
            simulation: {},
            options: {contractId: CONTRACT, parseResultXdr: value => value},
            server,
            async sign() {
                this.signed = tx
            }
        })
        const hash = Buffer.from(tx.hash()).toString('hex')
        return {submit: () => axis.update({trader: TRADER, updates: []}), hash}
    }

    /** A status response once a ledger closed past the time bounds: the transaction can no longer be included */
    const expired = {status: 'NOT_FOUND', latestLedgerCloseTime: String(Math.floor(Date.now() / 1000) + 3600)}

    test('returns the parsed result of an included transaction, including a duplicate submission', async () => {
        const statuses = ['NOT_FOUND', 'SUCCESS']
        const {submit} = setup({
            sendTransaction: async () => ({status: 'DUPLICATE'}),
            getTransaction: async () => ({status: statuses.shift(), returnValue: [1n]})
        })
        expect(await submit()).toEqual([1n])
    })

    test('reports a transaction the network did not accept with its result code', async () => {
        const {submit, hash} = setup({sendTransaction: async () => ({status: 'ERROR', errorResult: rejected('txBadSeq')})})
        await expect(submit()).rejects.toThrow(expect.objectContaining({status: 'ERROR', result: 'tx_bad_seq', hash}))
        const busy = setup({sendTransaction: async () => ({status: 'TRY_AGAIN_LATER'})})
        await expect(busy.submit()).rejects.toThrow(expect.objectContaining({status: 'TRY_AGAIN_LATER'}))
    })

    test('reports a transaction that failed on-chain with the error its call raised', async () => {
        const {submit} = setup({
            sendTransaction: async () => ({status: 'PENDING'}),
            //the events kept in the transaction meta when the RPC server reports none separately
            getTransaction: async () => ({status: 'FAILED', resultXdr: trapped(), resultMetaXdr: {value: {diagnosticEvents: [errorEvent(709, CONTRACT)]}}})
        })
        await expect(submit()).rejects.toThrow(expect.objectContaining({status: 'FAILED', opResult: 'invoke_host_function_trapped', code: 709}))
    })

    test('reports a pending transaction another one replaced as a sequence number rejection', async () => {
        jest.useFakeTimers()
        try {
            let ledger = 100
            const {submit, hash} = setup({
                sendTransaction: async () => ({status: 'PENDING'}),
                getTransaction: async () => ({status: 'NOT_FOUND', latestLedger: ledger++}),
                //the source account already used the sequence number of the transaction (2)
                getLedgerEntries: async () => ({latestLedger: 102, entries: [{val: {value: {seqNum: 2n}}}]})
            })
            const result = submit().catch(e => e)
            await jest.advanceTimersByTimeAsync(20_000)
            expect(await result).toMatchObject({status: 'ERROR', result: 'tx_bad_seq', hash})
        } finally {
            jest.useRealTimers()
        }
    })

    test('does not take a status from a lagging server for a replaced transaction', async () => {
        jest.useFakeTimers()
        try {
            const responses = [100, 101, 102].map(latestLedger => ({status: 'NOT_FOUND', latestLedger}))
            responses.push({status: 'SUCCESS', latestLedger: 106, returnValue: [3n]})
            const {submit} = setup({
                sendTransaction: async () => ({status: 'PENDING'}),
                getTransaction: async () => responses.shift(),
                //seen by another server of the pool, ahead of the one answering the status requests
                getLedgerEntries: async () => ({latestLedger: 105, entries: [{val: {value: {seqNum: 2n}}}]})
            })
            const result = submit()
            await jest.advanceTimersByTimeAsync(20_000)
            expect(await result).toEqual([3n])
        } finally {
            jest.useRealTimers()
        }
    })

    test('reports a transaction not included before its time bounds expired', async () => {
        const {submit, hash} = setup({sendTransaction: async () => ({status: 'PENDING'}), getTransaction: async () => expired})
        await expect(submit()).rejects.toThrow(expect.objectContaining({status: 'TIMEOUT', hash}))
    })

    test('looks for a transaction whose submission request failed before reporting it', async () => {
        const unreachable = async () => {
            throw new Error('Failed to fetch')
        }
        const found = setup({sendTransaction: unreachable, getTransaction: async () => ({status: 'SUCCESS', returnValue: [2n]})})
        expect(await found.submit()).toEqual([2n])
        //never seen: the request error, with the hash to look the transaction up later
        const lost = setup({sendTransaction: unreachable, getTransaction: unreachable}, signedTx(Math.floor(Date.now() / 1000) - 100))
        await expect(lost.submit()).rejects.toThrow(expect.objectContaining({message: 'Failed to fetch', hash: lost.hash}))
    })
})
