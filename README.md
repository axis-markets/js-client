# @axis-markets/client

JavaScript SDK for [AXIS](https://axis.markets) Stellar DEX.

- **`Axis`**, **`AxisMarket`**, **`AxisAccount`** - high-level API stateful: the DEX state (contract, markets) and a
  trader's open orders and allowances kept in memory from the AXIS API WebSocket push channel, with trading calls that
  look up the crossing orders and manage allowances automatically.
- **`AxisContractClient`** — wraps the on-chain AXIS smart contract for order management and trading (sign & send
  transactions, read orders, markets and configuration).
- **`AxisApiClient`** - a dependency-free HTTP client for the AXIS REST API (quotes, orderbook depth, candles, ticker,
  market/order/trade data).
- **`AxisStreamClient`** - WebSocket client of the AXIS API push channel.

## Installation

```
npm i @axis-markets/client
```

Requires Node.js 22+ (or any modern browser). `@stellar/stellar-sdk` 17+ is a peer dependency (v17 changed the XDR
representation and is not source-compatible with v16).

## Axis — high-level API

`Axis` wrapper follows the contract state (frozen switch, configuration) and every market through the AXIS API push API,
falling back to REST polling while the push connection is down. `axis.account()`
returns an `AxisAccount` that keeps in memory all open orders of a trader across every market, and the trader's
spendable balance and allowance in every market token, and trades with automatic allowance management. The AXIS API's
data source streams updates for that state to maintain consistent up-to-date state in memory.

The samples use the Testnet AXIS API (`https://demo-api.axis.markets`, push API at `wss://demo-api.axis.markets/ws`)
and the Testnet tokens below.

```js
import {Axis, TradeDirection} from '@axis-markets/client'

//testnet token contracts
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' //USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
const EURC = 'CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ'

const axis = new Axis({
    apiUrl: 'https://demo-api.axis.markets',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contractId: 'CBJ747MKAGQO2LMJPOTCOONAWBLIIBSLOQE325R457TE5MIS6RTDJ4DC',
    networkPassphrase: 'Test SDF Network ; September 2015'
})
await axis.connect()
axis.on('frozen', frozen => console.log('trading', frozen ? 'suspended' : 'resumed'))

const market = axis.getMarket(XLM, USDC) // either order: market.base / market.quote are in the contract order

const account = axis.account(publicKey, {signTransaction})
await account.ready
account.on('fill', ({order, sold, bought}) => console.log(`order ${order.id}: sold ${sold}, got ${bought}`))
account.on('filled', ({order}) => console.log(`order ${order.id} filled`))
account.on('expire', order => console.log(`order ${order.id} expired`))
account.on('backing', ({asset}) => console.log(asset, 'balance', account.getBalance(asset)))

// network fee of the trade before signing anything (a simulation with the same crossing and approval)
const {fee} = await account.estimateSell({selling: XLM, buying: USDC, amount: 1_000_000_000n, price: 25n * 10n ** 16n})
// limit sell of 100 XLM at 0.25 USDC; crossing orders and the approval are handled by the account
const {sold, bought, orderId} = await account.sell({
    selling: XLM,
    buying: USDC,
    amount: 1_000_000_000n,
    price: 25n * 10n ** 16n
})
// market buy of 10 XLM (no price: crosses the book at the worst quoted maker price)
await account.buy({selling: USDC, buying: XLM, amount: 100_000_000n})
await account.update([{id: orderId, amount: 500_000_000n}])
await account.cancelAll({market})
await account.swap({selling: USDC, buying: EURC, amount: 10_000_000n, direction: TradeDirection.Sell, slippage: 0.005})
```

**Allowances.** The contract holds no funds: an order is fillable up to `min(balance, allowance)` in the sold token, and
one allowance record backs every order selling it. Before each `sell`, `buy`, `swap` and a growing `update`, the account
checks the allowance and attaches to cover all active orders. A fill lowers the allowance and the order it fills in the
same pushed ledger, so the memory state stays consistent. The allowance is read over RPC only when the push connection
is down, the token is not tracked, or for 30 s after this client spent the token as a taker (the push reporting the
spend may lag behind). An order this client created counts as committed right away (`pending: true`) until the indexer
reports it.

**Balances.** While an account is subscribed, the AXIS API tracks it in every market token.
`account.balances` / `getBalance(asset)` give the spendable amount, and each change emits
`backing` event.

**Backing.** Each `AccountOrder` carries `backed` (its share of the budget, split by the indexer among the orders
selling the token oldest first), `backedPct` and `backingPending`.
`account.getAllowance(asset)` reports `balance`, `allowance`, `liveUntil`, `available` and `committed`.

| `Axis` | Description |
|---|---|
| `connect()` | Load the contract state and follow its changes. |
| `ledger`, `getLedger()` | Last ledger pushed by the AXIS API; current ledger (pushed, or RPC when stale). |
| `frozen`, `config`, `markets`, `loaded` | Contract state; `markets` is a `Map` of `AxisMarket` by canonical key. |
| `getMarket(x, y)` | Market of the asset pair in either order, `undefined` if not open. |
| `getOrder(id)` | Live order from a tracked account's memory or the AXIS API, `undefined` if gone. |
| `account(address, {signTransaction})` | `AxisAccount` of the trader (one per address). |
| `subscribeTicker(cb)` | 24h ticker of every market (canonical orientation); also fills `market.ticker`. |
| `keepalive({days?, signer?})` | Extend the contract instance and code lifetime, see `AxisContractClient.keepalive`. |
| `close()` | Stop following the contract and every account. |
| events | `change`, `frozen`, `config`, `market` (`{market, created}`), `connection`, `ledger` |

| `AxisMarket` | Description |
|---|---|
| `base`, `quote`, `key`, `created`, `refreshed` | Canonical assets (the contract's `base` and `quote`), the `base/quote` key and oracle check times. |
| `requote(signer?)` | Re-check the market against the oracle and cache prices (submits nothing when nothing changed). |
| `subsidize({amount, sponsor?, signer?})` | Extend the oracle feeds access of the market. |
| `getDepth({base?, depth?, step?, limit?})`, `subscribeDepth({base?, depth?, step?, limit?}, cb)` | Orderbook depth in the requested orientation, levels on multiples of `step`, pushed on book changes. |
| `subscribeTrades(cb)` | Recent trades, then each new fill. |
| `subscribeCandles({base?, resolution, limit?}, cb)` | Latest candles in the requested orientation (`limit`, default and max 200), then each candle changed by new trades. |

| `AxisAccount` | Description |
|---|---|
| `orders`, `backing`, `ready`, `loaded` | Open orders by id and backing by token, in memory. |
| `balances`, `getBalance(asset)`, `funded` | Spendable balances by token (every market token), whether the account exists. |
| `getOrders({market?, selling?, buying?})` | Open orders, newest first, including `pending` ones this client created. |
| `getOrder(id)`, `committed(asset)`, `getAllowance(asset)` | Order lookup, open amount selling a token, allowance summary. |
| `sell(params)`, `buy(params)` | Trade (`{selling, buying, amount, price?, kind?, expires?, orders?, approve?}`); without `price` it is a market order. Without `orders`, a limit order crosses the orders a direct quote finds up to its price (partial crossings included) and rests with the remainder; a market order crosses the quote for the full amount. Returns `{sold, bought, orderId?, order?, approve?}`. |
| `estimateSell(params)`, `estimateBuy(params)` | Simulate the same trade without signing or submitting it. Returns `{fee, inclusionFee, resourceFee, sold, bought, orderId?}` (fees in stroops, `fee` is the maximum total). |
| `update(updates)` | Change orders (omitted fields keep their values). |
| `cancel(ids)`, `cancelAll({market?})` | Remove orders (batches of 100). |
| `crossfill(takerOrderId, orders?)` | Fill an open order against the book. |
| `swap({selling, buying, amount, direction?, slippage?})` | Swap along the best AXIS API route. |
| events | `ready`, `new`, `pending`, `fill`, `filled`, `update`, `cancel`, `expire`, `remove`, `order`, `backing`, `approve`, `trade`, `swap`, `change`, `error` |

## AxisContractClient

Wraps the on-chain AXIS smart contract for trading and order management.

```js
import {Networks, rpc} from '@stellar/stellar-sdk'
import {AxisContractClient, OrderKind, TradeDirection} from '@axis-markets/client'

const rpcUrl = 'https://soroban-testnet.stellar.org'
const client = new AxisContractClient({
    publicKey: 'G...', // trader public key
    contractId: 'CBJ747MKAGQO2LMJPOTCOONAWBLIIBSLOQE325R457TE5MIS6RTDJ4DC', // AXIS contract (testnet)
    rpcUrl, // Stellar RPC server
    networkPassphrase: Networks.TESTNET, // Pubnet by default
    signTransaction: async (xdr, opts) => wallet.signTransaction(xdr, opts) // resolves to {signedTxXdr}
})
const {sequence} = await new rpc.Server(rpcUrl).getLatestLedger()

// Place a sell limit order (the remainder becomes a limit order if not fully executed).
// The id of the created order, if any, is returned as the third tuple element.
const [sold, bought, newOrderId] = await client.sell({
    kind: OrderKind.Limit,
    trader: 'G...',
    amount: 100_000_000n, // 10 XLM
    selling: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', // XLM
    buying: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', // USDC
    price: 5n * 10n ** 17n, // at least 0.5 USDC per XLM (18 decimals)
    orders: [], // maker order ids to cross first (from a direct AXIS API quote)
    expires: Math.floor(Date.now() / 1000) + 86_400, // optional expiration of the created order (UNIX seconds)
    approve: {amount: 100_000_000n, liveUntil: sequence + 518_400} // optional in-call allowance on `selling` (~30 days)
})

// Fetch an order by id
const order = await client.order(newOrderId)

// Re-price an order in place (and keep it for another week)
await client.update({
    trader: 'G...',
    updates: [{
        id: newOrderId,
        amount: 50_000_000n,
        price: 51n * 10n ** 16n, // 0.51 USDC per XLM
        expires: Math.floor(Date.now() / 1000) + 7 * 86_400
    }]
})

// Cancel orders (an `update` with a zero amount under the hood)
await client.cancel('G...', [newOrderId])
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
| `estimateBuy(params)`, `estimateSell(params)` | Simulate `buy`/`sell` without signing or submitting, to show the network fee first. Returns `Promise<TradeEstimate>`: `fee` (maximum total, stroops), `inclusionFee`, `resourceFee` (including the rent of a new order), and the expected `sold`, `bought` and `orderId`. |
| `update(params)` | Change the amount, the price and the expiration of several orders in place or remove them (zero `amount`), and optionally set allowances; missing orders are skipped, expired ones are revived, and an updated order's entry lifetime is extended to cover its expiration +1 day (`params: UpdateArguments`). Approvals and removals work in a frozen contract; up to 100 orders per transaction. Returns `Promise<bigint[]>` with the ids updated or removed. |
| `cancel(trader, ids)` | Cancel existing orders, expired ones included (`trader` is the owner address; `ids` is a `bigint[]`, non-existent orders are ignored). Client sugar: the contract has no `cancel`, this calls `update` with a zero amount per id; up to 100 orders per transaction. Returns `Promise<void>`. |
| `crossfill(trader, takerOrderId, orders)` | Fill an existing order against matching orders from the book; profits from price inefficiencies (the crossed spread) go to `trader`. Returns `Promise<[sold, bought, surplus]>`: the amount the taker order sold, the amount it received and the surplus paid to `trader`. |
| `swap(params)` | Swap tokens across several markets along a route (`params: SwapArguments`); the contract holds the intermediate hop proceeds only within the call. Returns `Promise<[sold, bought]>`. |
| `keepalive(days?)` | Extend the contract instance and code lifetime to `days` (30 by default, at most the network maximum)Days are converted into ledgers with the configured `Config.ledger_time` (5 seconds when it cannot be read). Anyone can send it, and it works while the contract is frozen. Other calls extend the contract only when less than 3 days are left.  Returns `Promise<number>`, the ledger both entries live until. |
| `requote(selling, buying)` | Re-check both market assets against the price oracle and cache fresh prices for trading; the market record and the cache are rewritten only when they change. When the simulation writes nothing (the market and the cached prices are current, or the oracle has no newer price), no transaction is submitted and the simulated record is returned. Permissionless, blocked while frozen. Returns `Promise<Market \| undefined>` with the updated record (`undefined` for an unknown pair). |
| `subsidize(params)` | Extend the oracle price feeds access of a market, creating the market if it does not exist yet, by burning exactly `amount` XRF from the sponsor (`params: SubsidizeArguments`). Returns `Promise<bigint[]>` with the new expiration timestamps. |

Standalone helper: `orderId(owner, nonce)` (see below).

The safety admin entry points (`freeze`, `delegate`, `set_oracle`, `set_floor`, `set_listing_min_days`,
`set_ledger_time`) are skipped: they are operated outside the client.

The contract itself caps neither the fills of a trade nor the orders of an `update`, the limitations come from the
network's per-transaction limits. A trade settles at most 20 maker orders (`MAX_FILLS`). Each listed order the contract
skips adds a `skip` event, and every trade adds the transfer that forwards the makers' assets to the taker, so 20 fills
leave room for up to 3 skipped orders. An `update` fits about 100 changes or removals. These numbers follow the network
limits: when a protocol upgrade raises them, more fills and updates can fit in one transaction.

### Markets and prices

A `Limit` trade needs an open market for its pair: without one it fails with `AssetsNotVerifiedByOracle` (`721`).
`Fill`/`FillOrKill` trades and `swap` only cross existing orders and need no market. A market is opened only by
`subsidize({sponsor, selling, buying, amount})` (either asset order opens the same market), which requires at least one
of the assets to be quoted by the price oracle:

- On a pair without a market, `amount` must cover `Config.market_listing_fee` (`InvalidAmount`, `706`, otherwise). The
  fee is burned through an oracle `track` call, and whatever is left of `amount` through a second one (skipped when
  nothing is left). The sponsor signs both `track` calls and their XRF `burn` sub-invocations and never burns more than
  `amount`.
- On an existing market the whole `amount` extends the price feeds access of its quoted assets.
- `selling` and `buying` must differ (`InvalidMatch`, `704`).

The listing fee is derived: the contract computes it as `daily_fee × listing_min_days` from the oracle's daily
fee, and `loadConfig()` returns both values. `listing_min_days` is 90 at deployment, and the safety admin can set it
from 0 to 255 days. The fee pays one `track` call split across the listed assets, so at 90 days a pair with one listed
asset gets 90 days of feed and a pair with both listed 45 days each.

`buy`, `sell` and `update` never call the oracle. They value orders against the prices cached by `requote` and
`subsidize`, on the selling asset when it is listed and priced and otherwise on the buying asset; no usable price on
either listed asset (missing or older than 72 hours) fails with `AssetPriceOracleFetchFailed` (`722`). Keepers call
`requote(base, quote)` periodically for every active market (permissionless, moves no funds, blocked while frozen).
`update` cannot change an order of a market whose assets the oracle no longer quotes (`AssetsNotVerifiedByOracle`,
`721`), but removing it still works.

### Order expiration

`buy`/`sell` take an optional `expires` UNIX timestamp in seconds (0 or omitted means no expiration). It applies to the
order created for the remainder of a `Limit` trade and must be in the future (`InvalidExpiration`, `707`); other kinds
ignore it. An expired order is invisible to `order()`, skipped by matching and treated as gone by `crossfill` (as the
taker), but it can still be cancelled (removed by `update`), and `update` revives it when given an `expires` of 0 or in
the future. Its id becomes free again, so a new order with the same nonce overwrites it. No event is emitted when an
order expires.

### Allowances

The contract holds no user funds between calls. Every asset a trader sells through AXIS needs a standing allowance
granted to the contract on the token (`approve(from = trader, spender = AXIS, amount, liveUntil)`). Fills are settled
with `transfer_from`, the contract acting as the spender: each maker's asset goes to the contract, the taker pays each
maker directly, and the contract forwards what the makers delivered to the taker in one transfer at the end. Orders on
the book are backed by the owner's balance and allowance. Matching never removes, trims or limits an order.

A listed order whose maker's backing left does not cover the fill, whose maker cannot receive the taker's asset (a
missing or deauthorized trustline), or whose maker's asset cannot be collected is skipped and left unchanged, and a
`skip` event names it. The order owner is the party at fault. In a `crossfill` the skipped order can be the taker
order, whose owner cannot back it or be paid: the call then returns `[0n, 0n, 0n]`.

A payment to a maker that fails (the taker cannot pay, or the maker cannot be credited although authorized, e.g. a
full trustline) fails the whole call with the token's own error. The client throws it with `tokenError: true` and
blames neither side.

A taker who cannot receive the bought asset fails the call with `CannotReceive` (`708`).
The contract cannot hold an asset whose issuer requires authorization (`AUTH_REQUIRED`) until the issuer authorizes
it: buying such an asset fails with `IntermediaryCannotReceive` (`712`). Selling it needs no contract authorization.
A `swap` is strict: any transfer that fails fails the whole call.

Pass `approve: {amount, liveUntil}` to `buy`, `sell` or `swap` to grant (or reset) the allowance on the selling asset as
part of the same transaction (set `asset` to approve another token). `update` takes a separate
`approvals: [{asset, amount, liveUntil}]` list: each entry must name its asset, an asset without an entry keeps its
current allowance, and a zero amount revokes. The amount is absolute, not a delta, so the signed authorization does not
depend on ledger state; when several approvals name the same asset, the last one wins. `cancel` never moves tokens.

### Order IDs and nonces

An order ID is chosen by the client through a `u64` nonce:

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
| `fee?` | `string` | Inclusion fee bid in stroops (`'100000'`, 0.01 XLM, by default). The resource fee from simulation is added on top. |
| `autoFootprint?` | `boolean` | Declare every supplied order id, and the balances and allowances of the makers behind them, in the read-write footprint of trading transactions (enabled by default). |

#### `SignTransactionCallback`

`(xdr: string, opts?: {networkPassphrase?, address?, submit?, submitUrl?}) => Promise<{signedTxXdr, signerAddress?, error?}>`

Callback for signing transactions generated by the client, in the `@stellar/stellar-sdk` 17 contract client shape. It
receives the transaction XDR and the network passphrase, and resolves to the signed transaction XDR. Stellar Wallets
Kit's
`signTransaction` matches it (pass the connected `address` along), and a `Keypair` signer is a few lines:
`TransactionBuilder.fromXDR(xdr, opts.networkPassphrase)`, `tx.sign(keypair)`, `{signedTxXdr: tx.toXDR()}`.

#### `Approval`

Token allowance granted to the contract as part of the call.

| Property | Type | Description |
|---|---|---|
| `asset?` | `string` | Token the allowance is granted on: defaults to `selling` for `buy`, `sell` and `swap`, required in `update` approvals. |
| `amount` | `bigint` | Absolute allowance amount (0 revokes the approval). |
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
| `approvals?` | `Approval[]` | Allowances granted before the backing check, each naming its `asset`; an asset without an approval keeps its current allowance. |

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
| `expires` | `bigint` | Expiration UNIX timestamp in seconds (0 = no expiration). |

#### `Config`, `Market`, `MarketSide`

Decoded straight from the contract, so field names keep the contract's snake_case:
`Config {safety_admin, oracle, listing_min_days, market_listing_fee, min_trade_size, ledger_time}`,
`Market {base, quote, created}` (the assets in canonical order, `created` in UNIX seconds),
`MarketSide {asset, listed, decimals}`. `market_listing_fee` is derived from the oracle
(`daily_fee × listing_min_days`), never supplied. The contract is deployed with
`__constructor(safety_admin, oracle, min_trade_size)`, which sets
`listing_min_days` to 90 and `ledger_time` (the ledger close time lifetimes are converted with) to 5 seconds. An asset
whose token and oracle decimals add up to more than 37 is recorded as unlisted.

### Contract events

Trading events use the `vec` data format: the event data is a vector of the fields in the order listed. There is no
trade or swap id; indexers derive one from the ledger, transaction and event position.

| Event | Topics | Data | Notes |
|---|---|---|---|
| `trade` | `trade, selling, buying` (assets sold and bought by the taker) | `order, taker, maker, sold, bought, left` | One per fill. `left` is the order amount after the fill, `0` when the order was filled in full (or what is left became dust) and removed. Fills emit no order event. In a `crossfill` the maker fills name the taker order owner as the taker, and a last event reports the taker order fill with the caller as the taker. |
| `swap` | `swap, selling, buying` | `trader, sold, bought` | One per `swap` call, after the fills of every hop. |
| `new` | `new, selling, buying` | `id, owner, price, amount, expires` | An order created. `id` is a `u128`, `expires` a `u64` (0 = none). |
| `mod` | `mod` | `id, price, amount, expires` | An order changed outside a fill: `update` (new price, amount and expiration) or removal by `update`/`cancel` (`amount = 0`). Nothing is emitted when an order expires. |
| `skip` | `skip` | `order: u128` | A listed order its maker could not settle (backing short of the fill, a missing or deauthorized trustline for the taker's asset, or the maker's asset could not be collected). The order is left unchanged. Also a `crossfill` taker order its owner cannot back or be paid for. |
| `refresh` | `refresh, base, quote` (market assets in canonical order) | none | Every check of a market against the oracle (`requote`, `subsidize`, market creation). |
| `freeze` | `freeze` | `frozen: bool` | |
| `config` | `config` | `Config` | The configuration after the constructor, `delegate`, `set_oracle`, `set_floor`, `set_listing_min_days` or `set_ledger_time`. |

Typed as `TradeContractEvent`, `SwapContractEvent`, `OrderCreatedContractEvent`, `OrderUpdatedContractEvent`,
`OrderSkippedContractEvent`, `MarketRefreshContractEvent`, `FreezeContractEvent`, `ConfigChangedContractEvent` in
[`src/index.d.ts`](src/index.d.ts).

### Contract errors

Simulation failures caused by the contract are thrown as `Error` with `message` `Contract execution error: #<code>
<name>` and a numeric `code` property. A failure raised by a token the call invoked (a settlement transfer) is thrown as
an `Error` with the token's `code`, `tokenError: true` and the token `contract`, named after `TokenErrors` (for example
`#10 BalanceError`, which a payer without the balance and a recipient at its trustline limit both raise). Other
simulation failures are rethrown as the raw RPC error string, not an `Error`. A transaction that passes simulation but
fails on-chain throws an `Error` with the transaction `hash` property and the transaction result in its `message`.
`ContractErrors` maps the codes:

| Code | Name | Meaning |
|---|---|---|
| 701 | `NotAuthorized` | An `update` or `cancel` lists an order that `trader` does not own. |
| 702 | `InsufficientBalance` | The order is not backed by the trader's balance. |
| 703 | `InsufficientAllowance` | The allowance granted to the contract does not cover the order. |
| 704 | `InvalidMatch` | `selling` equals `buying` (trades and `subsidize`), or a `swap` has no path or a non-positive amount (a listed order of another pair is skipped, not an error). |
| 705 | `InvalidPrice` | Price outside `[1, 10^36]`. |
| 706 | `InvalidAmount` | An amount is not positive, a `subsidize` that opens a market is below the listing fee, or a configuration value is out of range. |
| 707 | `InvalidExpiration` | An `expires` is neither 0 nor in the future. |
| 708 | `CannotReceive` | The trader cannot receive the bought asset: a missing or deauthorized trustline, or a full one (the transfer forwarding the makers' assets failed). Never a maker's fault. |
| 709 | `NotFilled` | A `FillOrKill` trade or `swap` cannot be executed in full. |
| 710 | `OrderNotFound` | The order does not exist or has expired. |
| 711 | `OrderExists` | A live order with the same id exists (retry the call). |
| 712 | `IntermediaryCannotReceive` | The contract cannot hold an asset it passes on: the asset requires issuer authorization and the issuer has not authorized the AXIS contract yet. |
| 720 | `OrderSizeTooSmall` | Order value below the minimum order size, or the remainder is dust. |
| 721 | `AssetsNotVerifiedByOracle` | The pair has no market (open it with `subsidize`), or neither asset is listed on the price oracle (a `Limit` trade, an `update` that changes an order, `subsidize`). |
| 722 | `AssetPriceOracleFetchFailed` | No listed market asset has a usable cached price (none cached within the last 72 hours). |
| 723 | `InvalidOracleConfig` | The price oracle does not satisfy the contract requirements (at most 24 decimals, a daily fee). |
| 730 | `Frozen` | Trading is blocked (order removals and approvals still work). |
| 740 | `Overflow` | An arithmetic invariant was violated. Other arithmetic overflows trap as a host error. |

## AxisApiClient

HTTP client for the AXIS REST API. Uses the standard `fetch` API - no extra dependencies.

```js
import {AxisApiClient, AxisApiError} from '@axis-markets/client'

const api = new AxisApiClient('https://demo-api.axis.markets') // testnet
const USDC = 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' // testnet USDC

// Quote: sell a fixed amount of the source asset (strict send)
const sellQuote = await api.quoteSell({
    sellingAsset: 'XLM',
    buyingAsset: USDC,
    amount: '10000000' // stroops (1 unit = 10,000,000 stroops)
})
if (sellQuote.status !== 'success') {
    console.log(sellQuote.error) // 'unfeasible' (not enough liquidity) or 'rejected' (contract frozen, or an asset the contract cannot hold)
}

// Quote: buy a fixed amount of the destination asset (strict receive)
const buyQuote = await api.quoteBuy({
    sellingAsset: 'XLM',
    buyingAsset: USDC,
    amount: '5000000'
})

// Order book depth around the mid price
const depth = await api.getDepth({market: `XLM/${USDC}`, depth: 20})

// OHLCVT candles of the last week
const candles = await api.getCandles({
    market: `XLM/${USDC}`,
    from: Math.floor(Date.now() / 1000) - 7 * 86_400, // UNIX seconds, the window starts at 0 (1970) without it
    resolution: '1h',
    order: 'asc'
})

// 24h ticker for every market
const {ticker} = await api.getTicker24h()
```

### AxisApiClient Methods

| Method | Description |
|---|---|
| `quoteSell({sellingAsset, buyingAsset, amount, direct?, maxPrice?})` | Best trade routes for selling a fixed amount of the source asset (strict send). Each hop lists the matched order ids and `worstPrice` (a trade limit that crosses every listed order). Without enough liquidity it resolves with `status: 'unfeasible'` and an `error`, and while the contract is frozen with `status: 'rejected'`. It throws `AxisApiError` with status 409 when the server is not ready or routing fails, and 400 for invalid parameters. With `direct` and `maxPrice` (the highest maker price to cross, in `worstPrice` units) it quotes the crossing of a limit order: orders priced above the limit are left out and the route may trade less than `amount`. |
| `quoteBuy({sellingAsset, buyingAsset, amount, direct?, maxPrice?})` | Best trade routes for buying a fixed amount of the destination asset (strict receive). Resolves and throws like `quoteSell`. |
| `getDepth({market, depth?, step?, limit?})` | Order book depth around the mid price (`depth` is the ± band %, 0–100, default 20) in price levels on multiples of `step` (e.g. `"0.0005"`; 5 significant digits by default), `limit` levels per side (default 100). Bids are rounded down and asks up, so a level price crosses every order in it; `bestBid`/`bestAsk` are the exact best prices. |
| `getCandles({market, from?, to?, resolution?, order?})` | OHLCVT candlestick data. `resolution` accepts seconds or an alias (`5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `12h`, `1d`, `3d`, `1w`, `2w`; default `auto`). |
| `getTicker24h()` | 24-hour ticker statistics for every available market. |
| `getMarkets({cursor?, limit?})` | Pairs with orders on the book, with pagination (cached for up to 30 minutes). Markets opened on-chain come from `getContract()`. |
| `getContract()` | Contract state tracked by the indexer: `frozen`, `config` (`safetyAdmin`, `oracle`, `listingMinDays`, `marketListingFee`, `minTradeSize`, `ledgerTime`) and active `markets` (`base`, `quote`, `created`, `refreshed`). |
| `getOrders({owner?, asset?, cursor?, limit?})` | Active orders, filterable by owner or asset (`asset` may be a string or string array). |
| `getOrder(id)` | A single active order by ID (throws `AxisApiError` with status 404 if not found). |
| `getAccount(address)` | Every live order of an account (not paginated) and its backing per traded token. |
| `getOrderHistory({owner?, pair?, cursor?, limit?})` | Archived/historical orders, newest first (`pair` = `[base, quote]` contract ids). |
| `getTrades({trader?, pair?, cursor?, limit?})` | Recent trades and swaps, newest first (`type: 'trade' \| 'swap'`, `pair` = `[base, quote]` contract ids). The fill of a `crossfill` taker order carries `crossfill: true`: its `taker` is the caller paid the surplus, and the aggregator leaves it out of candles and volume. |
| `getFailures({account?, fn?, cursor?, limit?})` | Failed AXIS calls, newest first (diagnostics only): calls made by the transaction or through another contract, in failed transactions or caught by a calling contract (`caught`). `account` matches the caller and both parties of a failed transfer. Each record has a `reason` (`contract`, `transfer`, `resources`, `auth`, `unknown`), the contract `error` and the failed `transfer`. A record never blames a party: a failed transfer names both sides. |

Classic asset strings (`XLM`, `CODE:Issuer`, `CODE-Issuer`) are accepted by `quoteSell`, `quoteBuy`, `getDepth` and
`getCandles`, next to Soroban contract ids. The `asset`, `pair` and `owner` filters of the order and trade lists need
contract ids and account addresses. Markets use the `BASE/QUOTE` convention, each side in any of these formats. Amounts
are expressed in stroops on input and returned as strings. Orders, trades and quotes carry raw integer amounts and
18-decimal contract prices, while `getDepth`, `getCandles` and `getTicker24h` return decimal prices and whole-unit
volumes. Order ids are decimal strings of the `u128` id. They are not sequential, so pagination passes the `cursor`
field of the last received row (the creation position of an order, the id of a trade), not the id. Orders carry `backed`
(the amount the maker can actually deliver) and `backing` when the indexer tracks maker balances and allowances. Account
backing records also carry `headroom` in the assets the account receives: the room left under its trustline limit
(omitted when unlimited or unknown).

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
into range, its maker restores the backing, an earlier order shrinks, or an expired order is revived - the contract has
to read and write entries that are missing from the footprint, resulting in a rejection. Likewise, a `Limit` trade that
simulation filled in full may create an order for a remainder at apply time under an entry the simulation never saw.

To make trading transactions resilient to such changes, `buy`, `sell`, `crossfill` and `swap` patch the simulated
transaction before signing. Every order id passed in `orders` (plus the taker order id for `crossfill`, every path step
for `swap`, and the remainder id `orderId(trader, nonce)` for `Limit` trades) is declared in the read-write footprint,
and so are the entries the settlement of the call writes whatever makers fill: the contract's own balance of every asset
passing through it (the bought asset, every hop asset of a `swap`, the asset a `crossfill` taker order buys) and the
receiver's balance of the bought asset. Then every entry the settlement may write for the maker behind each listed
order: the balance of the asset the maker sells, the maker's allowance on it to the contract, and the balance of the
asset the maker receives (an account entry for XLM, a trustline for a classic asset, the token's `Balance` entry for a
contract address, none for the asset issuer). The client loads the listed orders and the token instances with one RPC
`getLedgerEntries` call (the classic asset behind each token is cached per client) and adds entries in that order while
the footprint limits (200 read-write, 400 total) allow. Tokens that are not Stellar Asset Contracts keep what the
simulation recorded: their storage layout is unknown. The declared instructions, write bytes and resource fee grow with
every added entry, and the disk read bytes with every added account or trustline entry the simulation did not read; the
surplus resource fee is refundable, but every declared read-write entry pays the write-entry fee, so routers should list
only orders they expect to fill. `update` declares the updated order ids only. Pass `autoFootprint: false` to the
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
    tokens: [payload.selling, payload.buying],
    passThrough: [payload.buying], // makers deliver to the contract
    receiver: payload.trader,       // which forwards to the trader
    bought: payload.buying
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
