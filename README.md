# @axis-markets/client

JavaScript SDK for [AXIS](https://axis.markets) Stellar DEX.

- **`AxisContractClient`** — wraps the on-chain AXIS smart contract for order management and trading (sign & send
  transactions, read orders, markets and configuration).
- **`AxisApiClient`** — a dependency-free HTTP client for the AXIS Aggregator and Indexer REST API (quotes, orderbook
  depth, candles, ticker, market/order/trade data).

## Installation

```
npm i @axis-markets/client
```

Requires Node.js 22+ (or any modern browser). `@stellar/stellar-sdk` 17+ is a peer dependency (v17 changed the XDR representation and is not source-compatible with v16).

## AxisContractClient

Wraps the on-chain AXIS smart contract for trading and order management.

```js
import {AxisContractClient, OrderKind, TradeDirection} from '@axis-markets/client'

const client = new AxisContractClient({
    publicKey: 'G...', // trader public key
    contractId: 'C...', // AXIS contract id
    rpcUrl: 'https://soroban-rpc.stellar.org', // Stellar RPC server
    signTransaction: async (xdr, context) => ({signedTxXdr: await wallet.sign(xdr)}) // tx sign callback
})

// Place a sell limit order (the remainder becomes a limit order if not fully executed).
// The id of the created order, if any, is returned as the third tuple element.
const [sold, bought, newOrderId] = await client.sell({
    kind: OrderKind.Limit,
    trader: 'G...',
    amount: 1_000_0000n,
    selling: 'C...selling',
    buying: 'C...buying',
    price: 5_000_000n,
    orders: [], // maker order ids to cross first (from the aggregator quote)
    expires: Math.floor(Date.now() / 1000) + 86_400, // optional expiration of the created order (UNIX seconds)
    approve: {amount: 1_000_000_0000n, liveUntil: 60_000_000} // optional in-call allowance on `selling`
})

// Fetch an order by id
const order = await client.order(newOrderId)

// Re-price an order in place (and keep it for another week)
await client.update({
    trader: 'G...',
    updates: [{id: newOrderId, amount: 500_0000n, price: 5_100_000n, expires: Math.floor(Date.now() / 1000) + 7 * 86_400}]
})

// Cancel orders (an `update` with a zero amount under the hood)
await client.cancel([newOrderId], 'G...')
```

See [`src/index.d.ts`](src/index.d.ts) for the full typed API.

### Methods

| Method | Description |
|---|---|
| `order(id)` | Fetch an order by id from on-chain storage. Returns `Promise<Order \| undefined>` (`undefined` for a missing or expired order). |
| `loadConfig()` | Fetch the contract configuration (contract `config`). Returns `Promise<Config>`. |
| `isFrozen()` | Whether the contract is frozen, trading and order management operations blocked (contract `frozen`). Returns `Promise<boolean>`. |
| `getMarket(selling, buying)` | Fetch the market record for an asset pair, either order (contract `market`). Returns `Promise<Market \| undefined>`. |
| `buy(params)` | Trade with the DEX and create a buy limit order if the quote is not fully executed (`params: BuyTradeArguments`). Returns `Promise<[sold, bought, newOrderId \| undefined]>`. |
| `sell(params)` | Trade with the DEX and create a sell limit order if the quote is not fully executed (`params: SellTradeArguments`). Returns `Promise<[sold, bought, newOrderId \| undefined]>`. |
| `update(params)` | Change the amount, the price and the expiration of several orders in place or remove them (zero `amount`), and optionally set allowances; missing orders are skipped, expired ones are revived, and an updated order's entry lifetime is extended to cover its expiration +1 day (`params: UpdateArguments`). Approvals and removals work in a frozen contract. Returns `Promise<bigint[]>` with the ids updated or removed. |
| `cancel(ids, trader)` | Cancel existing orders, expired ones included (`ids` is a `bigint[]`, `trader` is the owner address). Client sugar: the contract has no `cancel`, this calls `update` with a zero amount per id. Returns `Promise<void>`. |
| `crossfill(trader, takerOrderId, orders)` | Cross an order on the book against matching orders; the crossed spread goes to `trader`. Returns `Promise<[sold, bought, profit]>`. |
| `swap(params)` | Swap tokens across several markets along a route (`params: SwapArguments`). Returns `Promise<[sold, bought]>`. |
| `keepalive()` | Extend the contract instance and code lifetime to 180 days. Permissionless, works while frozen; keepers call it regularly (other calls extend the contract only when less than 3 days are left). Returns `Promise<void>`. |
| `requote(selling, buying)` | Re-check both market assets against the price oracle and cache fresh prices for trading; the market record and the cache are rewritten only when they change (a call that would write nothing is not sent, the simulated record is returned). Permissionless, blocked while frozen. Returns `Promise<Market \| undefined>` with the updated record (`undefined` for an unknown pair). |
| `subsidize(params)` | Open a market or extend its oracle price feeds access by burning exactly `amount` XRF from the sponsor (`params: SubsidizeArguments`). Returns `Promise<bigint[]>` with the new expiration timestamps. |

Standalone helper: `orderId(owner, nonce)` (see below).

The safety admin entry points (`freeze`, `delegate`, `set_oracle`, `set_floor`) are not wrapped: they are operated
outside the client.

`cancel` and `update` fit about 110 orders per transaction; a trade matches at most 20 maker orders (`MAX_FILLS`), and
each listed order the contract skips adds a `skip` event, so 20 fills leave room for 6 skipped orders.

### Markets and prices

A `Limit` trade needs an open market for its pair: without one it fails with `AssetsNotVerifiedByOracle` (`721`).
`Fill`/`FillOrKill` trades and `swap` only cross existing orders and need no market. A market is opened only by
`subsidize({sponsor, selling, buying, amount})` (either asset order opens the same market), which requires at least one of the assets to be quoted by the price oracle:

- On a pair without a market, `amount` must cover `Config.market_listing_fee` (`InvalidAmount`, `706`, otherwise). The
  fee is burned through an oracle `track` call, and whatever is left of `amount` through a second one (skipped when
  nothing is left). The sponsor signs both `track` calls and their XRF `burn` sub-invocations and never burns more than
  `amount`.
- On an existing market the whole `amount` extends the price feeds access of its quoted assets.

The listing fee is not configured: the contract derives it from the oracle's daily fee as `daily_fee × 90` whenever
the oracle is set, and `loadConfig()` returns it. The fee pays one `track` call split across the listed assets, so a pair
with one listed asset gets 90 days of feed and a pair with both listed 45 days each.

`buy`, `sell` and `update` never call the oracle. They value orders against the prices cached by `requote` and
`subsidize`, on the selling asset when it is listed and priced and otherwise on the buying asset; no usable price on
either listed asset (missing or older than 72 hours) fails with `AssetPriceOracleFetchFailed` (`722`). Keepers call
`requote(a, b)` periodically for every active market (permissionless, moves no funds, blocked while frozen).

### Order expiration

`buy`/`sell` take an optional `expires` UNIX timestamp in seconds (0 or omitted means no expiration). It applies to
the order created for the remainder of a `Limit` trade and must be in the future (`InvalidExpiration`, `707`); other kinds ignore
it. An expired order is invisible to `order()`, skipped by matching and treated as gone by `crossfill` (as the taker),
but it can still be cancelled (removed by `update`), and `update` revives it when given an `expires` of 0 or in the future. Its id becomes
free again, so a new order with the same nonce overwrites it. No event is emitted when an order expires.

### Allowances

The contract holds no user funds. Every asset a trader sells through AXIS needs a standing allowance granted to the
contract on the token (`approve(from = trader, spender = AXIS, amount, liveUntil)`), and fills are settled with
`transfer_from` between maker and taker. Orders on the book are backed by the owner's balance and allowance. A listed
order fills only when its maker's backing left covers the fill and the maker can receive the taker's asset; otherwise,
or when the maker's transfer fails, it is skipped and left unchanged, and a `skip` event names it. Matching never
removes, trims or caps an order.

Pass `approve: {amount, liveUntil}` to `buy`, `sell` or `swap` to grant (or reset) the allowance on the selling asset
as part of the same transaction (set `asset` to approve another token). `update` takes a separate
`approvals: [{asset, amount, liveUntil}]` list: each entry must name its asset, an asset without an entry keeps its
current allowance, and a zero amount revokes. The amount is absolute, not a delta, so the signed authorization does not
depend on ledger state; when several approvals name the same asset, the last one wins. `cancel` never moves tokens.

### Order ids and nonces

An order id is chosen by the client through a `u64` nonce:

```
id = u128::from_be_bytes(sha256(xdr(ScVec[owner: Address, nonce: u64]))[0..16])
```

- `buy`/`sell` generate the nonce internally on every call (`Date.now() << 22 | 22 random bits`, fits `u64` until 2109);
  callers never supply one. The id of the order created for the remainder is returned by the call.
- `orderId(owner, nonce)` computes the id locally for a known nonce. `buy`/`sell` use it to declare the new order entry
  in the footprint before the transaction is signed (see below); custom pipelines that pick their own nonce can use it
  the same way. The contract has no view for it.
- A nonce must be unique among the owner's live orders: the contract rejects a duplicate with `OrderExists` (`711`,
  available as `error.code` on the thrown error). Retrying the call generates a fresh nonce.

### Types

#### `OrderKind`

Trading order type — instructions to the contract on how to execute the trade.

| Value | Numeric | Description |
|---|---|---|
| `Limit` | `1` | Execute the trade, creating a limit order if not executed in full. |
| `Fill` | `2` | Execute the trade without creating a limit order. |
| `FillOrKill` | `3` | Execute the trade, fail if it cannot be executed in full. |

#### `TradeDirection`

Trade direction instructions.

| Value | Numeric | Description |
|---|---|---|
| `Sell` | `1` | Sell a fixed amount of asset. |
| `Buy` | `2` | Buy a fixed amount of asset. |

#### `ClientInitializationParams`

Parameters passed to the `AxisContractClient` constructor.

| Property | Type | Description |
|---|---|---|
| `publicKey` | `string` | Public key of the account that will interact with the contract. |
| `signTransaction` | `SignTransactionCallback` | Callback for signing transactions generated by the client. |
| `rpcUrl` | `string` | URL of the RPC server. |
| `contractId` | `string` | DEX contract id. |
| `networkPassphrase?` | `string` | Network passphrase (Pubnet passphrase by default). |
| `fee?` | `string` | Transaction fee (0.1 XLM by default). |
| `autoFootprint?` | `boolean` | Declare every supplied order id, and the balances and allowances of the makers behind them, in the read-write footprint of trading transactions (enabled by default). |

#### `SignTransactionCallback`

`(tx: string, context: {network, networkPassphrase, accountToSign}) => Promise<{signedTxXdr, signerAddress?}>`

Callback for signing transactions generated by the client. Receives the transaction XDR to sign plus the signing
context, and resolves to the signed transaction response.

#### `Approval`

Token allowance granted to the contract as part of the call.

| Property | Type | Description |
|---|---|---|
| `asset?` | `string` | Token the allowance is granted on: defaults to `selling` for `buy`, `sell` and `swap`, required in `update` approvals. |
| `amount` | `bigint` | Absolute allowance amount (0 revokes). |
| `liveUntil` | `number` | Ledger sequence the allowance lives until (at most ~180 days ahead). |

#### `TradeArguments`

Base arguments shared by `buy` and `sell`.

| Property | Type | Description |
|---|---|---|
| `kind` | `OrderKind` | Trading order behavior. |
| `trader` | `string` | Trader address. |
| `amount` | `bigint` | Tokens amount. |
| `selling` | `string` | Selling token address. |
| `buying` | `string` | Buying token address. |
| `price` | `bigint` | Price a trader is willing to accept (18 decimals). |
| `orders?` | `bigint[]` | List of order IDs to match before creating the order on-chain. |
| `expires?` | `bigint \| number` | Expiration UNIX timestamp (seconds) of the order created for a `Limit` remainder, 0 or omitted = none. |
| `approve?` | `Approval` | Optional allowance granted to the contract before trading (on `selling` unless `asset` is set). |

#### `SellTradeArguments`

Extends `TradeArguments` (passed to `sell`).

| Property | Type | Description |
|---|---|---|
| `amount` | `bigint` | Amount of `selling` tokens to sell. |
| `price` | `bigint` | Price a trader is willing to accept — minimum `buying` tokens per 1 `selling`. |

#### `BuyTradeArguments`

Extends `TradeArguments` (passed to `buy`).

| Property | Type | Description |
|---|---|---|
| `amount` | `bigint` | Amount of `buying` tokens to acquire. |
| `price` | `bigint` | Price a trader is willing to accept — maximum `selling` tokens per 1 `buying`. |

#### `TradeStep`

A trade step in a multi-market swap path.

| Property | Type | Description |
|---|---|---|
| `asset` | `string` | Asset to buy at this step. |
| `orders` | `bigint[]` | Maker order IDs to match. |

#### `SwapArguments`

Arguments passed to `swap`.

| Property | Type | Description |
|---|---|---|
| `direction` | `TradeDirection` | Trade direction: `Sell` or `Buy`. |
| `trader` | `string` | Trader address. |
| `selling` | `string` | Token address sent by the trader. |
| `sellingAmount` | `bigint` | Amount of selling tokens to send (`Sell`) or the maximum to spend (`Buy`). |
| `buyingAmount` | `bigint` | Minimum amount of buying tokens to receive (`Sell`) or the exact amount (`Buy`). |
| `path` | `TradeStep[]` | Ordered list of the trade route steps. |
| `approve?` | `Approval` | Optional allowance granted to the contract before trading (on `selling` unless `asset` is set). |

#### `UpdateArguments`

| Property | Type | Description |
|---|---|---|
| `trader` | `string` | Orders owner. |
| `updates` | `OrderUpdate[]` | New amount, price and expiration per order id. |
| `approvals?` | `Approval[]` | Allowances granted before the backing check, each naming its `asset`; assets without one keep their allowance. |

#### `OrderUpdate`

| Property | Type | Description |
|---|---|---|
| `id` | `bigint` | Order id. |
| `amount` | `bigint` | New amount to sell, `0` removes the order. |
| `price` | `bigint` | New order price (ignored for a removal). |
| `expires?` | `bigint \| number` | New expiration UNIX timestamp (seconds), 0 or omitted = none. |

#### `SubsidizeArguments`

| Property | Type | Description |
|---|---|---|
| `sponsor` | `string` | Address paying for the oracle feeds (and the listing fee of a new market). |
| `selling` | `string` | First market asset. |
| `buying` | `string` | Second market asset (either order opens the same market). |
| `amount` | `bigint` | Amount of XRF fee tokens to burn; at least `Config.market_listing_fee` to open a market. |

#### `Order`

Order properties, stored on-chain (returned by `order()` call).

| Property | Type | Description |
|---|---|---|
| `id` | `bigint` | Order ID, derived from the owner and the client nonce. |
| `owner` | `string` | Owner of the order. |
| `selling` | `string` | Selling token address. |
| `buying` | `string` | Buying token address. |
| `amount` | `bigint` | Amount left to sell. |
| `price` | `bigint` | Order price (`buying` per 1 `selling`, 18 decimals). |
| `expires` | `bigint` | Expiration timestamp (0 = no expiration). |

#### `Config`, `Market`, `MarketSide`

Decoded straight from the contract, so field names keep the contract's snake_case:
`Config {oracle, market_listing_fee, safety_admin, min_trade_size}`, `Market {a, b, created}`,
`MarketSide {asset, listed, decimals}`. `market_listing_fee` is derived from the oracle (`daily_fee × 90`), never
supplied: the contract is deployed with `__constructor(safety_admin, oracle, min_trade_size)`.

### Contract events

Trading events use the `vec` data format: the event data is a vector of the fields in the order listed. There is no
trade or swap id; indexers derive one from the ledger, transaction and event position.

| Event | Topics | Data | Notes |
|---|---|---|---|
| `trade` | `trade, selling, buying` (assets sold and bought by the taker) | `order, taker, maker, sold, bought, left` | One per fill. `left` is the order amount after the fill, `0` when the order was filled in full (or what is left became dust) and removed. Fills emit no order event. |
| `swap` | `swap, selling, buying` | `trader, sold, bought` | One per `swap` call, after the fills of every hop. |
| `new` | `new, selling, buying` | `id, owner, price, amount, expires` | An order created. `id` is a `u128`, `expires` a `u64` (0 = none). |
| `mod` | `mod` | `id, price, amount, expires` | An order changed outside a fill: `update` (new price, amount and expiration) or removal by `update`/`cancel` (`amount = 0`). Nothing is emitted when an order expires. |
| `skip` | `skip` | `order: u128` | A listed order its maker could not settle (backing short of the fill, cannot receive the taker's asset, or the transfer failed); the order is left unchanged. Also a `crossfill` taker order its owner cannot back or be paid for. |
| `refresh` | `refresh, a, b` (market assets in canonical order) | none | Every check of a market against the oracle (`requote`, `subsidize`, market creation). |
| `freeze` | `freeze` | `frozen: bool` | |
| `config` | `config` | `Config` | The configuration after the constructor, `delegate`, `set_oracle` or `set_floor`. |

Typed as `TradeContractEvent`, `SwapContractEvent`, `OrderCreatedContractEvent`, `OrderUpdatedContractEvent`,
`OrderSkippedContractEvent`, `MarketRefreshContractEvent`, `FreezeContractEvent`, `ConfigChangedContractEvent` in
[`src/index.d.ts`](src/index.d.ts).

### Contract errors

Simulation failures caused by the contract are thrown as `Error` with `message` `Contract execution error: #<code>
<name>` and a numeric `code` property. `ContractErrors` maps the codes:

| Code | Name | Meaning |
|---|---|---|
| 701 | `NotAuthorized` | The caller does not own the order / is not the safety admin. |
| 702 | `InsufficientBalance` | The order is not backed by the trader's balance. |
| 703 | `InsufficientAllowance` | The allowance granted to the contract does not cover the order. |
| 704 | `InvalidMatch` | `selling` equals `buying`, or a `swap` has no path or a non-positive amount (a listed order of another pair is skipped, not an error). |
| 705 | `InvalidPrice` | Price outside `[1, 10^36]`. |
| 706 | `InvalidAmount` | An amount is not positive, or a `subsidize` that opens a market is below the listing fee. |
| 707 | `InvalidExpiration` | An `expires` is neither 0 nor in the future. |
| 708 | `CannotReceive` | The receiving account cannot accept the asset (missing or deauthorized trustline). |
| 709 | `NotFilled` | A `FillOrKill` trade or `swap` cannot be executed in full. |
| 710 | `OrderNotFound` | The order does not exist or has expired. |
| 711 | `OrderExists` | A live order with the same id exists (retry the call). |
| 720 | `OrderSizeTooSmall` | Order value below the minimum order size, or the remainder is dust. |
| 721 | `AssetsNotVerifiedByOracle` | The pair has no market (open it with `subsidize`), or neither asset is listed on the price oracle. |
| 722 | `AssetPriceOracleFetchFailed` | No listed market asset has a usable cached price: none was fetched by `requote`/`subsidize`, or it is older than 72 hours. |
| 723 | `InvalidOracleConfig` | The price oracle does not satisfy the contract requirements. |
| 730 | `Frozen` | Trading is blocked (order removals and approvals still work). |
| 740 | `Overflow` | A price calculation does not fit i128. Other arithmetic overflows trap as a host error. |

## AxisApiClient

HTTP client for the AXIS Aggregator REST API. Uses the standard `fetch` API - no extra dependencies.

```js
import {AxisApiClient, AxisApiError} from '@axis-markets/client'

const api = new AxisApiClient('https://aggregator.axis.markets')

// Quote: sell a fixed amount of the source asset (strict send)
const sellQuote = await api.quoteSell({
    sellingAsset: 'XLM',
    buyingAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '10000000' // stroops (1 unit = 10,000,000 stroops)
})

// Quote: buy a fixed amount of the destination asset (strict receive)
const buyQuote = await api.quoteBuy({
    sellingAsset: 'XLM',
    buyingAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '5000000'
})

// Order book depth around the mid price
const depth = await api.getDepth({market: 'XLM/USDC', depth: 20})

// OHLCVT candles
const candles = await api.getCandles({market: 'XLM/USDC', resolution: '1h', order: 'asc'})

// 24h ticker for every market
const {ticker} = await api.getTicker24h()
```

### AxisApiClient Methods

| Method | Description |
|---|---|
| `quoteSell({sellingAsset, buyingAsset, amount, direct?})` | Best trade routes for selling a fixed amount of the source asset (strict send). Each hop lists the matched order ids and `worstPrice` (a trade limit that crosses every listed order). |
| `quoteBuy({sellingAsset, buyingAsset, amount, direct?})` | Best trade routes for buying a fixed amount of the destination asset (strict receive). |
| `getDepth({market, depth?})` | Order book depth aggregated into price buckets around the mid price (`depth` is the ± band %, 0–100, default 20). |
| `getCandles({market, from?, to?, resolution?, order?})` | OHLCVT candlestick data. `resolution` accepts seconds or an alias (`5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `12h`, `1d`, `3d`, `1w`, `2w`; default `auto`). |
| `getTicker24h()` | 24-hour ticker statistics for every available market. |
| `getMarkets({cursor?, limit?})` | List all active markets with pagination. |
| `getContract()` | Contract state tracked by the indexer: `frozen`, `config` (`safetyAdmin`, `oracle`, `marketListingFee`, `minTradeSize`) and active `markets`. |
| `getOrders({owner?, asset?, cursor?, limit?})` | Active orders, filterable by owner or asset (`asset` may be a string or string array). |
| `getOrder(id)` | A single active order by ID (throws `AxisApiError` with status 404 if not found). |
| `getOrderHistory({owner?, pair?, cursor?, limit?})` | Archived/historical orders (`pair` = `[base, quote]` contract ids). |
| `getTrades({trader?, pair?, cursor?, limit?})` | Recent trades (`pair` = `[base, quote]` contract ids). |

Assets accept Soroban contract id or classic asset string formats like `XLM`, `CODE:Issuer`, `CODE-Issuer`. Markets use
`BASE/QUOTE` convention. Amounts are expressed in stroops on input and returned as strings. Order ids are decimal
strings of the `u128` id; they are not sequential, so pagination uses the `cursor` field of the last received row.
Orders carry `backed` (the amount the maker can actually deliver) and `backing` when the indexer tracks maker
balances and allowances.

### Error handling

Non-success responses throw an `AxisApiError` carrying the HTTP `status` code:

```js
try {
    await api.getOrder('123')
} catch (e) {
    if (e instanceof AxisApiError && e.status === 404) {
        // not found
    }
    throw e
}
```

## Order footprint

Soroban RPC simulation records only the ledger entries the contract actually touched against the state at simulation
time. The orderbook matching loop stops as soon as the taker is filled, and orders it skipped are recorded read-only
without their makers' entries. If the book moves before the transaction lands - an order is partly filled, repriced back
into range, its maker restores the backing, or an expired order is revived - the contract has to read and write entries
that are missing from the footprint, resulting in a rejection. Likewise, a `Limit` trade that simulation filled in full
may create an order for a remainder at apply time under an entry the simulation never saw.

To make trading transactions resilient to such changes, `buy`, `sell`, `crossfill` and `swap` patch the simulated
transaction before signing. Every order id passed in `orders` (plus the taker order id for `crossfill`, every path step
for `swap`, and the remainder id `orderId(trader, nonce)` for `Limit` trades) is declared in the read-write footprint,
and so is every entry the settlement may write for the maker behind each listed order: the balance of the asset the
maker sells, the maker's allowance on it to the contract, and the balance of the asset the maker receives (an account
entry for XLM, a trustline for a classic asset, the token's `Balance` entry for a contract address; the asset issuer has
none). The client loads the listed orders and the token instances with one RPC `getLedgerEntries` call (the classic
asset behind each token is cached per client) and adds entries in list order, orders first, while the footprint limits
(200 read-write, 400 total) allow. Tokens that are not Stellar Asset Contracts get no maker entries: their storage
layout is unknown. The declared instructions, write bytes and resource fee grow with every added entry; the surplus
resource fee is refundable, but every declared read-write entry pays the write-entry fee, so routers should list only
orders they expect to fill. `update` declares the updated order ids only. Pass `autoFootprint: false` to the
constructor to opt out.

Order entries are keyed by the raw `u128` order id in persistent contract storage and hold a positional vector
`[owner, selling, buying, amount, price, expires?]`. The helpers exported for custom pipelines:

```js
import {orderId} from '@axis-markets/client'
import {collectOrderIds, completeFootprint} from '@axis-markets/client/footprint'
import {rpc} from '@stellar/stellar-sdk'

// the raw `trade` entry point takes the nonce explicitly - any u64 unique among the owner's live orders
const nonce = (BigInt(Date.now()) << 22n) | BigInt(crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffff)
const tx = await client.client.trade({...payload, nonce, expires: 0n}, {fee})
await completeFootprint(tx, contractId, collectOrderIds(payload.orders, [orderId(payload.trader, nonce)]), {
    server: new rpc.Server(rpcUrl),
    tokens: [payload.selling, payload.buying]
})
await tx.signAndSend()
```

`ensureOrdersFootprint(tx, contractId, orderIds)` declares the order entries alone (no RPC call), and
`orderLedgerKey`, `balanceLedgerKey`, `allowanceLedgerKey`, `instanceLedgerKey`, `decodeStoredOrder` and
`decodeSacAsset` build and decode the individual entries.

## Development

Run tests:

```
pnpm test
```

Bundling script:

```
pnpm run prepare
```

Bundles the ESM source (`src/`) into a UMD library (`lib/`) via webpack. Type definitions located in `src/index.d.ts`.

## License

MIT
