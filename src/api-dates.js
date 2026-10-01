/**
 * Parse an Aggregator API timestamp (`YYYY-MM-DD HH:mm:ss` UTC)
 * @param {string|number|undefined} value
 * @return {number} - UNIX milliseconds, 0 when missing or invalid
 */
export function parseApiDate(value) {
    if (value === undefined || value === null || value === '')
        return 0
    if (typeof value === 'number')
        return value
    let text = String(value).trim().replace(' ', 'T')
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(text)) {
        text += 'Z'
    }
    const ms = Date.parse(text)
    return Number.isFinite(ms) ? ms : 0
}
