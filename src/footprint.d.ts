import type {xdr, Asset, rpc} from "@stellar/stellar-sdk";

/**
 * Upper bound of a serialized `Order` ledger entry in bytes.
 * (positional vector of three addresses, i128 amount and price, optional u64 expires = at most 188-byte value,
 * about 264-byte ledger entry, rounded up to 320).
 */
export declare const ORDER_ENTRY_SIZE: number;
/** CPU instructions added to the declared budget for every order that was not matched at simulation time. */
export declare const ORDER_INSTRUCTIONS: number;
/**
 * Resource fee (stroops) added for every order that was not matched at simulation time.
 * (write entry ~10k, read entry ~6k, writes ~12k, 2M instructions ~5k, trade/order events ~10k).
 */
export declare const ORDER_RESOURCE_FEE: bigint;
/** Upper bound of a maker balance (account, trustline or token balance) or allowance ledger entry in bytes. */
export declare const MAKER_ENTRY_SIZE: number;
/** Resource fee (stroops) added for every maker entry declared read-write (write entry ~10k, its bytes charged as written ~6k). */
export declare const MAKER_ENTRY_RESOURCE_FEE: bigint;
/** CPU instructions added for every maker whose entries were declared (two token transfers, backing and receive checks). */
export declare const MAKER_INSTRUCTIONS: number;
/**
 * Resource fee (stroops) added for every maker whose entries were declared (instructions ~8k, two transfer events and
 * a `skip` event ~4k, rounded up).
 */
export declare const MAKER_RESOURCE_FEE: bigint;
/**
 * CPU instructions added when the settlement entries of the call were declared: the transfer forwarding what the makers
 * delivered from the DEX contract to the receiver, and the receive checks before it.
 */
export declare const FORWARD_INSTRUCTIONS: number;
/**
 * Resource fee (stroops) added when the settlement entries of the call were declared (instructions ~5k, the forwarding
 * `transfer` event ~2k, rounded up).
 */
export declare const FORWARD_RESOURCE_FEE: bigint;

/**
 * Flatten and deduplicate order ids from several lists, coercing them to bigint.
 * @param idLists - Lists of order ids
 * @returns Unique order ids in the order of first appearance
 */
export declare function collectOrderIds(...idLists: Array<Array<bigint | number | string> | undefined | null>): bigint[];

/**
 * Build persistent contract data ledger key of an order (the key is the raw u128 order id).
 * @param contractId - DEX contract address
 * @param orderId - Order id
 */
export declare function orderLedgerKey(contractId: string, orderId: bigint | number | string): xdr.LedgerKey;

/**
 * Build the ledger key of a contract instance entry.
 * @param contractId - Contract address
 */
export declare function instanceLedgerKey(contractId: string): xdr.LedgerKey;

/**
 * Build the ledger key holding the balance of `owner` in a Stellar Asset Contract token.
 * @param owner - Account or contract address
 * @param token - Token contract address
 * @param asset - Classic asset behind the token, `null` for a token that is not a Stellar Asset Contract
 * @returns `null` when the balance has no ledger entry of its own (issuer) or the token storage layout is unknown
 */
export declare function balanceLedgerKey(owner: string, token: string, asset: Asset | null): xdr.LedgerKey | null;

/**
 * Build the ledger key of the allowance `owner` granted to `spender` in a Stellar Asset Contract token.
 * @param owner - Account or contract address granting the allowance
 * @param token - Token contract address
 * @param spender - Spender address (the DEX contract)
 */
export declare function allowanceLedgerKey(owner: string, token: string, spender: string): xdr.LedgerKey;

/**
 * Decode a stored order entry value: a positional vector `[owner, selling, buying, amount, price, expires?]`.
 * @param val - Contract data value of the order entry
 */
export declare function decodeStoredOrder(val: xdr.ScVal): {owner: string, selling: string, buying: string};

/**
 * Resolve the classic asset behind a token from its contract instance entry.
 * @param val - Contract data value of the token instance entry
 * @returns `null` for a token that is not a Stellar Asset Contract
 */
export declare function decodeSacAsset(val: xdr.ScVal): Asset | null;

/**
 * Make sure every supplied order id declared in the read-write footprint of a simulated transaction.
 * @param tx - Simulated transaction
 * @param contractId - DEX contract address
 * @param orderIds - Order ids passed to the contract call
 * @returns Number of order entries added to the read-write footprint
 */
export declare function ensureOrdersFootprint(tx: any, contractId: string, orderIds: Array<bigint | number | string>): number;

export interface FootprintOptions {
    /** RPC server used to load the listed orders and the token instances */
    server: rpc.Server;
    /** Tokens the call trades, resolved together with the orders */
    tokens?: string[];
    /** Classic assets of resolved tokens (`null` for other tokens), reused between calls */
    assetCache?: Map<string, Asset | null>;
    /** Tokens the call moves through the DEX contract's own balance: the bought asset of a trade, every hop asset of a swap */
    passThrough?: string[];
    /** Account the bought asset is forwarded to (the trader, or the crossfill caller paid the surplus) */
    receiver?: string;
    /** Token the receiver gets (the taker order's `buying` by default for a crossfill) */
    bought?: string;
    /** Taker order of a crossfill: the asset it buys passes through the contract */
    takerOrder?: bigint | number | string;
}

/**
 * Complete the footprint of a simulated trading transaction, so it still applies when the book moves between simulation
 * and execution (an order repriced back into range, a maker's backing restored, an earlier order shrunk). Every listed
 * order entry is declared read-write, then the entries the settlement writes for the call itself: the DEX contract's own
 * balance of every asset passing through it (makers deliver to the contract, which forwards to the receiver) and the
 * receiver's balance of the bought asset. Then, for every order's maker, the balance of the asset the maker sells, the
 * allowance on it granted to the DEX contract, and the balance of the asset the maker receives. Tokens that are not
 * Stellar Asset Contracts keep what the simulation recorded (their storage layout is unknown). Entries are added in that
 * order while the footprint limits allow.
 * @param tx - Simulated transaction
 * @param contractId - DEX contract address
 * @param orderIds - Order ids passed to the contract call
 * @returns Number of order, settlement and
 * maker entries added to the read-write footprint
 */
export declare function completeFootprint(tx: any, contractId: string, orderIds: Array<bigint | number | string>, options: FootprintOptions): Promise<{orders: number, settlementEntries: number, makerEntries: number}>;
