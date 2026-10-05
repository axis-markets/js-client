import type {rpc} from "@stellar/stellar-sdk";

/** Trading order type */
export enum OrderKind {
    /** Execute trade, create a limit order if not executed in full */
    Limit = 1,
    /** Execute trade without creating a limit order */
    Fill = 2,
    /** Execute trade, cancel if was not executed in full */
    FillOrKill = 3,
}

/** Trade direction instructions */
export enum TradeDirection {
    Sell = 1,
    Buy = 2,
}

/** Order properties, stored on-chain */
export interface Order {
    /** Amount left to sell */
    amount: bigint;
    /** Buying token address */
    buying: string;
    /** Expiration UNIX timestamp in seconds (0 = no expiration) */
    expires: bigint;
    /** Unique order identifier, derived from the owner and the client nonce */
    id: bigint;
    /** Maker address */
    owner: string;
    /** Order price (`buying` per 1 `selling`, 18 decimals) */
    price: bigint;
    /** Selling token address */
    selling: string;
}

/** Token allowance granted to the contract as part of the call */
export interface Approval {
    /** Token the allowance is granted on */
    asset?: string;
    /** Absolute allowance amount (0 revokes the approval) */
    amount: bigint;
    /** Ledger sequence the allowance lives until */
    liveUntil: number;
}

/** New amount, price and expiration for an existing order */
export interface OrderUpdate {
    /** Order id */
    id: bigint;
    /** New amount to sell, 0 removes the order */
    amount: bigint;
    /** New order price (ignored for a removal) */
    price: bigint;
    /** New expiration UNIX timestamp (in seconds), 0 or omitted = no expiration */
    expires?: bigint | number;
}

/** Contract configuration */
export interface Config {
    /** Address of the account allowed to freeze the contract and change the configuration */
    safety_admin: string;
    /** Oracle contract address */
    oracle: string;
    /** Days of price feeds a new market must buy (0 opens markets without a fee) */
    listing_min_days: number;
    /** Amount of oracle fee tokens paid by the market creator to provision the oracle price feeds (the oracle daily fee x `listing_min_days`) */
    market_listing_fee: bigint;
    /** Minimum trade value in USD, with 7 decimals precision (0 disables the limit) */
    min_trade_size: bigint;
    /** Expected average ledger close time in seconds, used to convert entry lifetimes into ledgers */
    ledger_time: number;
}

/** Market asset descriptor */
export interface MarketSide {
    /** Token contract address */
    asset: string;
    /** Whether the asset is quoted by the oracle (with token decimals the valuation can handle) */
    listed: boolean;
    /** Token decimals (fetched only for listed assets) */
    decimals: number;
}

/** Market record, stored on-chain */
export interface Market {
    /** Base asset, the first of the pair in canonical order */
    base: MarketSide;
    /** Quote asset, the second of the pair in canonical order */
    quote: MarketSide;
    /** Creation UNIX timestamp in seconds */
    created: bigint;
}

/** Orderbook `trade` event, one per fill */
export interface TradeContractEvent {
    /** Asset sold by the taker (topic) */
    selling: string;
    /** Asset bought by the taker (topic) */
    buying: string;
    /** Maker order id */
    order: bigint;
    /** Trader account address */
    taker: string;
    /** Seller account address */
    maker: string;
    /** Sold tokens amount */
    sold: bigint;
    /** Bought tokens amount */
    bought: bigint;
    /** Order amount left after the fill (0 = removed) */
    left: bigint;
}

/** Orderbook `swap` event, one per call */
export interface SwapContractEvent {
    /** Asset sold by the trader (topic) */
    selling: string;
    /** Asset received by the trader (topic) */
    buying: string;
    /** Trader account address */
    trader: string;
    /** Amount of `selling` tokens sold */
    sold: bigint;
    /** Amount of `buying` tokens received */
    bought: bigint;
}

/** Orderbook `new` event, an order created */
export interface OrderCreatedContractEvent {
    /** Selling asset address (topic) */
    selling: string;
    /** Buying asset address (topic) */
    buying: string;
    /** Unique order identifier */
    id: bigint;
    /** Maker address */
    owner: string;
    /** Order price */
    price: bigint;
    /** Current amount */
    amount: bigint;
    /** Expiration UNIX timestamp in seconds (0 = no expiration) */
    expires: bigint;
}

/** Orderbook `mod` event, an order changed outside a fill */
export interface OrderUpdatedContractEvent {
    /** Unique order identifier */
    id: bigint;
    /** Order price */
    price: bigint;
    /** Current amount (0 = removed) */
    amount: bigint;
    /** Expiration UNIX timestamp in seconds (0 = no expiration) */
    expires: bigint;
}

/**
 * Orderbook `skip` event, a listed order its maker could not settle: backing short of the fill, a missing or
 * deauthorized trustline for the taker's asset, or the maker's asset could not be collected. The order is left
 * unchanged. For `crossfill` it also flags a taker order its owner cannot back or be paid for
 */
export interface OrderSkippedContractEvent {
    /** Order id */
    order: bigint;
}

/** Orderbook `refresh` event, a market checked against the oracle (topics: `refresh`, `base`, `quote`, no data) */
export interface MarketRefreshContractEvent {
    /** Base market asset (canonical order, topic) */
    base: string;
    /** Quote market asset (canonical order, topic) */
    quote: string;
}

/** `freeze` event */
export interface FreezeContractEvent {
    /** Whether trading is blocked after the call */
    frozen: boolean;
}

/**
 * `config` update notification event (constructor, `delegate`, `set_oracle`, `set_floor`, `set_listing_min_days`,
 * `set_ledger_time`)
 */
export interface ConfigChangedContractEvent {
    /** Contract configuration after the call */
    config: Config;
}

/** A trade step in a multi-market swap path */
export interface TradeStep {
    /** Asset to buy at this step */
    asset: string;
    /** Maker order IDs to match */
    orders: Array<bigint>;
}

/** Standard contract errors */
export declare const ContractErrors: {
    701: {message: "NotAuthorized"};
    702: {message: "InsufficientBalance"};
    703: {message: "InsufficientAllowance"};
    704: {message: "InvalidMatch"};
    705: {message: "InvalidPrice"};
    706: {message: "InvalidAmount"};
    707: {message: "InvalidExpiration"};
    708: {message: "CannotReceive"};
    709: {message: "NotFilled"};
    710: {message: "OrderNotFound"};
    711: {message: "OrderExists"};
    712: {message: "IntermediaryCannotReceive"};
    720: {message: "OrderSizeTooSmall"};
    721: {message: "AssetsNotVerifiedByOracle"};
    722: {message: "AssetPriceOracleFetchFailed"};
    723: {message: "InvalidOracleConfig"};
    730: {message: "Frozen"};
    740: {message: "Overflow"};
}

/** Errors of the Stellar Asset Contract, raised by the token transfers a trading call settles with */
export declare const TokenErrors: {
    1: {message: "InternalError"};
    2: {message: "OperationNotSupportedError"};
    3: {message: "AlreadyInitializedError"};
    4: {message: "UnauthorizedError"};
    5: {message: "AuthenticationError"};
    6: {message: "AccountMissingError"};
    7: {message: "AccountIsNotClassic"};
    8: {message: "NegativeAmountError"};
    9: {message: "AllowanceError"};
    10: {message: "BalanceError"};
    11: {message: "BalanceDeauthorizedError"};
    12: {message: "OverflowError"};
    13: {message: "TrustlineMissingError"};
}

/**
 * Compute the id of the order `owner` creates with `nonce`.
 * Mirrors the contract: the first 16 bytes of `sha256(xdr(ScVec[owner: Address, nonce: u64]))`
 * interpreted as a big-endian `u128` (the full 128 bits, no mask).
 * @param owner - Order owner address (account or contract)
 * @param nonce - Client-chosen u64 nonce
 * @returns u128 order id
 */
export declare function orderId(owner: string, nonce: bigint | number | string): bigint;

export interface ClientInitializationParams {
    /** Public key of the account that will interact with the contract */
    publicKey: string;
    /** Callback for signing transactions generated by the client */
    signTransaction: SignTransactionCallback;
    /** URL of the RPC server */
    rpcUrl: string;
    /** DEX contract ID */
    contractId: string;
    /** Network passphrase (Pubnet passphrase by default) */
    networkPassphrase?: string;
    /** Inclusion fee bid in stroops (100,000 = 0.01 XLM by default), the simulated resource fee is added on top */
    fee?: string;
    /** Declare every supplied order id, and the balances and allowances of the makers behind them, in the read-write footprint of trading transactions (enabled by default) */
    autoFootprint?: boolean;
}

/**
 * Callback for signing transactions generated by the client (`@stellar/stellar-sdk` 17 contract client shape)
 * @param xdr - Transaction XDR to sign
 * @param opts - Signing options passed by the SDK
 * @returns Signed transaction response
 */
export type SignTransactionCallback = (
    xdr: string,
    opts?: {networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string}
) => Promise<{signedTxXdr: string; signerAddress?: string; error?: unknown}>;

export interface TradeArguments {
    /** Trading order behavior */
    kind: OrderKind,
    /** Trader address */
    trader: string;
    /** Tokens amount */
    amount: bigint;
    /** Selling token address */
    selling: string;
    /** Buying token address */
    buying: string;
    /** Price a trader willing to accept */
    price: bigint;
    /** List of order IDs to match before creating the order on-chain */
    orders?: Array<bigint>;
    /** Expiration UNIX timestamp (in seconds) of the order created for a `Limit` remainder, 0 or omitted = no expiration */
    expires?: bigint | number;
    /** Optional allowance granted to the contract before trading (on `selling` unless `asset` is set) */
    approve?: Approval;
}

export interface SellTradeArguments extends TradeArguments {
    /** Amount of `selling` tokens to sell */
    amount: bigint;
    /** Price a trader willing to accept, minimum `buying` tokens per 1 `selling` */
    price: bigint;
}

export interface BuyTradeArguments extends TradeArguments {
    /** Amount of `buying` tokens to acquire */
    amount: bigint;
    /** Price a trader willing to accept, maximum `selling` tokens per 1 `buying` */
    price: bigint;
}

/** Simulated trade, nothing signed or submitted */
export interface TradeEstimate {
    /** Maximum total network fee of the transaction, in stroops (inclusion fee bid plus resource fee) */
    fee: bigint;
    /** Inclusion fee bid, in stroops (the network charges the market rate up to it) */
    inclusionFee: bigint;
    /** Resource fee, in stroops, including the rent of an order created for the remainder */
    resourceFee: bigint;
    /** Expected amount of sold tokens */
    sold: bigint;
    /** Expected amount of bought tokens */
    bought: bigint;
    /** ID of the order the remainder would create */
    orderId?: bigint;
}

/** Swap path and settings */
export interface SwapArguments {
    /** Trade direction: `Sell` or `Buy` */
    direction: TradeDirection,
    /** Trader address */
    trader: string,
    /** Token address sent by the trader */
    selling: string,
    /** Amount of selling tokens to send (`Sell`) or the maximum to spend (`Buy`) */
    sellingAmount: bigint,
    /** Minimum amount of buying tokens to receive (`Sell`) or the exact amount (`Buy`) */
    buyingAmount: bigint,
    /** Ordered list of the trade route steps */
    path: Array<TradeStep>,
    /** Optional allowance granted to the contract before trading (on `selling` unless `asset` is set) */
    approve?: Approval
}

export interface UpdateArguments {
    /** Orders owner */
    trader: string;
    /** New amount, price and expiration per order */
    updates: Array<OrderUpdate>;
    /** Allowances granted before the backing check, each naming its `asset`; an asset without an approval keeps its current allowance */
    approvals?: Array<Approval & {asset: string}>;
}

export interface SubsidizeArguments {
    /** Address paying for the oracle feeds (and the listing fee of a new market) */
    sponsor: string;
    /** First market asset */
    selling: string;
    /** Second market asset (either order opens the same market) */
    buying: string;
    /** Amount of XRF fee tokens to burn, at least `Config.market_listing_fee` to open a market */
    amount: bigint;
}

/** Smart contract client for trading with AXIS DEX */
export declare class AxisContractClient {
    constructor(params: ClientInitializationParams);

    /** Account that signs and pays for the transactions */
    readonly publicKey: string;

    /**
     * Fetch existing order.
     * @param id - ID of the order to fetch
     * @returns Order fetched from the storage, undefined if not found or expired
     */
    order(id: bigint): Promise<Order | undefined>;

    /** Fetch contract configuration. */
    loadConfig(): Promise<Config>;

    /**
     * Check whether the contract is frozen.
     * @returns `true` if contract is frozen (trading and order management operations blocked)
     */
    isFrozen(): Promise<boolean>;

    /**
     * Fetch market for the given asset pair.
     * @param selling - First market asset
     * @param buying - Second market asset
     * @returns Market record if the market exists
     */
    getMarket(selling: string, buying: string): Promise<Market | undefined>;

    /**
     * Cancel existing orders, expired ones included. A transaction can process up to 90 orders in one batch.
     * @param trader - Trader address
     * @param ids - IDs of the orders to cancel (non-existent orders are ignored)
     * @throws If trader is not the owner of any existing order in `ids` (works while the contract is frozen)
     */
    cancel(trader: string, ids: Array<bigint>): Promise<void>;

    /**
     * Update the amount, price, or expiration of several orders in place, or remove them.
     * Orders that no longer exist are skipped; expired orders revived with the new expiration.
     * A zero amount removes the order, expired ones included. An updated order's entry lifetime is extended to cover its expiration +1 day.
     * Approvals and removals work in a frozen contract and on a market without quoted assets.
     * A transaction can process up to 90 orders in one batch.
     * @returns IDs of the orders to update
     * @throws If the trader does not own an updated order, if order parameters are invalid, if an order is below the minimum value,
     * if the new amounts are not backed by the trader's balance and allowance, an update changes an order on the frozen or not-quoted market
     */
    update(params: UpdateArguments): Promise<Array<bigint>>;

    /**
     * Fill an existing order against matching orders from the orderbook. Profits from inefficiencies go to the trader.
     * @param trader - Trader address
     * @param takerOrderId - ID of the order that serves as a taker
     * @param orders - List of order IDs to match against
     * @returns Amount the taker order sold, amount the makers delivered, surplus paid to the trader.
     * @throws If the taker order does not exist or has expired, if the trader cannot receive the bought asset, if the
     * contract cannot hold the bought asset, if the contract is frozen.
     */
    crossfill(trader: string, takerOrderId: bigint, orders: Array<bigint>): Promise<[bigint, bigint, bigint]>;

    /**
     * Trade with DEX and create a buy limit order if the quote not executed in full.
     * @returns Amount of sold and bought tokens, ID of the newly created order if any
     * @throws If the trader has insufficient balance or allowance, invalid `expires` field specified, a `Limit` trade targets a pair without a market,
     * no reference price is available, a live order with the same id exists, the trader cannot receive `buying` (`CannotReceive`), or the contract
     * cannot hold `buying` until its issuer authorizes it (`IntermediaryCannotReceive`).
     */
    buy(params: BuyTradeArguments): Promise<[bigint, bigint, bigint | undefined]>;

    /**
     * Trade with DEX and create a sell limit order if the quote not executed in full.
     * @returns Amount of sold and bought tokens, ID of the newly created order if any
     * @throws If the trader has insufficient balance or allowance, invalid `expires` field specified, a `Limit` trade targets a pair without a market,
     * no reference price is available, a live order with the same id exists, the trader cannot receive `buying` (`CannotReceive`), or the contract
     * cannot hold `buying` until its issuer authorizes it (`IntermediaryCannotReceive`).
     */
    sell(params: SellTradeArguments): Promise<[bigint, bigint, bigint | undefined]>;

    /**
     * Simulate a buy trade without signing or submitting it, to show the network fee before the trade.
     * @throws If the simulation fails, for the same reasons as `buy`
     */
    estimateBuy(params: BuyTradeArguments): Promise<TradeEstimate>;

    /**
     * Simulate a sell trade without signing or submitting it, to show the network fee before the trade.
     * @throws If the simulation fails, for the same reasons as `sell`
     */
    estimateSell(params: SellTradeArguments): Promise<TradeEstimate>;

    /**
     * Swap tokens across several markets. The contract holds the intermediate hop proceeds only within the call.
     * @returns Amount of sold and bought tokens
     * @throws If the route cannot satisfy the selling/buying amount, if `path` is empty or an amount is invalid,
     * if the contract cannot hold an asset of the path, if the contract is frozen.
     */
    swap(params: SwapArguments): Promise<[bigint, bigint]>;

    /**
     * Extend the contract instance and code lifetime with an `ExtendFootprintTTL` operation, restoring the archived
     * ones first with a `RestoreFootprint` transaction.
     * @param days - Lifetime in days, 30 by default, at most the network maximum (180 days on mainnet)
     * @returns Ledger sequence both entries live at least until
     * @throws If `days` is invalid, if the instance is not found, if a simulation or a transaction fails
     */
    keepalive(days?: number): Promise<number>;

    /**
     * Re-check both market assets against the price oracle and cache oracle prices.
     * A cached price is valid for up to 72 hours. A market without quoted assets stops accepting
     * new limit orders; its outstanding orders stay cancellable and fillable. The record and the
     * cached prices are rewritten only when they change. When the simulation writes nothing (the market and the
     * cached prices are current, or the oracle has no newer price), the simulated result is
     * returned and no transaction is submitted.
     * @param selling - First market asset
     * @param buying - Second market asset
     * @returns Updated market record, undefined if the market does not exist
     * @throws If the contract is frozen
     */
    requote(selling: string, buying: string): Promise<Market | undefined>;

    /**
     * Extend oracle price feeds access for a market, creating the market if it does not exist yet.
     * @returns New access expiration UNIX timestamps (in seconds) per oracle-listed asset
     * @throws If `amount` is invalid, if `selling` equals `buying`, if the market does not exist and the amount is below
     * the market listing fee, if neither market asset is quoted by the oracle, if the contract is frozen
     */
    subsidize(params: SubsidizeArguments): Promise<Array<bigint>>;
}

/** Error thrown when the AXIS API responds with a non-success HTTP status */
export declare class AxisApiError extends Error {
    /**
     * @param message - Error message returned by the API
     * @param status - HTTP status code
     */
    constructor(message: string, status: number);

    /** HTTP status code associated with the error */
    readonly status: number;
}

export interface QuoteParams {
    /** Asset to sell (`XLM` | `CODE:Issuer` | `CODE-Issuer` | contractId) */
    sellingAsset: string;
    /** Asset to buy (same format as `sellingAsset`) */
    buyingAsset: string;
    /** Trade amount in stroops (1 unit = 10,000,000 stroops) */
    amount: string | number;
    /** Restrict to the direct market only (no intermediate-asset routes) */
    direct?: boolean;
    /**
     * Highest maker price to cross (requires `direct`), in the units of a hop `worstPrice`: `sellingAsset` per unit of
     * `buyingAsset`, scaled by 10^18. Quotes the crossing of a limit order: orders priced above it are left out and the
     * route may trade less than `amount`
     */
    maxPrice?: bigint | string;
}

export interface QuotePathStep {
    /** Selling asset contract id at this hop */
    selling: string;
    /** Buying asset contract id at this hop */
    buying: string;
    /** Maker order IDs matched at this hop */
    orders: string[];
    /** Highest price among the matched orders (maker `buying` per `selling`, 18 decimals): a trade limit at this price crosses every listed order */
    worstPrice?: string;
}

export interface QuotePath {
    /** Amount sold, in stroops */
    sold: string;
    /** Amount bought, in stroops */
    bought: string;
    /** Ordered list of hops in the route */
    path: QuotePathStep[];
}

export interface QuoteResult {
    /** Base58-encoded quote id */
    id: string;
    /** Quote status */
    status: 'success' | 'unfeasible' | 'rejected';
    /** Trade direction */
    direction: 'strict_send' | 'strict_receive';
    /** Selling asset contract id */
    sellingAsset: string;
    /** Buying asset contract id */
    buyingAsset: string;
    /** Ledger sequence the quote was computed for */
    ledger: number;
    /** Candidate routes ranked by profitability (up to 10) */
    paths: QuotePath[];
    /** Error message (present only if status is not `success`) */
    error?: string;
}

export interface DepthParams {
    /** Market identifier `BASE/QUOTE` */
    market: string;
    /** Percentage band (±) around the center price (0 < depth ≤ 100, default 20) */
    depth?: number;
    /** Price step of the levels, a decimal such as `"0.0005"` (5 significant digits of the mid price by default) */
    step?: string;
    /** Price levels per side (default 100, max 500) */
    limit?: number;
}

export interface OrderbookDepth {
    /** Ledger sequence */
    ledger: number;
    /** UNIX timestamp (seconds) */
    timestamp: number;
    /** Price step of the levels (null for an empty book) */
    step: string | null;
    /** Exact best bid price, before the rounding to levels */
    bestBid: string | null;
    /** Exact best ask price, before the rounding to levels */
    bestAsk: string | null;
    /** `[price, quantity]` pairs sorted descending by price */
    bids: Array<[string, string]>;
    /** `[price, quantity]` pairs sorted ascending by price */
    asks: Array<[string, string]>;
}

export interface CandlesParams {
    /** Market identifier `BASE/QUOTE` */
    market: string;
    /** Lower boundary (UNIX seconds, default 0) */
    from?: number;
    /** Upper boundary (UNIX seconds, defaults to `from + resolution * 200`) */
    to?: number;
    /** Resolution in seconds or alias (`5m`,`15m`,`30m`,`1h`,`2h`,`4h`,`12h`,`1d`,`3d`,`1w`,`2w`, default `auto`) */
    resolution?: number | string;
    /** Sort order (default `desc`) */
    order?: 'asc' | 'desc';
}

/** OHLCVT candle row: `[timestamp, open, high, low, close, baseVolume, quoteVolume, tradeCount]` */
export type Candle = [number, string, string, string, string, string, string, number];

export interface TickerEntry {
    /** Market symbol `BASE/QUOTE` */
    symbol: string;
    /** Opening price 24h ago */
    openPrice: string;
    /** Highest price in the 24h window */
    highPrice: string;
    /** Lowest price in the 24h window */
    lowPrice: string;
    /** Most recent trade price */
    lastPrice: string;
    /** 24h base asset volume */
    volume: string;
    /** 24h quote asset volume */
    quoteVolume: string;
    /** 24h price change (percent) */
    change: number;
    /** Volume-weighted average price */
    avgPrice: string;
    /** 24h trade count */
    trades: number;
}

export interface Ticker24hResult {
    /** Ledger sequence */
    ledger: number;
    /** UNIX timestamp (seconds) */
    timestamp: number;
    /** Per-market 24h stats, sorted by trade count descending */
    ticker: TickerEntry[];
}

export interface MarketsParams {
    /** Pagination cursor (`baseAsset-quoteAsset`) */
    cursor?: string;
    /** Max markets to return */
    limit?: number | string;
}

export interface MarketInfo {
    /** Base asset contract id */
    baseAsset: string;
    /** Quote asset contract id */
    quoteAsset: string;
    /** Pagination cursor for this market */
    cursor: string;
    /** Supported order types */
    orderTypes: string[];
}

export interface ContractInfoConfig {
    /** Safety admin address */
    safetyAdmin: string;
    /** Price oracle contract address */
    oracle: string;
    /** Days of price feeds a new market must buy (0 opens markets without a fee) */
    listingMinDays?: number;
    /** Oracle fee tokens a market creator pays to provision the price feeds */
    marketListingFee: string;
    /** Minimum trade value in USD with 7 decimals (0 = disabled) */
    minTradeSize: string;
    /** Expected ledger close time in seconds */
    ledgerTime?: number;
}

export interface ContractInfoMarket {
    /** Base market asset, the first of the pair in canonical order */
    base: string;
    /** Quote market asset, the second of the pair in canonical order */
    quote: string;
    /** Creation timestamp (UTC) */
    created: string;
    /** Last oracle check timestamp (UTC) */
    refreshed: string;
}

/** Contract state tracked by the indexer */
export interface ContractInfo {
    /** Whether trading is blocked by the safety admin */
    frozen: boolean;
    /** Contract configuration */
    config?: ContractInfoConfig;
    /** Markets opened by `subsidize` */
    markets: ContractInfoMarket[];
}

export interface OrdersParams {
    /** Filter by order owner address */
    owner?: string;
    /** Filter by asset(s) - every listed asset must be one of the order assets (two assets select a pair) */
    asset?: string | string[];
    /** `cursor` of the last order received (its creation position, not the order id) */
    cursor?: string | bigint;
    /** Max orders to return */
    limit?: number | string;
}

export interface OrderHistoryParams {
    /** Filter by order owner address */
    owner?: string;
    /** Asset pair `[base, quote]` (contract ids) */
    pair?: string[];
    /** `cursor` of the last order received (its creation position, not the order id) */
    cursor?: string | bigint;
    /** Max orders to return */
    limit?: number | string;
}

export interface TradesParams {
    /** Filter by trader address */
    trader?: string;
    /** Asset pair `[base, quote]` (contract ids) */
    pair?: string[];
    /** `cursor` of the last record received (the trade or swap id) */
    cursor?: string | bigint;
    /** Max trades to return */
    limit?: number | string;
}

/** Maker backing in the order's selling asset */
export interface ApiOrderBacking {
    /** Token balance */
    balance: string;
    /** Allowance granted to the AXIS contract */
    allowance: string;
    /** Ledger sequence the allowance lives until */
    liveUntil: number;
    /** Whether the maker can send and receive the token */
    authorized: boolean;
    /** Last load timestamp (UTC) */
    updated?: string;
    /** A reload confirming the latest event is still due: the values may predate it */
    pending?: boolean;
}

/** Tracked backing of an account in a token */
export interface ApiBacking {
    /** Account address */
    owner: string;
    /** Token contract id */
    asset: string;
    /** Token balance */
    balance: string;
    /** Allowance granted to the AXIS contract */
    allowance: string;
    /** Ledger sequence the allowance lives until */
    liveUntil: number;
    /** Whether the account can send and receive the token */
    authorized: boolean;
    /** Effective budget, min(balance, allowance), 0 when unauthorized or expired */
    budget: string;
    /**
     * Amount the account can still receive (trustline limit minus balance and buying
     * liabilities), omitted when unlimited or unknown
     */
    headroom?: string;
    /** Last load timestamp (UTC) */
    updated?: string;
    /** Last `skip` event of an order selling the token (UTC) */
    skipped?: string;
    /** A reload confirming the latest event is still due */
    pending?: boolean;
}

/** Account state: every live order and the backing per traded asset */
export interface ApiAccount {
    /** Trader address */
    address: string;
    /** Last processed ledger */
    ledger: number;
    /** Live orders, oldest first */
    orders: ApiOrder[];
    /** Backing by token contract id */
    backing: Record<string, ApiBacking>;
}

/** Serialized order returned by the API */
export interface ApiOrder {
    /** Order ID (decimal u128) */
    id: string;
    /** Order status: `ACTIVE`, `FILLED`, `CANCELED` (removed by the owner) or `EXPIRED` (archived once past `expires`) */
    status: 'ACTIVE' | 'FILLED' | 'CANCELED' | 'EXPIRED';
    /** Buying asset contract id */
    buying: string;
    /** Selling asset contract id */
    selling: string;
    /** Order price */
    price: string;
    /** Rational price representation */
    rprice: string;
    /** Selling amount at creation */
    quote: string;
    /** Amount left to sell */
    amount: string;
    /** Amount the maker can actually deliver, when the indexer tracks backing */
    backed?: string;
    /** Maker backing details, when the indexer tracks backing */
    backing?: ApiOrderBacking;
    /** Maker address */
    owner: string;
    /** Expiration timestamp (UTC) */
    expires?: string;
    /** Creation timestamp (UTC) */
    created?: string;
    /** Last update timestamp (UTC) */
    updated?: string;
    /** Pagination cursor */
    cursor?: string;
}

/** Serialized swap returned by the API, one per `swap` call */
export interface ApiSwap {
    /** Record type */
    type: 'swap';
    /** Swap ID */
    id: string;
    /** Trader address */
    trader: string;
    /** Sold asset contract id */
    soldAsset: string;
    /** Bought asset contract id */
    boughtAsset: string;
    /** Sold tokens amount */
    sold: string;
    /** Bought tokens amount */
    bought: string;
    /** Approximate swap price */
    price: string;
    /** Pagination cursor */
    cursor: string;
    /** Swap timestamp (UTC) */
    timestamp: string;
}

/** Serialized trade returned by the API */
export interface ApiTrade {
    /** Record type */
    type: 'trade';
    /** Trade ID */
    id: string;
    /** Matched order ID */
    order: string;
    /** Taker account address */
    taker: string;
    /** Maker account address */
    maker: string;
    /** Sold asset contract id */
    soldAsset: string;
    /** Bought asset contract id */
    boughtAsset: string;
    /** Sold tokens amount */
    sold: string;
    /** Bought tokens amount */
    bought: string;
    /** Order amount left after the fill */
    left?: string;
    /**
     * The fill of a `crossfill` taker order: `taker` is the caller, paid the surplus, and the amounts mirror the makers'
     * fills of the same call (left out of candles and volume)
     */
    crossfill?: boolean;
    /** Approximate trade price */
    price: string;
    /** Pagination cursor */
    cursor?: string;
    /** Trade timestamp (UTC) */
    timestamp: string;
}

export interface FailuresParams {
    /** Caller of the failed transaction, or a party of the failed transfer */
    account?: string;
    /** Contract function (`trade`, `swap`, `crossfill`, `update`, ...) */
    fn?: string;
    /** `cursor` of the last record received */
    cursor?: string | bigint;
    /** Max records to return (20 by default, at most 500) */
    limit?: number | string;
}

/**
 * Failed AXIS call (made by the transaction or through another contract, the transaction failed
 * or a calling contract caught the failure). It changes no state and blames no party:
 * a token error on a settlement transfer does not tell the payer who could not pay from the recipient who could not be
 * credited (e.g. a full trustline), and in a `crossfill` the makers are paid by the taker order owner, not the caller
 */
export interface ApiFailure {
    /** Record type */
    type: 'failure';
    /** Record id (position of the transaction plus the index of the failed call) */
    id: string;
    /** Transaction hash */
    txHash: string;
    /** Ledger sequence */
    ledger: number;
    /** Ledger close time (UTC) */
    timestamp: string;
    /** Contract function called */
    fn: string;
    /** The `trader` or `sponsor` argument, the transaction source for other functions */
    caller: string;
    /** Maker order ids listed by the call */
    orders: string[];
    /** Taker order id of a `crossfill` */
    takerOrder?: string;
    /** Operation result code */
    result: string;
    /** The transaction succeeded: a calling contract caught the failed AXIS call */
    caught?: boolean;
    /**
     * `contract`: a contract error (`error`), `transfer`: a token transfer failed (`transfer`, either side may be at
     * fault), `resources`: a resource limit, the refundable fee or an archived entry, `auth`: an authorization failure,
     * `unknown`: no diagnostic events
     */
    reason: 'contract' | 'transfer' | 'resources' | 'auth' | 'unknown';
    /** Contract error that failed the call */
    error?: {contract: string | null, code: number, name?: string};
    /** Token transfer that failed */
    transfer?: {token: string, fn: string, from: string, to: string, amount: string};
    /** Pagination cursor */
    cursor: string;
}

/** HTTP client for the AXIS REST API */
export declare class AxisApiClient {
    /** @param serverUrl - Base URL of the AXIS API server */
    constructor(serverUrl: string);

    /** Base URL of the AXIS API server */
    readonly serverUrl: string;

    /**
     * Price quote and candidate trade routes for selling a fixed amount of the source asset
     * @param params - Quote request parameters
     * @returns Best routes ranked by profitability
     * @throws {AxisApiError} 409 if the server is not ready or routing fails, 400 on invalid parameters. Not enough
     * liquidity resolves with `status: 'unfeasible'`, a frozen contract with `status: 'rejected'`
     */
    quoteSell(params: QuoteParams): Promise<QuoteResult>;

    /**
     * Price quote and candidate trade routes for buying a fixed amount of the destination asset
     * @param params - Quote request parameters
     * @returns Best routes ranked by profitability
     * @throws {AxisApiError} 409 if the server is not ready or routing fails, 400 on invalid parameters. Not enough
     * liquidity resolves with `status: 'unfeasible'`, a frozen contract with `status: 'rejected'`
     */
    quoteBuy(params: QuoteParams): Promise<QuoteResult>;

    /**
     * Order book depth around the mid price, aggregated into price levels on multiples of `step` (bids rounded down,
     * asks up, so a level price crosses every order in it)
     * @param params - Depth request parameters
     * @returns Aggregated bids and asks
     */
    getDepth(params: DepthParams): Promise<OrderbookDepth>;

    /**
     * OHLCVT candlestick data (open, high, low, close, base volume, quote volume, trade count)
     * @param params - Candles request parameters
     * @returns Time-bucketed candles, max 200 per response
     */
    getCandles(params: CandlesParams): Promise<Candle[]>;

    /**
     * 24-hour ticker statistics for every available market
     * @returns Aggregated 24h stats per market
     */
    getTicker24h(): Promise<Ticker24hResult>;

    /**
     * List all active markets with pagination
     * @param params - Pagination parameters
     * @returns Active markets
     */
    getMarkets(params?: MarketsParams): Promise<MarketInfo[]>;

    /**
     * Contract state tracked by the indexer: frozen switch, configuration and active markets
     * @returns Contract state
     */
    getContract(): Promise<ContractInfo>;

    /**
     * Retrieve active orders, filterable by owner or asset
     * @param params - Filter parameters
     * @returns Active orders matching the filter
     */
    getOrders(params?: OrdersParams): Promise<ApiOrder[]>;

    /**
     * Account state tracked by the indexer: every live order of the trader (not paginated) and their backing in each
     * asset they trade
     * @param address - Trader address
     */
    getAccount(address: string): Promise<ApiAccount>;

    /**
     * Retrieve a single order by ID
     * @param id - Order ID
     * @returns Order (throws AxisApiError with status 404 if not found)
     */
    getOrder(id: bigint | string | number): Promise<ApiOrder>;

    /**
     * Retrieve archived/historical orders
     * @param params - Filter parameters
     * @returns Archived orders matching the filter
     */
    getOrderHistory(params?: OrderHistoryParams): Promise<ApiOrder[]>;

    /**
     * Retrieve recent trades and swaps, newest first
     * @param params - Filter parameters
     * @returns Recent trades and swaps matching the filter (told apart by `type`)
     */
    getTrades(params?: TradesParams): Promise<Array<ApiTrade | ApiSwap>>;

    /**
     * Failed AXIS calls, newest first (diagnostics: a failure changes no state, and a record never blames a party, see
     * {@link ApiFailure})
     * @param params - Filter parameters
     */
    getFailures(params?: FailuresParams): Promise<ApiFailure[]>;
}

/** Price scale of the contract (18 decimals) */
export declare const PRICE_SCALE: bigint;

/**
 * Compare two assets in the contract canonical order
 * @param a - Token contract address
 * @param b - Token contract address
 * @returns Negative if `a` first, positive if `b` first, 0 if equal
 */
export declare function compareAssets(a: string, b: string): number;

/**
 * Reorder an asset pair the way the contract stores markets
 * @param x - Token contract address
 * @param y - Token contract address
 * @returns `[a, b]`: `a` is the base, `b` the quote of the canonical market symbol
 */
export declare function canonicalPair(x: string, y: string): [string, string];

/**
 * Canonical market key `a/b`
 * @param a - Token contract address
 * @param b - Token contract address
 */
export declare function pairKey(a: string, b: string): string;

/**
 * Calculate inverted price, rounded down: `floor(10^36 / price)`
 * @param price - Price in the contract scale
 */
export declare function invertPrice(price: bigint): bigint;

/**
 * 24h ticker entry of the market seen in the inverted orientation (`b/a`)
 * @param entry - Standard ticker entry
 */
export declare function invertTicker(entry: TickerEntry): TickerEntry;

/**
 * Parse an AXIS API timestamp (`YYYY-MM-DD HH:mm:ss` UTC)
 * @returns UNIX milliseconds, 0 when missing or invalid
 */
export declare function parseApiDate(value: string | number | undefined): number;

/** Allowance lifetime granted with a trade, in ledgers: ~30 days at 5s per ledger (the maximum entry TTL ~180 days) */
export declare const APPROVAL_TTL_LEDGERS: number;
/** An allowance expiring within this number of ledgers is renewed with the next trade (~1 day) */
export declare const APPROVAL_RENEW_LEDGERS: number;

export interface ApprovalPlanParams {
    /** Max amount of the selling asset the call may spend */
    required: bigint;
    /** Remaining amount of orders in the book selling the asset */
    committed: bigint;
    /** Current allowance (0 once expired) */
    allowance: bigint;
    /** Current ledger sequence */
    ledger: number;
    /** Ledger the current allowance lives until (0 or omitted when unknown) */
    liveUntil?: number;
}

/**
 * Decide whether a call needs an in-call approval and adjust it. The approval amount is absolute and one allowance
 * backs every order selling the token across all markets, so it has to cover this call plus every order selling the
 * same asset
 * @returns Approval to pass with the call, undefined when the current allowance already covers it
 */
export declare function planApproval(params: ApprovalPlanParams): {amount: bigint, liveUntil: number} | undefined;

/**
 * Max amount of `selling` tokens a buy trade may cost: `ceil(amount × price / 10^18)`
 * @param amount - Amount of `buying` tokens to acquire
 * @param price - Limit price (`selling` per 1 `buying`, with AXIS standard price decimals)
 */
export declare function maxQuoteSpend(amount: bigint, price: bigint): bigint;

/** Minimal event emitter that works in browsers and Node */
export declare class Emitter {
    /**
     * Subscribe to an event
     * @returns Unsubscribe function
     */
    on(event: string, listener: (...args: any[]) => void): () => void;
    /**
     * Subscribe to the next occurrence of an event
     * @returns Unsubscribe function
     */
    once(event: string, listener: (...args: any[]) => void): () => void;
    /** Unsubscribe from an event */
    off(event: string, listener: (...args: any[]) => void): void;
}

/** Server message; `type` names the payload, `topic` the subscription it belongs to */
export interface StreamMessage {
    type: string;
    topic?: string;
    id?: number;
    [key: string]: any;
}

export interface StreamClientOptions {
    /** WebSocket implementation (the global one by default) */
    WebSocket?: typeof WebSocket;
    /** Application-level ping period, in milliseconds (20 s by default) */
    pingInterval?: number;
    /** First reconnect delay, doubled after each failure (1 s by default) */
    minReconnectDelay?: number;
    /** Reconnect delay cap (30 s by default) */
    maxReconnectDelay?: number;
}

/**
 * WebSocket client of the AXIS API push channel
 *
 * Emits `open`, `close` and `error` (server errors not tied to a subscription).
 */
export declare class AxisStreamClient extends Emitter {
    /** @param url - WebSocket endpoint, e.g. `wss://demo-api.axis.markets/ws` (testnet) */
    constructor(url: string, options?: StreamClientOptions);

    /** WebSocket endpoint */
    readonly url: string;
    /** Whether the connection is open */
    readonly connected: boolean;

    /**
     * Subscribe to a channel; connects on the first subscription
     * @param params -
     *   Channel parameters
     * @param handler - Receives the snapshot (again after every reconnect), the
     *   changes, and `{type: 'error'}` if the server rejects the subscription
     * @returns Unsubscribe function
     */
    subscribe(channel: 'contract' | 'ticker' | 'account' | 'trades' | 'depth' | 'candles', params: {address?: string, market?: string, depth?: number, step?: string, resolution?: number | string, limit?: number}, handler: (message: StreamMessage) => void): () => void;

    /** Close the connection and drop every subscription */
    close(): void;
}

/** Token state for allowance calculation, token balances, and current ledger */
export declare class TokenBalance {
    /** @param options - `spender` is the AXIS contract */
    constructor(options: {rpcUrl: string, networkPassphrase: string, spender: string, server?: rpc.Server});

    /**
     * Allowance `owner` granted to the AXIS contract on a token, 0 when expired
     * @param token - Token contract address
     * @param owner - Token holder address
     * @throws If the simulation fails
     */
    getAllowance(token: string, owner: string): Promise<bigint>;
    /**
     * Token balance of an account
     * @param token - Token contract address
     * @param owner - Token holder address
     * @returns 0 if the account holds no balance entry
     */
    getBalance(token: string, owner: string): Promise<bigint>;
    /** Latest closed ledger sequence */
    getLatestLedger(): Promise<number>;
}

/** Account signing contract calls */
export interface Signer {
    /** Transaction source account */
    publicKey: string;
    signTransaction: SignTransactionCallback;
}

export interface AxisOptions {
    /** AXIS REST API URL */
    apiUrl: string;
    /** AXIS contract address */
    contractId: string;
    /** AXIS API push channel URL (`<apiUrl>/ws` with the `ws(s)` scheme by default) */
    wsUrl?: string;
    /** Stellar RPC URL */
    rpcUrl?: string;
    /** Network passphrase (Pubnet by default) */
    networkPassphrase?: string;
    /** Transaction fee */
    fee?: string;
    /** Default signer settings for contract operations */
    signer?: Signer;
    /** REST polling period while the push connection is down, in milliseconds */
    fallbackPollInterval?: number;
    /** WebSocket implementation */
    WebSocket?: typeof WebSocket;
}

/**
 * High-level AXIS DEX state
 *
 * Emits:
 * - `change` - anything in the contract state changed
 * - `frozen` `boolean` - the frozen state toggled
 * - `config` {ContractInfoConfig} - contract configuration changed
 * - `market` `{market: AxisMarket, created: boolean}` - a market was opened or updated
 * - `connection` `boolean` - WebSocket push connection opened or dropped
 * - `ledger` `number` - new ledger processed by the indexer
 */
export declare class Axis extends Emitter {
    constructor(options: AxisOptions);

    /** AXIS REST API client */
    readonly api: AxisApiClient;
    /** AXIS API WebSocket client */
    readonly stream: AxisStreamClient;
    /** Token balance wrappers */
    readonly tokenBalances: TokenBalance | undefined;
    /** Contract address of the native XLM token */
    readonly nativeAsset: string;
    /** Last known ledger */
    readonly ledger: number;
    /** Last updated UNIX milliseconds */
    readonly ledgerTime: number;
    /** Whether trading is suspended */
    readonly frozen: boolean;
    /** Contract configuration */
    readonly config: ContractInfoConfig | undefined;
    /** Available AXIS markets */
    readonly markets: Map<string, AxisMarket>;
    /** 24h ticker entries */
    readonly tickers: Map<string, TickerEntry>;
    /** Whether the contract state loaded */
    readonly loaded: boolean;

    /** Load the contract state and track its changes */
    connect(): Promise<Axis>;
    /** Current ledger sequence */
    getLedger(): Promise<number>;
    /**
     * Get market of the asset pair
     * @param asset1 - Token contract address
     * @param asset2 - Token contract address
     */
    getMarket(asset1: string, asset2: string): AxisMarket | undefined;
    /**
     * Get live order by id
     * @param id - Order id
     * @returns Undefined if not found (filled, removed, expired)
     */
    getOrder(id: bigint | string): Promise<AccountOrder | undefined>;
    /**
     * Trader wrapper tracking the orders and allowances for an account (one instance per account address)
     * @param address - Trader address
     * @param options - Transaction signing callback
     */
    account(address: string, options?: {signTransaction?: SignTransactionCallback}): AxisAccount;
    /**
     * Stream the 24h ticker of every market
     * Sends a full snapshot, then updates caused by trades
     * @returns Unsubscribe function
     */
    subscribeTicker(callback?: (ticker: Ticker24hResult) => void): () => void;
    /**
     * Extend the contract instance and code lifetime with an `ExtendFootprintTTL` operation, restoring them first if archived
     * @param params - Lifetime in days (30 by default) and the transaction source (the default signer by default)
     * @returns Ledger sequence both entries live until, at least
     */
    keepalive(params?: {days?: number; signer?: Signer}): Promise<number>;
    /** Stop following the contract state and tracked accounts */
    close(): void;
}

/** Derive the push API endpoint from the REST API URL */
export declare function toWsUrl(apiUrl: string): string;

/** DEX Market */
export declare class AxisMarket {
    /** Base asset, the first of the pair in the contract canonical order */
    readonly base: string;
    /** Quote asset, the second of the pair in the contract canonical order */
    readonly quote: string;
    /** Canonical market key `base/quote` */
    readonly key: string;
    /** Creation timestamp (first oracle check) (UNIX milliseconds) */
    readonly created: number;
    /** Last oracle check (UNIX milliseconds) */
    readonly refreshed: number;
    /** Last 24h ticker entry of the market, available while {@link Axis#subscribeTicker} runs */
    readonly ticker: TickerEntry | undefined;

    /** Check whether the asset is one of the market assets */
    has(asset: string): boolean;
    /**
     * The other market asset
     * @param asset - One of the market assets
     */
    counter(asset: string): string;
    /**
     * Re-check both market assets against the price oracle and cache oracle prices
     * @param signer - Transaction source, the {@link Axis} signer by default
     */
    requote(signer?: Signer): Promise<Market | undefined>;
    /**
     * Extend oracle price feeds access for the market
     * @param params - `amount` of fee tokens to burn
     * @returns New access expiration UNIX timestamps (in seconds) for each oracle-listed asset
     */
    subsidize(params: {amount: bigint, sponsor?: string, signer?: Signer}): Promise<bigint[]>;
    /**
     * Orderbook depth data with given precision
     * @param params - `base` is the base asset, `step` the price step (automatic by default)
     */
    getDepth(params?: {base?: string, depth?: number, step?: string, limit?: number}): Promise<OrderbookDepth>;
    /**
     * Stream the orderbook depth
     * Returns a snapshot, then updates on book changes
     * @returns Unsubscribe function
     */
    subscribeDepth(params: {base?: string, depth?: number, step?: string, limit?: number}, callback: (depth: OrderbookDepth) => void): () => void;
    /**
     * Stream the market trades
     * Returns a snapshot, then updates on trades
     * @param callback - Trades and whether they are the snapshot
     * @returns Unsubscribe function
     */
    subscribeTrades(callback: (trades: ApiTrade[], snapshot: boolean) => void): () => void;
    /**
     * Stream the market candles
     * Returns a snapshot, then updates on trades
     * @param params - `base` is the base asset of the view, `resolution` in seconds or an alias (`5m`, `1h`, …), `limit` the candles in the snapshot (200 by default, at most 200)
     * @param callback - Candles
     * @returns Unsubscribe function
     */
    subscribeCandles(params: {base?: string, resolution: number | string, limit?: number}, callback: (candles: Candle[], snapshot: boolean) => void): () => void;
}

/** Open order of a tracked account */
export interface AccountOrder {
    /** Order id (decimal u128) */
    id: string;
    /** Maker address */
    owner: string;
    /** Sold token */
    selling: string;
    /** Bought token */
    buying: string;
    /** Market key */
    market: string;
    /** Current status */
    status: 'ACTIVE' | 'FILLED' | 'CANCELED' | 'EXPIRED';
    /** `buying` per 1 `selling`, contract scale (18 decimals) */
    price: bigint;
    /** Amount of `selling` left */
    amount: bigint;
    /** Amount of `selling` at creation */
    quote: bigint;
    /** Expiration UNIX timestamp in seconds, 0 = none */
    expires: number;
    /** Creation time, UNIX milliseconds */
    created: number;
    /** Last change, UNIX milliseconds */
    updated: number;
    /** Paging cursor (undefined for unconfirmed local orders) */
    cursor?: bigint;
    /** Share of the account budget in `selling` that backs the order */
    backed: bigint | null;
    /** `backed / amount` (0..1), null when unknown */
    backedPct: number | null;
    /** The backing is not confirmed yet */
    backingPending: boolean;
    /** Filled share of the initial amount (0..1) */
    filledPct: number;
    /** Created by this client, not reported by the indexer yet */
    pending: boolean;
}

/** Balance and allowance of the account in a token, as tracked by the indexer */
export interface AccountBacking {
    asset: string;
    /** Spendable amount (balance minus reserve and liabilities) */
    balance: bigint;
    /** Allowance granted to the AXIS contract */
    allowance: bigint;
    /** Ledger sequence the allowance lives until */
    liveUntil: number;
    /** Whether the account can send and receive the token */
    authorized: boolean;
    /** min(balance, allowance), 0 when unauthorized or expired */
    budget: bigint;
    /** Last load, UNIX milliseconds (0 = not loaded) */
    updated: number;
    /** Last skipped fill of an order selling the token, UNIX milliseconds (0 = none) */
    skipped: number;
    /** A reload confirming the latest change is due */
    pending: boolean;
}

export interface AccountAllowance {
    asset: string;
    /** Whether the backing is tracked and loaded */
    known: boolean;
    balance?: bigint;
    allowance?: bigint;
    liveUntil?: number;
    authorized?: boolean;
    pending?: boolean;
    /** min(balance, allowance) */
    available?: bigint;
    /** Remaining amount of the open orders selling the token */
    committed: bigint;
}

export interface AccountFill {
    /** Order after the fill */
    order: AccountOrder;
    /** Amount of `selling` delivered */
    sold: bigint;
    /** Amount of `buying` received */
    bought: bigint;
    /** Taker address */
    taker: string;
    /** Trade id */
    trade: string;
    /** Trade time, UNIX milliseconds */
    ts: number;
    /** Whether the order is still open */
    partial: boolean;
}

export interface AccountTradeParams {
    /** Token sent */
    selling: string;
    /** Token received */
    buying: string;
    /** `selling` amount of a sell, `buying` amount of a buy (raw units) */
    amount: bigint | string;
    /** Limit price, contract scale; omitted for a market order */
    price?: bigint | string;
    /** {@link OrderKind}: `Limit` by default, `Fill` for a market order */
    kind?: OrderKind;
    /** Expiration UNIX timestamp (seconds) of the resting remainder */
    expires?: number;
    /** Counter orders to cross, looked up automatically when omitted */
    orders?: Array<bigint | string>;
    /** Explicit approval (`null` for none) */
    approve?: Approval | null;
}

export interface AccountTradeResult {
    /** Amount of `selling` sent */
    sold: bigint;
    /** Amount of `buying` received */
    bought: bigint;
    /** ID of the order created for a limit remainder */
    orderId?: string;
    /** The created order (unconfirmed until the indexer reports it) */
    order?: AccountOrder;
    /** Approval granted with the trade */
    approve?: Approval;
}

export interface AccountSwapParams {
    /** Token sent */
    selling: string;
    /** Token received */
    buying: string;
    /** `selling` amount of a sell, `buying` amount of a buy (raw units) */
    amount: bigint | string;
    /** {@link TradeDirection}, `Sell` by default */
    direction?: TradeDirection;
    /** Price tolerance as a fraction (0.005 = 0.5%), 0 by default */
    slippage?: number;
}

/** Market filter: a market key `x/y`, an {@link AxisMarket} or a pair of assets, in any order */
export type AccountMarketFilter = string | {base: string, quote: string} | string[];

/**
 * Trader wrapper that tracks every open order of an account across all markets and the account backing.
 * Create it with {@link import('./axis.js').Axis#account}.
 *
 * Emits:
 * - `ready` - the account state was loaded
 * - `new` {@link AccountOrder} - an order was created (confirmed by the indexer)
 * - `pending` {@link AccountOrder} - an order created by this client, not reported by the indexer yet
 * - `fill` {@link AccountFill} - an order was partially filled
 * - `filled` {@link AccountFill} - an order was filled in full
 * - `update` {@link AccountOrder} - an order changed (amount, price, expiration, revived)
 * - `cancel` {@link AccountOrder} - an order was removed by the owner
 * - `expire` {@link AccountOrder} - an order expired
 * - `remove` {@link AccountOrder} - an order left the open orders (after `filled`, `cancel`, `expire`)
 * - `order` `{action, order, fill?}` - any order change
 * - `backing` `{asset, backing}` - the balance, allowance or the backing split of the orders selling a token changed
 * - `approve` `{asset, amount, liveUntil}` - a trading call is about to grant an allowance
 * - `trade` {ApiTrade} - the account performed a trade
 * - `swap` {ApiSwap} - the account performed a swap
 * - `change` - the open orders or the backing changed
 * - `error` `Error` - the push API rejected the account subscription
 */
export declare class AxisAccount extends Emitter {
    /** Trader address */
    readonly address: string;
    /** Wallet signing callback, required to trade */
    signTransaction?: SignTransactionCallback;
    /** Open orders by id */
    readonly orders: Map<string, AccountOrder>;
    /** Account backing by token contract id */
    readonly backing: Map<string, AccountBacking>;
    /** Resolves once the account state has been loaded */
    readonly ready: Promise<void>;
    /** Whether the account state has been loaded */
    readonly loaded: boolean;
    /** Get spendable balances in every tracked token by token contract id */
    readonly balances: Map<string, bigint>;
    /** Whether the account exists on the ledger */
    readonly funded: boolean | undefined;

    /**
     * Get spendable balance of the account in a token
     * @param asset - Token contract id
     * @returns Undefined if not tracked
     */
    getBalance(asset: string): bigint | undefined;
    /**
     * Retrieve open orders, newest first
     * @param filter - `market` is an {AxisMarket} or a pair of assets in any order
     */
    getOrders(filter?: {market?: AccountMarketFilter, selling?: string, buying?: string}): AccountOrder[];
    /** Get open order by id */
    getOrder(id: bigint | string): AccountOrder | undefined;
    /**
     * Calculate the remaining amount of the open orders selling the token across every market (what the allowance must
     * cover)
     * @param asset - Token contract id
     */
    committed(asset: string): bigint;
    /**
     * Get balance, allowance and commitments of the account in a token
     * @param asset - Token contract id
     */
    getAllowance(asset: string): AccountAllowance;
    /**
     * Sell tokens creating a limit remainder order if not executed in full
     * @param params - `amount` of `selling` to sell; `price` is the minimum `buying` per 1 `selling`
     */
    sell(params: AccountTradeParams): Promise<AccountTradeResult>;
    /**
     * Buy tokens creating a limit remainder order if not executed in full
     * @param params - `amount` of `buying` to acquire; `price` is the maximum `selling` per 1 `buying`
     */
    buy(params: AccountTradeParams): Promise<AccountTradeResult>;
    /**
     * Simulate a sell with the same crossing and approval as `sell`, without signing or submitting it
     * @param params - Same as `sell`
     * @returns Network fee and expected result
     */
    estimateSell(params: AccountTradeParams): Promise<TradeEstimate>;
    /**
     * Simulate a buy with the same crossing and approval as `buy`, without signing or submitting it
     * @param params - Same as `buy`
     * @returns Network fee and expected result
     */
    estimateBuy(params: AccountTradeParams): Promise<TradeEstimate>;
    /**
     * Change the amount, price or expiration of open orders (omitted fields keep their current values)
     * @returns Updated order ids
     */
    update(updates: Array<{id: bigint | string, amount?: bigint, price?: bigint, expires?: number}>): Promise<bigint[]>;
    /** Cancel open orders */
    cancel(ids: Array<bigint | string>): Promise<void>;
    /**
     * Cancel all open orders
     * @returns Canceled order ids
     */
    cancelAll(filter?: {market?: AccountMarketFilter}): Promise<string[]>;
    /**
     * Fill an open order against the book while keeping profits from price inefficiencies
     * @param takerOrderId - Order acting as the taker
     * @param orders - Counter orders, looked up automatically when omitted
     */
    crossfill(takerOrderId: bigint | string, orders?: Array<bigint | string>): Promise<{sold: bigint, bought: bigint, surplus: bigint}>;
    /** Swap across one or several markets along the best route found by the AXIS API */
    swap(params: AccountSwapParams): Promise<{sold: bigint, bought: bigint, approve?: Approval}>;
    /**
     * Compute approval for a call
     * @param asset - Token contract id
     * @param required - Max amount the call may spend
     */
    planApproval(asset: string, required: bigint): Promise<{amount: bigint, liveUntil: number} | undefined>;
    /** Reload current account state from the REST API */
    refresh(): Promise<void>;
    /** Stop tracking this account */
    close(): void;
}

/** Convert an API order to the client form (bigint amounts and prices, numeric timestamps) */
export declare function parseApiOrder(raw: ApiOrder): AccountOrder;
