/** Minimal event emitter that works in browsers and Node */
export class Emitter {
    /**
     * @type {Map<string, Set<function>>}
     * @private
     */
    listeners = new Map()

    /**
     * Subscribe to an event
     * @param {string} event
     * @param {function} listener
     * @return {function(): void} - Unsubscribe function
     */
    on(event, listener) {
        let set = this.listeners.get(event)
        if (!set) {
            set = new Set()
            this.listeners.set(event, set)
        }
        set.add(listener)
        return () => this.off(event, listener)
    }

    /**
     * Subscribe to the next occurrence of an event
     * @param {string} event
     * @param {function} listener
     * @return {function(): void} - Unsubscribe function
     */
    once(event, listener) {
        const off = this.on(event, (...args) => {
            off()
            listener(...args)
        })
        return off
    }

    /**
     * Unsubscribe from an event
     * @param {string} event
     * @param {function} listener
     */
    off(event, listener) {
        const set = this.listeners.get(event)
        if (!set)
            return
        set.delete(listener)
        if (!set.size) {
            this.listeners.delete(event)
        }
    }

    /**
     * @param {string} event
     * @param {...*} args
     * @protected
     */
    emit(event, ...args) {
        const set = this.listeners.get(event)
        if (!set)
            return
        for (const listener of [...set]) {
            try {
                listener(...args)
            } catch (e) {
                console.error(`Unhandled error in "${event}" listener`, e)
            }
        }
    }
}
