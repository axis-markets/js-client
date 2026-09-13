import type {xdr} from "@stellar/stellar-sdk";

/** Upper bound of a serialized `Order` ledger entry in bytes */
export declare const ORDER_ENTRY_SIZE: number;
/** CPU instructions added to the declared budget per order not matched at simulation time */
export declare const ORDER_INSTRUCTIONS: number;
/** Resource fee (stroops) added per order not matched at simulation time */
export declare const ORDER_RESOURCE_FEE: bigint;

/**
 * Flatten and deduplicate order ids from several lists, coercing them to bigint
 * @param idLists - Lists of order ids
 * @return Unique order ids in the order of first appearance
 */
export declare function collectOrderIds(...idLists: Array<Array<bigint | number | string> | undefined | null>): bigint[];

/**
 * Build the persistent contract data ledger key of an order
 * @param contractId - DEX contract address
 * @param orderId - Order id
 */
export declare function orderLedgerKey(contractId: string, orderId: bigint | number | string): xdr.LedgerKey;

/**
 * Make sure every supplied order id is declared in the read-write footprint of a simulated transaction.
 * Patches the simulation data (footprint, resources, resource fee) in place and rebuilds `tx.built`.
 * @param tx - Simulated `AssembledTransaction` from `@stellar/stellar-sdk/contract`
 * @param contractId - DEX contract address
 * @param orderIds - Order ids passed to the contract call
 * @return Number of order entries added to the read-write footprint
 */
export declare function ensureOrdersFootprint(tx: any, contractId: string, orderIds: Array<bigint | number | string>): number;
