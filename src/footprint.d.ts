import type {xdr, Asset, rpc} from "@stellar/stellar-sdk";

/** Upper bound of a serialized `Order` ledger entry in bytes */
export declare const ORDER_ENTRY_SIZE: number;
/** CPU instructions added to the declared budget per order not matched at simulation time */
export declare const ORDER_INSTRUCTIONS: number;
/** Resource fee (stroops) added per order not matched at simulation time */
export declare const ORDER_RESOURCE_FEE: bigint;
/** Upper bound of a maker balance or allowance ledger entry in bytes */
export declare const MAKER_ENTRY_SIZE: number;
/** Resource fee (stroops) added per maker entry declared read-write */
export declare const MAKER_ENTRY_RESOURCE_FEE: bigint;
/** CPU instructions added per maker whose entries were declared */
export declare const MAKER_INSTRUCTIONS: number;
/** Resource fee (stroops) added per maker whose entries were declared */
export declare const MAKER_RESOURCE_FEE: bigint;

/**
 * Flatten and deduplicate order ids from several lists, coercing them to bigint
 * @param idLists - Lists of order ids
 * @return Unique order ids in the order of first appearance
 */
export declare function collectOrderIds(...idLists: Array<Array<bigint | number | string> | undefined | null>): bigint[];

/**
 * Build the persistent contract data ledger key of an order (the key is the raw u128 order id)
 * @param contractId - DEX contract address
 * @param orderId - Order id
 */
export declare function orderLedgerKey(contractId: string, orderId: bigint | number | string): xdr.LedgerKey;

/**
 * Build the ledger key of a contract instance entry
 * @param contractId - Contract address
 */
export declare function instanceLedgerKey(contractId: string): xdr.LedgerKey;

/**
 * Build the ledger key holding the balance of `owner` in a Stellar Asset Contract token
 * @param owner - Account or contract address
 * @param token - Token contract address
 * @param asset - Classic asset behind the token, `null` for a token that is not a Stellar Asset Contract
 * @return `null` when the balance has no ledger entry of its own (issuer) or the token storage layout is unknown
 */
export declare function balanceLedgerKey(owner: string, token: string, asset: Asset | null): xdr.LedgerKey | null;

/**
 * Build the ledger key of the allowance `owner` granted to `spender` in a Stellar Asset Contract token
 * @param owner - Account or contract address granting the allowance
 * @param token - Token contract address
 * @param spender - Spender address (the DEX contract)
 */
export declare function allowanceLedgerKey(owner: string, token: string, spender: string): xdr.LedgerKey;

/**
 * Decode a stored order entry value: a positional vector `[owner, selling, buying, amount, price, expires?]`
 * @param val - Contract data value of the order entry
 */
export declare function decodeStoredOrder(val: xdr.ScVal): {owner: string, selling: string, buying: string};

/**
 * Resolve the classic asset behind a token from its contract instance entry
 * @param val - Contract data value of the token instance entry
 * @return `null` for a token that is not a Stellar Asset Contract
 */
export declare function decodeSacAsset(val: xdr.ScVal): Asset | null;

/**
 * Make sure every supplied order id is declared in the read-write footprint of a simulated transaction.
 * Patches the simulation data (footprint, resources, resource fee) in place and rebuilds `tx.built`.
 * @param tx - Simulated `AssembledTransaction` from `@stellar/stellar-sdk/contract`
 * @param contractId - DEX contract address
 * @param orderIds - Order ids passed to the contract call
 * @return Number of order entries added to the read-write footprint
 */
export declare function ensureOrdersFootprint(tx: any, contractId: string, orderIds: Array<bigint | number | string>): number;

export interface FootprintOptions {
    /** RPC server used to load the listed orders and the token instances */
    server: rpc.Server;
    /** Tokens the call trades, resolved together with the orders */
    tokens?: string[];
    /** Classic assets of resolved tokens (`null` for other tokens), reused between calls */
    assetCache?: Map<string, Asset | null>;
}

/**
 * Complete the footprint of a simulated trading transaction so it still applies when the book moves between simulation
 * and execution (an order repriced back into range, a maker's backing restored, an earlier order shrunk): every listed
 * order entry, and for every maker behind them the balance of the asset they sell, their allowance on it to the DEX
 * contract and the balance of the asset they receive, are declared read-write (orders first, in list order, while the
 * footprint limits allow). Makers of tokens that are not Stellar Asset Contracts keep what the simulation recorded
 * (their storage layout is unknown).
 * Patches the simulation data (footprint, resources including disk read bytes, resource fee) in place and rebuilds
 * `tx.built`.
 * @param tx - Simulated `AssembledTransaction` from `@stellar/stellar-sdk/contract`
 * @param contractId - DEX contract address
 * @param orderIds - Order ids passed to the contract call
 * @param options - RPC server, traded tokens and the asset cache
 * @return Number of order and maker entries added to the read-write footprint
 */
export declare function completeFootprint(tx: any, contractId: string, orderIds: Array<bigint | number | string>, options: FootprintOptions): Promise<{orders: number, makerEntries: number}>;
