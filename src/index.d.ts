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
    /** Expiration timestamp (0 = no expiration) */
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
    /** Token the allowance is granted on: defaults to `selling` for `buy`, `sell` and `swap`, required in `update` approvals */
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
    /** Oracle contract address */
    oracle: string;
    /** Amount of oracle tokens burned by the market creator to provision the oracle price feeds (always the oracle daily fee x 90) */
    market_listing_fee: bigint;
    /** Address of the account allowed to freeze the contract, change the minimum trade size and replace the oracle */
    safety_admin: string;
    /** Minimum trade value in USD, with 7 decimals precision (0 disables the limit) */
    min_trade_size: bigint;
}

/** Market asset descriptor */
export interface MarketSide {
    /** Token contract address */
    asset: string;
    /** Whether the asset is quoted by the oracle */
    listed: boolean;
    /** Token decimals (fetched only for listed assets) */
    decimals: number;
}

/** Market record, stored on-chain */
export interface Market {
    /** First asset (canonical order) */
    a: MarketSide;
    /** Second asset (canonical order) */
    b: MarketSide;
    /** Creation timestamp */
    created: bigint;
}

/** Orderbook `trade` event, one per fill (topics: `trade`, `selling`, `buying`) */
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

/** Orderbook `swap` event, one per call (topics: `swap`, `selling`, `buying`) */
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

/** Orderbook `new` event, an order created (topics: `new`, `selling`, `buying`) */
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
    /** Expiration timestamp (0 = no expiration) */
    expires: bigint;
}

/** Orderbook `mod` event, an order changed outside a fill (topics: `mod`) */
export interface OrderUpdatedContractEvent {
    /** Unique order identifier */
    id: bigint;
    /** Order price */
    price: bigint;
    /** Current amount (0 = removed) */
    amount: bigint;
    /** Expiration timestamp (0 = no expiration) */
    expires: bigint;
}

/**
 * Orderbook `skip` event, a listed order its maker could not settle (backing short of the fill, cannot receive the
 * taker's asset, or the transfer failed); the order is left unchanged (topics: `skip`)
 */
export interface OrderSkippedContractEvent {
    /** Order id */
    order: bigint;
}

/** Orderbook `refresh` event, a market checked against the oracle (topics: `refresh`, `a`, `b`; no data) */
export interface MarketRefreshContractEvent {
    /** First market asset (canonical order, topic) */
    a: string;
    /** Second market asset (canonical order, topic) */
    b: string;
}

/** `freeze` event (topics: `freeze`) */
export interface FreezeContractEvent {
    /** Whether trading is blocked after the call */
    frozen: boolean;
}

/** `config` update notification event, emitted by the constructor, `delegate`, `set_oracle` or `set_floor` (topics: `config`) */
export interface ConfigChangedContractEvent {
    /** Contract configuration after the call */
    config: Config;
}

/** A trade step in a multi-market swap path. */
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
    720: {message: "OrderSizeTooSmall"};
    721: {message: "AssetsNotVerifiedByOracle"};
    722: {message: "AssetPriceOracleFetchFailed"};
    723: {message: "InvalidOracleConfig"};
    730: {message: "Frozen"};
    740: {message: "Overflow"};
}

/**
 * Compute the id of the order `owner` creates with `nonce`
 * (first 16 bytes of `sha256(xdr([owner, nonce]))` as a big-endian u128)
 * @param owner - Order owner address
 * @param nonce - u64 nonce the order was created with
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
    /** Transaction fee (0.1 XLM by default) */
    fee?: string;
    /** Declare every supplied order id, and the balances and allowances of the makers behind them, in the read-write footprint of trading transactions (enabled by default) */
    autoFootprint?: boolean;
}

export type SignTransactionCallback = (
    tx: string,
    context: {network: string; networkPassphrase: string; accountToSign: string}
) => Promise<{signedTxXdr: string; signerAddress?: string}>;

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

export declare class AxisContractClient {
    constructor(params: ClientInitializationParams);

    /** Account that signs and pays for the transactions */
    readonly publicKey: string;

    /**
     * Fetch existing order
     * @param id - ID of the order to fetch
     * @returns Order fetched from the storage, undefined if not found or expired
     */
    order(id: bigint): Promise<Order | undefined>;

    /** Fetch contract configuration */
    loadConfig(): Promise<Config>;

    /**
     * Check whether the contract is frozen
     * @returns `true` if contract is frozen (trading and order management operations blocked)
     */
    isFrozen(): Promise<boolean>;

    /**
     * Fetch market for the given asset pair
     * @param selling - First market asset
     * @param buying - Second market asset
     * @returns Market record if the market exists
     */
    getMarket(selling: string, buying: string): Promise<Market | undefined>;

    /**
     * Cancel existing orders, expired ones included: `update` with a zero amount per order (the contract has no
     * `cancel`). A transaction can process up to 100 orders in one batch
     * @param trader - Trader address
     * @param ids - IDs of the orders to cancel (non-existent orders are ignored)
     * @throws If trader is not the owner of any existing order in `ids` or if the contract is frozen
     */
    cancel(trader: string, ids: Array<bigint>): Promise<void>;

    /**
     * Update the amount, price, or expiration of several orders in place, or remove them.
     * Orders that no longer exist are skipped; expired orders revived with the new expiration.
     * A zero amount removes the order, expired ones included. An updated order's entry lifetime is extended to cover
     * its expiration +1 day. Approvals and removals work in a frozen contract. A transaction can process up to 100
     * orders in one batch
     * @param params - Update parameters
     * @returns IDs of the orders to update
     * @throws If the trader does not own an updated order, if order parameters are invalid, if an order is below the
     * minimum value, if the new amounts are not backed by the trader's balance and allowance, if the contract is frozen
     */
    update(params: UpdateArguments): Promise<Array<bigint>>;

    /**
     * Fill an existing order against matching orders from the orderbook. Profits from inefficiencies go to the trader
     * @param trader - Trader address
     * @param takerOrderId - ID of the order that serves as a taker
     * @param orders - List of order IDs to match against
     * @returns Amount the taker order sold, amount the taker received, surplus paid to the trader
     * @throws If the taker order does not exist or has expired, if any of the orders provided do not match
     * selling/buying asset, if the taker order's owner or the trader cannot receive the bought asset, if the contract is
     * frozen
     */
    crossfill(trader: string, takerOrderId: bigint, orders: Array<bigint>): Promise<[bigint, bigint, bigint]>;

    /**
     * Trade with DEX and create a buy limit order if the quote not executed in full
     * @param params - Trade parameters
     * @returns Amount of sold and bought tokens, ID of the newly created order if any
     * @throws If the trader has insufficient balance or allowance, invalid `expires` field specified, a `Limit` trade
     * targets a pair without a market, no reference price is available, any of the counter orders provided do not match
     * selling/buying asset, or a live order with the same id exists
     */
    buy(params: BuyTradeArguments): Promise<[bigint, bigint, bigint | undefined]>;

    /**
     * Trade with DEX and create a sell limit order if the quote not executed in full
     * @param params - Trade parameters
     * @returns Amount of sold and bought tokens, ID of the newly created order if any
     * @throws If the trader has insufficient balance or allowance, invalid `expires` field specified, a `Limit` trade
     * targets a pair without a market, no reference price is available, any of the counter orders provided do not match
     * selling/buying asset, or a live order with the same id exists
     */
    sell(params: SellTradeArguments): Promise<[bigint, bigint, bigint | undefined]>;

    /**
     * Swap tokens across several markets. The contract holds the intermediate hop proceeds only within the call
     * @param params - Swap path and settings
     * @returns Amount of sold and bought tokens
     * @throws If the route cannot satisfy the selling/buying amount, if `path` is empty or an amount is invalid, if any
     * of the orders provided do not match trade step selling/buying asset, if the trader cannot pay for the fills or
     * receive tokens, if the contract is frozen
     */
    swap(params: SwapArguments): Promise<[bigint, bigint]>;

    /** Extend the contract instance and code lifetime */
    keepalive(): Promise<void>;

    /**
     * Re-check both market assets against the price oracle and cache oracle prices.
     * A cached price is valid for up to 72 hours. A market without quoted assets stops accepting new limit orders; its
     * outstanding orders stay cancellable and fillable. The record and the cached prices are rewritten only when they
     * change. When the simulation writes nothing (the market and the cached prices are current, or the oracle has no
     * newer price), the simulated result is returned and no transaction is submitted
     * @param selling - First market asset
     * @param buying - Second market asset
     * @returns Updated market record, undefined if the market does not exist
     * @throws If the contract is frozen
     */
    requote(selling: string, buying: string): Promise<Market | undefined>;

    /**
     * Extend oracle price feeds access for a market, creating the market if it does not exist yet
     * @param params - Subsidy parameters
     * @returns New access expiration UNIX timestamps (in seconds) per oracle-listed asset
     * @throws If `amount` is invalid, if the market does not exist and the amount is below the market listing fee, if
     * neither market asset is quoted by the oracle, if the contract is frozen
     */
    subsidize(params: SubsidizeArguments): Promise<Array<bigint>>;
}

/** Error thrown when the Aggregator API responds with a non-success HTTP status */
export declare class AxisApiError extends Error {
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

/** Contract configuration tracked by the indexer */
export interface ContractInfoConfig {
    /** Safety admin address */
    safetyAdmin: string;
    /** Price oracle contract address */
    oracle: string;
    /** Fee token amount burned to open a market */
    marketListingFee: string;
    /** Minimum trade value in USD with 7 decimals (0 = disabled) */
    minTradeSize: string;
}

/** Market tracked by the indexer */
export interface ContractInfoMarket {
    /** First market asset */
    a: string;
    /** Second market asset */
    b: string;
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
    /** Pagination cursor (order id) */
    cursor?: string | bigint;
    /** Max orders to return */
    limit?: number | string;
}

export interface OrderHistoryParams {
    /** Filter by order owner address */
    owner?: string;
    /** Asset pair `[base, quote]` (contract ids) */
    pair?: string[];
    /** Pagination cursor (order id) */
    cursor?: string | bigint;
    /** Max orders to return */
    limit?: number | string;
}

export interface TradesParams {
    /** Filter by trader address */
    trader?: string;
    /** Asset pair `[base, quote]` (contract ids) */
    pair?: string[];
    /** Pagination cursor (trade id) */
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
    /** Approximate trade price */
    price: string;
    /** Pagination cursor */
    cursor?: string;
    /** Trade timestamp (UTC) */
    timestamp: string;
}

/** HTTP client for the AXIS Aggregator REST API */
export declare class AxisApiClient {
    /** @param serverUrl - Base URL of the Aggregator server */
    constructor(serverUrl: string);

    /** Base URL of the Aggregator server */
    readonly serverUrl: string;

    /**
     * Price quote and candidate trade routes for selling a fixed amount of the source asset
     * @param params - Quote request parameters
     * @returns Best routes ranked by profitability
     * @throws {AxisApiError} If the server is not ready or there is not enough liquidity
     */
    quoteSell(params: QuoteParams): Promise<QuoteResult>;

    /**
     * Price quote and candidate trade routes for buying a fixed amount of the destination asset
     * @param params - Quote request parameters
     * @returns Best routes ranked by profitability
     * @throws {AxisApiError} If the server is not ready or there is not enough liquidity
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
     * @returns Order (throws `AxisApiError` with status 404 if not found)
     */
    getOrder(id: bigint | string | number): Promise<ApiOrder>;

    /**
     * Retrieve archived/historical orders
     * @param params - Filter parameters
     * @returns Archived orders matching the filter
     */
    getOrderHistory(params?: OrderHistoryParams): Promise<ApiOrder[]>;

    /**
     * Retrieve recent trades
     * @param params - Filter parameters
     * @returns Recent trades matching the filter
     */
    getTrades(params?: TradesParams): Promise<ApiTrade[]>;
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
 * Parse an Aggregator API timestamp (`YYYY-MM-DD HH:mm:ss` UTC)
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
    /** Echoed request id (snapshots and errors) */
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
 * WebSocket client of the Aggregator push API.
 * Emits `open`, `close` and `error` (server errors not tied to a subscription).
 */
export declare class AxisStreamClient extends Emitter {
    /** @param url - WebSocket endpoint, e.g. `wss://api.axis.markets/ws` */
    constructor(url: string, options?: StreamClientOptions);

    /** WebSocket endpoint */
    readonly url: string;
    /** Whether the connection is open */
    readonly connected: boolean;

    /**
     * Subscribe to a channel; connects on the first subscription
     * @param channel - Channel name
     * @param params - Channel parameters
     * @param handler - Receives the snapshot (again after every reconnect), the changes, and `{type: 'error'}` if the
     * server rejects the subscription
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
    /** Aggregator REST API URL */
    apiUrl: string;
    /** AXIS contract address */
    contractId: string;
    /** Aggregator push API URL (`<apiUrl>/ws` with the `ws(s)` scheme by default) */
    wsUrl?: string;
    /** Stellar RPC URL, required to trade; also reads allowances and the ledger when the push API does not provide them */
    rpcUrl?: string;
    /** Network passphrase (Pubnet by default) */
    networkPassphrase?: string;
    /** Transaction fee */
    fee?: string;
    /** Default signer settings for contract operations (`keepalive`, `requote`, `subsidize`) */
    signer?: Signer;
    /** REST polling period while the push connection is down, in milliseconds (15 s by default) */
    fallbackPollInterval?: number;
    /** WebSocket implementation (the global one by default) */
    WebSocket?: typeof WebSocket;
}

/**
 * High-level AXIS DEX state.
 * Emits:
 * - `change` - anything in the contract state changed
 * - `frozen` `boolean` - the frozen state toggled
 * - `config` {@link ContractInfoConfig} - contract configuration changed
 * - `market` `{market: AxisMarket, created: boolean}` - a market was opened or updated
 * - `connection` `boolean` - WebSocket push connection opened or dropped
 * - `ledger` `number` - new ledger processed by the indexer
 */
export declare class Axis extends Emitter {
    constructor(options: AxisOptions);

    /** Aggregator REST client */
    readonly api: AxisApiClient;
    /** Aggregator WebSocket API client */
    readonly stream: AxisStreamClient;
    /** Token balance wrappers; undefined without `rpcUrl` */
    readonly tokenBalances: TokenBalance | undefined;
    /** Contract address of the native XLM token */
    readonly nativeAsset: string;
    /** Last known ledger (0 until pushed) */
    readonly ledger: number;
    /** When `ledger` was last updated, UNIX milliseconds */
    readonly ledgerTime: number;
    /** Whether trading is suspended */
    readonly frozen: boolean;
    /** Contract configuration, undefined until loaded */
    readonly config: ContractInfoConfig | undefined;
    /** Available AXIS markets, by the canonical key `a/b` */
    readonly markets: Map<string, AxisMarket>;
    /** 24h ticker entries by the canonical key, filled while `subscribeTicker` runs */
    readonly tickers: Map<string, TickerEntry>;
    /** Whether the contract state loaded */
    readonly loaded: boolean;

    /** Load the contract state and track its changes */
    connect(): Promise<Axis>;
    /** Current ledger sequence: the pushed one while connected and fresh, otherwise read over RPC */
    getLedger(): Promise<number>;
    /**
     * Get market of the asset pair, in either order
     * @param asset1 - Token contract address
     * @param asset2 - Token contract address
     */
    getMarket(asset1: string, asset2: string): AxisMarket | undefined;
    /**
     * Get live order by id, from a tracked account or the Aggregator
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
     * Stream the 24h ticker of every market (canonical orientation).
     * Sends a full snapshot, then updates caused by trades
     * @returns Unsubscribe function
     */
    subscribeTicker(callback?: (ticker: Ticker24hResult) => void): () => void;
    /**
     * Extend the contract instance and code lifetime
     * @param signer - Transaction source, the default signer by default
     */
    keepalive(signer?: Signer): Promise<void>;
    /** Stop following the contract state and tracked accounts */
    close(): void;
}

/** Derive the push API endpoint from the REST API URL */
export declare function toWsUrl(apiUrl: string): string;

/** DEX Market; assets in the contract canonical order */
export declare class AxisMarket {
    /** Base asset */
    readonly a: string;
    /** Quote asset */
    readonly b: string;
    /** Canonical market key `a/b` */
    readonly key: string;
    /** Base asset (`a`) */
    readonly base: string;
    /** Quote asset (`b`) */
    readonly quote: string;
    /** Creation timestamp (first oracle check) (UNIX milliseconds) */
    readonly created: number;
    /** Last oracle check (UNIX milliseconds) */
    readonly refreshed: number;
    /** Last 24h ticker entry of the market, available while {@link Axis.subscribeTicker} runs */
    readonly ticker: TickerEntry | undefined;

    /** Check whether the asset is one of the market assets */
    has(asset: string): boolean;
    /**
     * The other market asset
     * @param asset - One of the market assets
     * @throws If the asset does not belong to the market
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
     * @param params - `base` is the base asset (`a` by default), `step` the price step (automatic by default)
     */
    getDepth(params?: {base?: string, depth?: number, step?: string, limit?: number}): Promise<OrderbookDepth>;
    /**
     * Stream the orderbook depth.
     * Returns a snapshot, then updates on book changes
     * @returns Unsubscribe function
     */
    subscribeDepth(params: {base?: string, depth?: number, step?: string, limit?: number}, callback: (depth: OrderbookDepth) => void): () => void;
    /**
     * Stream the market trades.
     * Returns a snapshot, then updates on trades
     * @param callback - Trades and whether they are the snapshot
     * @returns Unsubscribe function
     */
    subscribeTrades(callback: (trades: ApiTrade[], snapshot: boolean) => void): () => void;
    /**
     * Stream the market candles.
     * Returns a snapshot, then updates on trades
     * @param params - `base` is the base asset of the view, `resolution` in seconds or an alias (`5m`, `1h`, …), `limit`
     * the candles in the snapshot (200 by default, at most 200)
     * @param callback - Candles and whether they are the snapshot
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
    /** Market key (canonical `a/b`) */
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
    /** Share of the account budget in `selling` that backs the order; null when unknown */
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
    /** `Limit` by default, `Fill` for a market order */
    kind?: OrderKind;
    /** Expiration UNIX timestamp (seconds) of the resting remainder */
    expires?: number;
    /** Counter orders to cross, looked up automatically when omitted */
    orders?: Array<bigint | string>;
    /** Explicit approval (`null` for none), planned automatically when omitted */
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
    /** `Sell` by default */
    direction?: TradeDirection;
    /** Price tolerance as a fraction (0.005 = 0.5%), 0 by default */
    slippage?: number;
}

/** Market filter: a market key `x/y`, an {@link AxisMarket} or a pair of assets, in any order */
export type AccountMarketFilter = string | {a: string, b: string} | string[];

/**
 * Trader wrapper that tracks every open order of an account across all markets and the account backing.
 * Create it with {@link Axis.account}.
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
 * - `trade` {@link ApiTrade} - the account performed a trade
 * - `swap` - the account performed a swap
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
    /** Spendable balances in every tracked token by token contract id */
    readonly balances: Map<string, bigint>;
    /** Whether the account exists on the ledger; undefined until its XLM backing is known */
    readonly funded: boolean | undefined;

    /**
     * Get spendable balance of the account in a token
     * @param asset - Token contract id
     * @returns Undefined if not tracked
     */
    getBalance(asset: string): bigint | undefined;
    /**
     * Retrieve open orders, newest first, including unconfirmed ones created by this client
     * @param filter - `market` is an {@link AxisMarket}, a market key or a pair of assets in any order
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
     * Sell tokens creating a limit remainder order if not executed in full (market order without `price`)
     * @param params - `amount` of `selling` to sell; `price` is the minimum `buying` per 1 `selling`
     */
    sell(params: AccountTradeParams): Promise<AccountTradeResult>;
    /**
     * Buy tokens creating a limit remainder order if not executed in full (market order without `price`)
     * @param params - `amount` of `buying` to acquire; `price` is the maximum `selling` per 1 `buying`
     */
    buy(params: AccountTradeParams): Promise<AccountTradeResult>;
    /**
     * Change the amount, price or expiration of open orders (omitted fields keep their current values); the allowance
     * is raised as needed
     * @returns Updated order ids
     */
    update(updates: Array<{id: bigint | string, amount?: bigint, price?: bigint, expires?: number}>): Promise<bigint[]>;
    /** Cancel open orders */
    cancel(ids: Array<bigint | string>): Promise<void>;
    /**
     * Cancel all open orders, optionally of one market
     * @returns Canceled order ids
     */
    cancelAll(filter?: {market?: AccountMarketFilter}): Promise<string[]>;
    /**
     * Fill an open order against the book while keeping profits from price inefficiencies
     * @param takerOrderId - Order acting as the taker
     * @param orders - Counter orders, looked up automatically when omitted
     */
    crossfill(takerOrderId: bigint | string, orders?: Array<bigint | string>): Promise<{sold: bigint, bought: bigint, surplus: bigint}>;
    /** Swap across one or several markets along the best route found by the Aggregator */
    swap(params: AccountSwapParams): Promise<{sold: bigint, bought: bigint, approve?: Approval}>;
    /**
     * Compute approval for a call
     * @param asset - Token contract id
     * @param required - Max amount the call may spend
     * @returns Undefined when the current allowance covers the call
     */
    planApproval(asset: string, required: bigint): Promise<{amount: bigint, liveUntil: number} | undefined>;
    /** Reload current account state from the REST API */
    refresh(): Promise<void>;
    /** Stop tracking this account */
    close(): void;
}

/** Convert an API order to the client form (bigint amounts and prices, numeric timestamps) */
export declare function parseApiOrder(raw: ApiOrder): AccountOrder;
