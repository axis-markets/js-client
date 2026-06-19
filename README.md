# @axis-markets/client

JavaScript SDK for [AXIS](https://axis.markets) Stellar DEX.

- **`AxisContractClient`** — wraps the on-chain AXIS smart contract for order management and trading (sign & send transactions, read orders).
- **`ApiClient`** — a dependency-free HTTP client for the AXIS Aggregator and Indexer REST API (quotes, orderbook depth, candles, ticker, market/order/trade data).

## Installation

```
npm i @axis-markets/client
```

Requires Node.js 20+ (or any modern browser).


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

// Read the last created order id
const lastId = await client.last()

// Fetch an order by id
const order = await client.order(lastId)

// Place a sell limit order (creates a limit order if not fully executed)
const [sold, bought, newOrderId] = await client.sell({
    kind: OrderKind.Limit,
    trader: 'G...',
    amount: 1_000_0000n,
    selling: 'C...selling',
    buying: 'C...buying',
    price: 5_000_000n,
    orders: []
})

// Cancel orders
await client.cancel([lastId], 'G...')
```

See [`src/index.d.ts`](src/index.d.ts) for the full typed API (`buy`, `sell`, `swap`, `fill_order`, `cancel`, `order`, `last`).


## ApiClient

HTTP client for the AXIS Aggregator REST API. Uses the standard `fetch` API - no extra dependencies.

```js
import {ApiClient, AxisApiError} from '@axis-markets/client'

const api = new ApiClient('https://aggregator.axis.markets')

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

### ApiClient Methods

| Method | Description |
|---|---|
| `quoteSell({sellingAsset, buyingAsset, amount, direct?})` | Best trade routes for selling a fixed amount of the source asset (strict send). |
| `quoteBuy({sellingAsset, buyingAsset, amount, direct?})` | Best trade routes for buying a fixed amount of the destination asset (strict receive). |
| `getDepth({market, depth?})` | Order book depth aggregated into price buckets around the mid price (`depth` is the ± band %, 0–100, default 20). |
| `getCandles({market, from?, to?, resolution?, order?})` | OHLCVT candlestick data. `resolution` accepts seconds or an alias (`5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `12h`, `1d`, `3d`, `1w`, `2w`; default `auto`). |
| `getTicker24h()` | 24-hour ticker statistics for every available market. |
| `getMarkets({cursor?, limit?})` | List all active markets with pagination. |
| `getOrders({owner?, asset?, cursor?, limit?})` | Active orders, filterable by owner or asset (`asset` may be a string or string array). |
| `getOrder(id)` | A single active order by ID (`null` if not found). |
| `getOrderHistory({owner?, pair?, cursor?, limit?})` | Archived/historical orders (`pair` = `[base, quote]` contract ids). |
| `getTrades({trader?, pair?, cursor?, limit?})` | Recent trades (`pair` = `[base, quote]` contract ids). |

Assets accept Soroban contract id or classic asset string formats like `XLM`, `CODE:Issuer`, `CODE-Issuer`. 
Markets use `BASE/QUOTE` convention. Amounts are expressed in stroops on input and returned as strings.

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

## Development

Bundling script:

```
npm run prepare
```

Bundles the ESM source (`src/`) into a UMD distributable (`lib/`) via webpack.
Type definitions are published from `src/index.d.ts`.

## License

MIT
