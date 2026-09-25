/** Trading order type - instructions to contract how to execute the trade */
export enum OrderKind {
    Limit = 1,
    Fill = 2,
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
    /** Absolute allowance amount (0 revokes) */
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

/** Contract configuration: the oracle, the safety admin and the minimum trade size are supplied at deployment */
export interface Config {
    /** Reflector Beam price oracle contract address */
    oracle: string;
    /** Amount of XRF stroops burned by the market creator to provision the oracle price feeds (the oracle's daily fee times 90, derived whenever the oracle is set) */
    market_listing_fee: bigint;
    /** Account allowed to freeze the contract, change the minimum trade size and replace the oracle */
    safety_admin: string;
    /** Minimum trade value in USD with 7 decimals (1 USD = 10_000_000), zero disables the limit */
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

/** `config` event, the configuration set by the constructor, `delegate`, `set_oracle` or `set_floor` (topics: `config`) */
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
    /** New amount, price and expiration per order id */
    updates: Array<OrderUpdate>;
    /** Allowances granted before the backing check, each naming its `asset`; an asset without one keeps its current allowance */
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
     * Fetch market for the asset pair
     * @param selling - First market asset
     * @param buying - Second market asset
     * @returns Market record if the market exists
     */
    getMarket(selling: string, buying: string): Promise<Market | undefined>;

    /**
     * Cancel existing orders, expired ones included: `update` with a zero amount per order (the contract has no
     * `cancel`). The contract holds no funds, so nothing is returned. A transaction fits about 110 orders
     * @param ids - IDs of the orders to cancel (non-existent ids are silently skipped)
     * @param trader - Trader address
     */
    cancel(ids: Array<bigint>, trader: string): Promise<void>;

    /**
     * Update the amount, price, or expiration of several orders in place, or remove them.
     * Orders that no longer exist are skipped; expired orders revived with the new expiration.
     * A zero amount removes the order, expired ones included. An updated order's entry lifetime is extended to cover
     * its expiration +1 day. Approvals and removals work in a frozen contract. A transaction fits about 110 orders
     * @param params - Update parameters
     * @returns IDs of the orders updated or removed
     */
    update(params: UpdateArguments): Promise<Array<bigint>>;

    /**
     * Fill an order on the book against matching orders; the spread crossed goes to `trader`
     * @param trader - Trader address
     * @param takerOrderId - ID of the order that serves as a taker
     * @param orders - List of order IDs to match
     * @returns Amount the taker order sold, amount the makers delivered, surplus paid to the trader
     */
    crossfill(trader: string, takerOrderId: bigint, orders: Array<bigint>): Promise<[bigint, bigint, bigint]>;

    /**
     * Trade with DEX and create buy limit order if quote not executed in full
     * @param params - Trade parameters
     * @returns Amount of sold tokens, bought tokens, and ID of the newly created order if any
     */
    buy(params: BuyTradeArguments): Promise<[bigint, bigint, bigint | undefined]>;

    /**
     * Trade with DEX and create sell limit order if quote not executed in full
     * @param params - Trade parameters
     * @returns Amount of sold tokens, bought tokens, and ID of the newly created order if any
     */
    sell(params: SellTradeArguments): Promise<[bigint, bigint, bigint | undefined]>;

    /**
     * Swap tokens across several markets.
     * @param params - Trade parameters
     * @returns Amount of sold tokens and bought tokens
     */
    swap(params: SwapArguments): Promise<[bigint, bigint]>;

    /** Extend the contract instance and code lifetime. Permissionless, works while frozen */
    keepalive(): Promise<void>;

    /**
     * Re-check both market assets against the price oracle and cache oracle prices.
     * A cached price is valid for up to 72 hours. A market without quoted assets stops accepting new limit orders; its
     * outstanding orders stay cancellable and fillable. The record and the cached prices are rewritten only when they
     * change; a call that would write nothing is not sent (the simulated record is returned). Permissionless, blocked
     * while frozen
     * @param selling - First market asset
     * @param buying - Second market asset
     * @returns Updated market record, undefined if the market does not exist
     */
    requote(selling: string, buying: string): Promise<Market | undefined>;

    /**
     * Extend oracle price feeds access for a market, opening the market if it does not exist yet. Exactly `amount` of
     * XRF is burned from the sponsor; opening a market takes `Config.market_listing_fee` out of `amount`
     * @param params - Subsidy parameters
     * @returns New access expiration UNIX timestamps (in seconds) per oracle-listed asset
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
}

export interface OrderbookDepth {
    /** Ledger sequence */
    ledger: number;
    /** UNIX timestamp (seconds) */
    timestamp: number;
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

/** Contract state tracked by the indexer */
export interface ContractInfo {
    /** Whether trading is blocked by the safety admin */
    frozen: boolean;
    /** Contract configuration (absent until the indexer saw a `config` event) */
    config?: {
        /** Safety admin address */
        safetyAdmin: string;
        /** Price oracle contract address */
        oracle: string;
        /** Fee token amount burned to open a market */
        marketListingFee: string;
        /** Minimum trade value in USD with 7 decimals (0 = disabled) */
        minTradeSize: string;
    };
    /** Markets opened by `subsidize` */
    markets: Array<{
        /** First market asset (the contract's canonical `Address` order) */
        a: string;
        /** Second market asset */
        b: string;
        /** Creation timestamp (UTC) */
        created: string;
        /** Last oracle check timestamp (UTC) */
        refreshed: string;
    }>;
}

export interface OrdersParams {
    /** Filter by order owner address */
    owner?: string;
    /** Filter by asset(s) - every listed asset must be one of the order assets (two assets select a pair) */
    asset?: string | string[];
    /** Pagination cursor (the `cursor` field of the last received order) */
    cursor?: string | bigint;
    /** Max orders to return */
    limit?: number | string;
}

export interface OrderHistoryParams {
    /** Filter by order owner address */
    owner?: string;
    /** Asset pair `[base, quote]` (contract ids) */
    pair?: string[];
    /** Pagination cursor (the `cursor` field of the last received order) */
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

/** Backing of an order maker in the asset the order sells, as tracked by the indexer */
export interface ApiOrderBacking {
    /** Maker token balance */
    balance: string;
    /** Allowance granted to the AXIS contract */
    allowance: string;
    /** Ledger sequence the allowance lives until */
    liveUntil: number;
    /** Whether the maker trustline is authorized */
    authorized: boolean;
    /** Last refresh timestamp (UTC) */
    updated: string;
}

/** Serialized order returned by the API */
export interface ApiOrder {
    /** Order ID (decimal u128) */
    id: string;
    /** Order status: `ACTIVE`, `FILLED`, `CANCELED` (removed by the owner) or `EXPIRED` (archived once past `expires`, back to `ACTIVE` if the owner revives it) */
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
    /** Amount the maker can actually deliver (`min(amount, balance, allowance)`), when the indexer tracks backing */
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
     */
    quoteSell(params: QuoteParams): Promise<QuoteResult>;

    /**
     * Price quote and candidate trade routes for buying a fixed amount of the destination asset
     * @param params - Quote request parameters
     * @returns Best routes ranked by profitability
     */
    quoteBuy(params: QuoteParams): Promise<QuoteResult>;

    /**
     * Order book depth aggregated into price buckets around the mid price
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
     * Contract state tracked by the indexer: frozen switch, configuration and the markets opened by `subsidize`
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
