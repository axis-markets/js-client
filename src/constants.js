/** Trading order type */
export const OrderKind = {
    /** Execute trade, create a limit order if not executed in full */
    Limit: 1,
    /** Execute trade without creating a limit order */
    Fill: 2,
    /** Execute trade, cancel if was not executed in full */
    FillOrKill: 3
}

/** Trade direction instructions */
export const TradeDirection = {
    Sell: 1,
    Buy: 2
}
