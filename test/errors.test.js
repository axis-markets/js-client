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

const ORACLE = 'CDEIQLTE3Y3XQMYPSZFJC2OXIS67F4MURGP73NCE2C2NZZ22RNSPV7ZI'
const FEE_TOKEN = 'CBULLEXCJPG2734I5V62IMZSCM3GOH3L55BHKNBIDRK2QIR5YH4SN6IJ'

/**
 * Diagnostic `error` event of a contract (none for an event the host emits outside a contract), with the call that
 * failed (`fn`) when the caller reports it
 */
function errorEvent(code, contract, fn, caught = false) {
    const data = fn ?
        xdr.ScVal.scvVec([xdr.ScVal.scvString(`contract ${caught ? 'try_' : ''}call failed`), xdr.ScVal.scvSymbol(fn), xdr.ScVal.scvVec([])]) :
        xdr.ScVal.scvVoid()
    return new xdr.DiagnosticEvent({
        inSuccessfulContractCall: false,
        event: new xdr.ContractEvent({
            ext: xdr.ExtensionPoint.v0(),
            contractId: contract ? new xdr.ContractId(StrKey.decodeContract(contract)) : null,
            type: xdr.ContractEventType.diagnostic,
            body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({
                topics: [xdr.ScVal.scvSymbol('error'), xdr.ScVal.scvError(xdr.ScError.sceContract(code))],
                data
            }))
        })
    })
}

/** Simulation error with its event log, events given newest first as [contract, code, data] */
function simulationLog(code, events) {
    return 'HostError: Error(Contract, #' + code + ')\n\nEvent log (newest first):\n' +
        events.map(([contract, eventCode, data], i) =>
            `   ${i}: [Diagnostic Event] ${contract ? `contract:${contract}, ` : ''}topics:[error, Error(Contract, #${eventCode})], data:${data}\n`).join('')
}

/** Error thrown by processSimulationErrors */
function simulationFailure(tx) {
    try {
        processSimulationErrors(tx)
    } catch (e) {
        return e
    }
    throw new Error('Simulation error expected')
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
        expect(error).toMatchObject({code: 10, tokenError: true, contract: token, fn: 'transfer_from'})
        expect(error.message).toContain('BalanceError')
        expect(error.message).toContain('Either side')
    })

    test('reports an error of another contract with the contract and the function it failed in', () => {
        //subsidize: the oracle rejects track
        const error = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: simulationLog(103, [
                    [CONTRACT, 103, '"escalating error to VM trap from failed host function call: call"'],
                    [CONTRACT, 103, `["contract call failed", track, [${TRADER}, ${CONTRACT}, [], 100]]`],
                    [ORACLE, 103, '"failing with contract error"']
                ])
            }
        })
        expect(error.message).toBe(`Contract ${ORACLE} failed in track: #103`)
        expect(error).toMatchObject({code: 103, contract: ORACLE, fn: 'track'})
        expect(error.tokenError).toBeUndefined()
    })

    test('a failed token burn is not a transfer failure', () => {
        //subsidize: the oracle burns the fee token of a sponsor without the balance
        const error = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: simulationLog(10, [
                    [CONTRACT, 10, '"escalating error to VM trap from failed host function call: call"'],
                    [CONTRACT, 10, `["contract call failed", track, [${TRADER}, ${CONTRACT}, [], 100]]`],
                    [ORACLE, 10, '"escalating error to VM trap from failed host function call: call"'],
                    [ORACLE, 10, `["contract call failed", burn, [${TRADER}, 100]]`],
                    [FEE_TOKEN, 10, '"balance is not sufficient to spend"']
                ])
            }
        })
        expect(error.message).toBe(`Contract ${FEE_TOKEN} failed in burn: #10`)
        expect(error).toMatchObject({code: 10, contract: FEE_TOKEN, fn: 'burn'})
        expect(error.tokenError).toBeUndefined()
    })

    test('reads the event log the RPC server returns in events', () => {
        //as simulated on Testnet: subsidize of a sponsor without a fee token trustline, the message has no log
        const burn = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: 'HostError: Error(Contract, #13)',
                events: [errorEvent(13, FEE_TOKEN), errorEvent(13, ORACLE, 'burn'), errorEvent(13, ORACLE),
                    errorEvent(13, CONTRACT, 'track'), errorEvent(13, CONTRACT)]
            }
        })
        expect(burn.message).toBe(`Contract ${FEE_TOKEN} failed in burn: #13`)
        expect(burn).toMatchObject({code: 13, contract: FEE_TOKEN, fn: 'burn'})
        expect(burn.tokenError).toBeUndefined()
        const transfer = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: 'HostError: Error(Contract, #10)',
                events: [errorEvent(10, TOKEN), errorEvent(10, CONTRACT, 'transfer'), errorEvent(10, CONTRACT)]
            }
        })
        expect(transfer).toMatchObject({code: 10, tokenError: true, contract: TOKEN, fn: 'transfer'})
    })

    test('a transfer that fails in a contract the token calls is still a token error', () => {
        //a token with a compliance module: the DEX called transfer_from, the module refused it
        const events = [errorEvent(5, ORACLE), errorEvent(5, TOKEN, 'can_transfer'), errorEvent(5, TOKEN),
            errorEvent(5, CONTRACT, 'transfer_from'), errorEvent(5, CONTRACT)]
        const error = simulationFailure({options: {contractId: CONTRACT}, simulation: {error: 'HostError: Error(Contract, #5)', events}})
        expect(error).toMatchObject({code: 5, tokenError: true, contract: TOKEN, fn: 'transfer_from'})
        //the same call through a contract that invoked the DEX
        const router = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
        const routed = transactionError('FAILED', {
            events: [...events, errorEvent(5, router, 'trade'), errorEvent(5, router)],
            contractId: CONTRACT
        })
        expect(routed).toMatchObject({code: 5, tokenError: true, contract: TOKEN, fn: 'transfer_from'})
        //a transfer the oracle makes is not a settlement transfer
        const charged = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: 'HostError: Error(Contract, #10)',
                events: [errorEvent(10, FEE_TOKEN), errorEvent(10, ORACLE, 'transfer'), errorEvent(10, ORACLE),
                    errorEvent(10, CONTRACT, 'track'), errorEvent(10, CONTRACT)]
            }
        })
        expect(charged).toMatchObject({code: 10, contract: FEE_TOKEN, fn: 'transfer'})
        expect(charged.tokenError).toBeUndefined()
    })

    test('falls back to the event log of the message when events hold no error', () => {
        const error = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: simulationLog(10, [[CONTRACT, 10, '["contract call failed", transfer_from, []]'], [TOKEN, 10, '"balance"']]),
                events: [new xdr.DiagnosticEvent({
                    inSuccessfulContractCall: false,
                    event: new xdr.ContractEvent({
                        ext: xdr.ExtensionPoint.v0(),
                        contractId: null,
                        type: xdr.ContractEventType.diagnostic,
                        body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({topics: [xdr.ScVal.scvSymbol('fn_call')], data: xdr.ScVal.scvVoid()}))
                    })
                })]
            }
        })
        expect(error).toMatchObject({code: 10, tokenError: true, contract: TOKEN, fn: 'transfer_from'})
    })

    test('a failure the contract caught ends the chain, even with the same code', () => {
        const other = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75'
        const error = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {
                error: simulationLog(10, [
                    [CONTRACT, 10, `["contract call failed", transfer_from, [${TRADER}, ${TRADER}, 5]]`],
                    [TOKEN, 10, '"balance"'],
                    //a maker whose asset could not be collected, skipped earlier
                    [CONTRACT, 10, `["contract try_call failed", transfer_from, [${TRADER}, ${CONTRACT}, 5]]`],
                    [other, 10, '"balance"']
                ])
            }
        })
        expect(error).toMatchObject({code: 10, tokenError: true, contract: TOKEN, fn: 'transfer_from'})
        //host events outside any contract name no contract
        const dex = simulationFailure({
            options: {contractId: CONTRACT},
            simulation: {error: simulationLog(709, [[null, 709, '"escalating error to panic"'], [CONTRACT, 709, '"not filled"']])}
        })
        expect(dex.message).toBe('Contract execution error: #709 NotFilled')
        expect(dex.contract).toBeUndefined()
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
        //without an event log, a code the DEX does not define names nobody
        const bare = simulationFailure({simulation: {error: 'HostError: Error(Contract, #9)'}})
        expect(bare.message).toBe('Simulation failed: HostError: Error(Contract, #9)')
        expect(bare.tokenError).toBeUndefined()
        const axis = {simulation: {error: 'HostError: Error(Contract, #712)'}}
        expect(() => processSimulationErrors(axis)).toThrow('Contract execution error: #712 IntermediaryCannotReceive')
    })

    test('wraps other simulation errors, keeping the raw error in details', () => {
        const raw = 'HostError: Error(WasmVm, InvalidAction)\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...'
        for (const [error, message] of [[raw, 'Simulation failed: HostError: Error(WasmVm, InvalidAction)'],
            ['HostError: Error(Contract, #999)', 'Simulation failed: HostError: Error(Contract, #999)']]) {
            let thrown
            try {
                processSimulationErrors({simulation: {error}})
            } catch (e) {
                thrown = e
            }
            expect(thrown).toBeInstanceOf(Error)
            expect(thrown.message).toBe(message)
            expect(thrown.details).toBe(error)
            expect(thrown.code).toBeUndefined()
        }
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
            events: [errorEvent(11, TOKEN), errorEvent(11, CONTRACT, 'transfer_from', true), errorEvent(10, TOKEN),
                errorEvent(10, CONTRACT, 'transfer_from'), errorEvent(10, CONTRACT)],
            contractId: CONTRACT
        })
        expect(error).toMatchObject({code: 10, tokenError: true, contract: TOKEN, fn: 'transfer_from'})
        expect(error.message).toContain('BalanceError')
    })

    test('names another contract that failed on-chain', () => {
        const error = transactionError('FAILED', {
            hash: 'abc',
            result: trapped(),
            events: [errorEvent(103, ORACLE), errorEvent(103, CONTRACT, 'track'), errorEvent(103, CONTRACT), errorEvent(103)],
            contractId: CONTRACT
        })
        expect(error).toMatchObject({status: 'FAILED', code: 103, contract: ORACLE, fn: 'track'})
        expect(error.tokenError).toBeUndefined()
        expect(error.message).toBe(`Transaction abc failed: tx_failed (invoke_host_function_trapped). Contract ${ORACLE} failed in track: #103`)
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
