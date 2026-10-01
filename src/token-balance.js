import {Account, Address, Contract, Keypair, TransactionBuilder, scValToNative, rpc, xdr} from '@stellar/stellar-sdk'

/**
 * Token state for allowance calculation, token balances, and current ledger
 */
export class TokenBalance {
    /**
     * @param {{rpcUrl: string, networkPassphrase: string, spender: string, server?: rpc.Server}} options - `spender`
     *   is the AXIS contract
     */
    constructor({rpcUrl, networkPassphrase, spender, server}) {
        this.server = server || new rpc.Server(rpcUrl, {allowHttp: rpcUrl.startsWith('http://')})
        this.networkPassphrase = networkPassphrase
        this.spender = spender
    }

    /**
     * Allowance `owner` granted to the AXIS contract on a token, 0 when expired
     * @param {string} token - Token contract address
     * @param {string} owner - Token holder address
     * @return {Promise<bigint>}
     * @throws {Error} - If the simulation fails
     */
    async getAllowance(token, owner) {
        const retval = await this.load(token, 'allowance', [new Address(owner).toScVal(), new Address(this.spender).toScVal()], owner)
        return toBigInt(retval)
    }

    /**
     * Token balance of an account
     * @param {string} token - Token contract address
     * @param {string} owner - Token holder address
     * @return {Promise<bigint>} - 0 if the account holds no balance entry
     */
    async getBalance(token, owner) {
        try {
            return toBigInt(await this.load(token, 'balance', [new Address(owner).toScVal()], owner))
        } catch (e) {
            return 0n
        }
    }

    /**
     * Latest closed ledger sequence
     * @return {Promise<number>}
     */
    async getLatestLedger() {
        const {sequence} = await this.server.getLatestLedger()
        return sequence
    }

    /**
     * @param {string} token
     * @param {string} method
     * @param {xdr.ScVal[]} args
     * @param {string} source - Transaction source address
     * @return {Promise<xdr.ScVal>}
     * @private
     */
    async load(token, method, args, source) {
        //a contract address cannot be a transaction source
        const sourceAccount = source.startsWith('G') ? source : Keypair.random().publicKey()
        const tx = new TransactionBuilder(new Account(sourceAccount, '0'), {fee: '100', networkPassphrase: this.networkPassphrase})
            .addOperation(new Contract(token).call(method, ...args))
            .setTimeout(30)
            .build()
        const sim = await this.server.simulateTransaction(tx)
        if (rpc.Api.isSimulationError(sim))
            throw new Error(`Token ${method} simulation failed for ${token}: ${sim.error}`)
        return sim.result.retval
    }
}

/**
 * @param {xdr.ScVal} retval
 * @return {bigint}
 */
function toBigInt(retval) {
    const value = scValToNative(retval)
    return typeof value === 'bigint' ? value : BigInt(value ?? 0)
}
