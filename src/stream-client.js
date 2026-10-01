import {Emitter} from './emitter.js'

/**
 * WebSocket client of the Aggregator push API
 *
 * Emits `open`, `close` and `error` (server errors not tied to a subscription).
 */
export class AxisStreamClient extends Emitter {
    /**
     * @param {string} url - WebSocket endpoint, e.g. `wss://api.axis.markets/ws`
     * @param {StreamClientOptions} [options]
     */
    constructor(url, {WebSocket: WebSocketImpl, pingInterval = 20_000, minReconnectDelay = 1_000, maxReconnectDelay = 30_000} = {}) {
        super()
        if (!url || typeof url !== 'string')
            throw new TypeError('WebSocket URL is required')
        this.url = url
        this.WebSocket = WebSocketImpl || globalThis.WebSocket
        if (!this.WebSocket)
            throw new Error('WebSocket is not available in this environment, pass the `WebSocket` option')
        this.pingInterval = pingInterval
        this.minReconnectDelay = minReconnectDelay
        this.maxReconnectDelay = maxReconnectDelay
    }

    /**
     * WebSocket endpoint
     * @type {string}
     * @readonly
     */
    url
    /**
     * Active subscriptions
     * @type {Set<StreamSubscription>}
     * @private
     */
    subscriptions = new Set()
    /**
     * Subscriptions by the server topic
     * @type {Map<string, Set<StreamSubscription>>}
     * @private
     */
    topics = new Map()
    /**
     * Subscriptions waiting for their snapshot, by request id
     * @type {Map<number, StreamSubscription>}
     * @private
     */
    requests = new Map()
    /**
     * @type {number}
     * @private
     */
    nextId = 1
    /**
     * @type {WebSocket|undefined}
     * @private
     */
    socket
    /**
     * @type {number}
     * @private
     */
    failures = 0
    /**
     * @type {boolean}
     * @private
     */
    closed = false

    /**
     * Whether the connection is open
     * @return {boolean}
     */
    get connected() {
        return !!this.socket && this.socket.readyState === 1
    }

    /**
     * Subscribe to a channel; connects on the first subscription
     * @param {'contract'|'ticker'|'account'|'trades'|'depth'|'candles'} channel
     * @param {{address?: string, market?: string, depth?: number, step?: string, resolution?: number|string, limit?: number}} params -
     *   Channel parameters
     * @param {function(StreamMessage): void} handler - Receives the snapshot (again after every reconnect), the
     *   changes, and `{type: 'error'}` if the server rejects the subscription
     * @return {function(): void} - Unsubscribe function
     */
    subscribe(channel, params, handler) {
        /** @type {StreamSubscription} */
        const sub = {channel, params: params || {}, handler, topic: undefined}
        this.subscriptions.add(sub)
        this.closed = false
        if (this.connected) {
            this.sendSubscribe(sub)
        } else {
            this.connect()
        }
        return () => this.unsubscribe(sub)
    }

    /**
     * Close the connection and drop every subscription
     */
    close() {
        this.closed = true
        this.subscriptions.clear()
        this.topics.clear()
        this.requests.clear()
        clearTimeout(this.reconnectTimer)
        this.stopPing()
        if (this.socket) {
            const socket = this.socket
            this.socket = undefined
            socket.close()
        }
    }

    /**
     * @param {StreamSubscription} sub
     * @private
     */
    unsubscribe(sub) {
        if (!this.subscriptions.delete(sub))
            return
        const {topic} = sub
        if (topic) {
            const subs = this.topics.get(topic)
            subs?.delete(sub)
            if (subs && !subs.size) {
                this.topics.delete(topic)
                if (this.connected && ![...this.subscriptions].some(s => s.topic === topic)) {
                    this.send({op: 'unsubscribe', channel: sub.channel, ...sub.params})
                }
            }
        }
        for (const [id, pending] of this.requests) {
            if (pending === sub) {
                this.requests.delete(id)
            }
        }
    }

    /**
     * @private
     */
    connect() {
        if (this.socket || this.closed)
            return
        clearTimeout(this.reconnectTimer)
        let socket
        try {
            socket = new this.WebSocket(this.url)
        } catch (e) {
            this.scheduleReconnect()
            return
        }
        this.socket = socket
        socket.onopen = () => {
            if (this.socket !== socket)
                return
            this.failures = 0
            this.lastMessage = Date.now()
            this.startPing()
            for (const sub of this.subscriptions) {
                this.sendSubscribe(sub)
            }
            this.emit('open')
        }
        socket.onmessage = e => {
            if (this.socket !== socket)
                return
            this.lastMessage = Date.now()
            let message
            try {
                message = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString())
            } catch (err) {
                return
            }
            this.route(message)
        }
        socket.onclose = () => {
            if (this.socket !== socket)
                return
            this.socket = undefined
            this.stopPing()
            //topics are per connection
            this.topics.clear()
            this.requests.clear()
            for (const sub of this.subscriptions) {
                sub.topic = undefined
            }
            this.emit('close')
            this.scheduleReconnect()
        }
        socket.onerror = () => {
            //followed by close
        }
    }

    /**
     * @private
     */
    scheduleReconnect() {
        if (this.closed || !this.subscriptions.size)
            return
        const delay = Math.min(this.maxReconnectDelay, this.minReconnectDelay * 2 ** this.failures)
        this.failures++
        this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }

    /**
     * @private
     */
    startPing() {
        this.stopPing()
        this.pingTimer = setInterval(() => {
            //no traffic for two periods: the connection is dead even if it was not closed
            if (Date.now() - this.lastMessage > this.pingInterval * 2) {
                this.socket?.close()
                return
            }
            this.send({op: 'ping'})
        }, this.pingInterval)
    }

    /**
     * @private
     */
    stopPing() {
        clearInterval(this.pingTimer)
        this.pingTimer = undefined
    }

    /**
     * @param {StreamSubscription} sub
     * @private
     */
    sendSubscribe(sub) {
        const id = this.nextId++
        this.requests.set(id, sub)
        this.send({op: 'subscribe', id, channel: sub.channel, ...sub.params})
    }

    /**
     * @param {{}} message
     * @private
     */
    send(message) {
        if (this.connected) {
            this.socket.send(JSON.stringify(message))
        }
    }

    /**
     * Deliver a server message to its subscriptions
     * @param {StreamMessage} message
     * @private
     */
    route(message) {
        if (message.type === 'pong' || message.type === 'unsubscribed')
            return
        if (message.id !== undefined && this.requests.has(message.id)) {
            //subscription response: snapshot (learn the topic) or rejection
            const sub = this.requests.get(message.id)
            this.requests.delete(message.id)
            if (message.type === 'error') {
                this.subscriptions.delete(sub)
                return deliver(sub, message)
            }
            if (message.topic) {
                sub.topic = message.topic
                let subs = this.topics.get(message.topic)
                if (!subs) {
                    subs = new Set()
                    this.topics.set(message.topic, subs)
                }
                subs.add(sub)
            }
            return deliver(sub, message)
        }
        if (message.topic) {
            for (const sub of this.topics.get(message.topic) || []) {
                deliver(sub, message)
            }
            return
        }
        if (message.type === 'error') {
            this.emit('error', new Error(message.error))
        }
    }
}

/**
 * @param {StreamSubscription} sub
 * @param {StreamMessage} message
 */
function deliver(sub, message) {
    try {
        sub.handler(message)
    } catch (e) {
        console.error(`Unhandled error in the "${sub.channel}" subscription handler`, e)
    }
}

/**
 * @typedef {{}} StreamClientOptions
 * @property {typeof WebSocket} [WebSocket] - WebSocket implementation (the global one by default)
 * @property {number} [pingInterval] - Application-level ping period, in milliseconds (20 s by default)
 * @property {number} [minReconnectDelay] - First reconnect delay, doubled after each failure (1 s by default)
 * @property {number} [maxReconnectDelay] - Reconnect delay cap (30 s by default)
 */

/**
 * @typedef {{}} StreamMessage - Server message; `type` names the payload, `topic` the subscription it belongs to
 * @property {string} type
 * @property {string} [topic]
 * @property {number} [id]
 */

/**
 * @typedef {{}} StreamSubscription
 * @property {string} channel
 * @property {{}} params
 * @property {function(StreamMessage): void} handler
 * @property {string} [topic]
 * @internal
 */
