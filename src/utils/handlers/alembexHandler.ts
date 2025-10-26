/**
 * ALEMBEX Sequence Betting System Handler
 *
 * This module implements the ALEMBEX mathematical sequence for calculating
 * optimal bet sizing in trading strategies. The system closes sequences after
 * two consecutive winning trades and minimizes drawdown.
 *
 * Reference: Mustaapha Belkhayate's ALEMBEX Mathematical Sequence
 */

export interface TradeRecord {
    tradeNum: number;
    seqNum: number;
    mise: number;
    result: 'Gain' | 'Perte';
    pnl: number;
    cumulSeq: number;
    cumulTotal: number;
}

export interface AlembexConfig {
    uniteBase: number;
    ratioGainPerte: number;
}

export interface AlembexState {
    historique: TradeRecord[];
    cumulSeq: number;
    cumulTotal: number;
    seqNum: number;
    lastWasTwoConsecutiveGains: boolean;
    capitalDepart: number;
}

/**
 * Initialize ALEMBEX state
 *
 * @param capitalDepart Initial capital amount
 * @returns Initialized AlembexState
 */
export function initializeAlembex(capitalDepart: number): AlembexState {
    return {
        historique: [],
        cumulSeq: 0,
        cumulTotal: capitalDepart,
        seqNum: 1,
        lastWasTwoConsecutiveGains: false,
        capitalDepart,
    };
}

/**
 * Calculate the ALEMBEX bet size for the next trade
 *
 * Rules:
 * 1. New sequence or after sequence closure: bet = uniteBase
 * 2. After a winning trade: bet = |cumul of (n-2)th trade| + uniteBase
 * 3. After a losing trade: bet = uniteBase (reset to minimize drawdown)
 *
 * @param state Current ALEMBEX state
 * @param config ALEMBEX configuration (uniteBase, ratioGainPerte)
 * @returns Calculated bet size for next trade
 */
export function miseAlembex(state: AlembexState, config: AlembexConfig): number {
    const { historique, cumulSeq, lastWasTwoConsecutiveGains } = state;
    const { uniteBase } = config;

    // New sequence or sequence just closed
    if (cumulSeq === 0 || lastWasTwoConsecutiveGains) {
        return uniteBase;
    }

    // After a winning trade
    if (historique.length > 0 && historique[historique.length - 1].result === 'Gain') {
        const cumulPrecedent = historique.length > 1
            ? historique[historique.length - 2].cumulSeq
            : 0;
        return Math.abs(cumulPrecedent) + uniteBase;
    }

    // After a losing trade: reset to base unit to minimize drawdown
    return uniteBase;
}

/**
 * Process a trade result and update ALEMBEX state
 *
 * @param state Current ALEMBEX state
 * @param config ALEMBEX configuration
 * @param tradeResult Trade result ('Gain' or 'Perte')
 * @returns Updated AlembexState
 */
export function processTradeAlembex(
    state: AlembexState,
    config: AlembexConfig,
    tradeResult: 'Gain' | 'Perte'
): AlembexState {
    const mise = miseAlembex(state, config);
    const isGain = tradeResult === 'Gain';

    // Calculate P&L
    const pnl = isGain ? mise * config.ratioGainPerte : -mise;
    const newCumulSeq = state.cumulSeq + pnl;
    const newCumulTotal = state.cumulTotal + pnl;

    // Create trade record
    const tradeRecord: TradeRecord = {
        tradeNum: state.historique.length + 1,
        seqNum: state.seqNum,
        mise,
        result: tradeResult,
        pnl,
        cumulSeq: newCumulSeq,
        cumulTotal: newCumulTotal,
    };

    // Check if two consecutive wins (sequence closure condition)
    const willBeTwoConsecutiveGains =
        state.historique.length > 0 &&
        state.historique[state.historique.length - 1].result === 'Gain' &&
        isGain;

    let newSeqNum = state.seqNum;
    let newCumulSeqReset = newCumulSeq;
    let lastWasTwoConsecutiveGains = false;

    if (willBeTwoConsecutiveGains) {
        lastWasTwoConsecutiveGains = true;
        newSeqNum = state.seqNum + 1;
        newCumulSeqReset = 0; // Reset cumul for new sequence
    }

    return {
        historique: [...state.historique, tradeRecord],
        cumulSeq: newCumulSeqReset,
        cumulTotal: newCumulTotal,
        seqNum: newSeqNum,
        lastWasTwoConsecutiveGains,
        capitalDepart: state.capitalDepart,
    };
}

/**
 * Get statistics from ALEMBEX state
 *
 * @param state Current ALEMBEX state
 * @returns Object containing trading statistics
 */
export function getAlembexStats(state: AlembexState) {
    const { historique, cumulTotal, capitalDepart } = state;

    const totalTrades = historique.length;
    const winningTrades = historique.filter(t => t.result === 'Gain').length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    let maxCapital = capitalDepart;
    let maxDrawdown = 0;

    for (const trade of historique) {
        if (trade.cumulTotal > maxCapital) {
            maxCapital = trade.cumulTotal;
        }
        const drawdown = maxCapital - trade.cumulTotal;
        if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
        }
    }

    const totalGain = cumulTotal - capitalDepart;
    const roi = totalGain / capitalDepart * 100;

    return {
        totalTrades,
        winningTrades,
        losingTrades: totalTrades - winningTrades,
        winRate: parseFloat(winRate.toFixed(2)),
        finalCapital: parseFloat(cumulTotal.toFixed(2)),
        totalGain: parseFloat(totalGain.toFixed(2)),
        maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
        roi: parseFloat(roi.toFixed(2)),
    };
}

/**
 * Reset ALEMBEX state to initial conditions
 *
 * @param capitalDepart Initial capital amount
 * @returns Fresh AlembexState
 */
export function resetAlembex(capitalDepart: number): AlembexState {
    return initializeAlembex(capitalDepart);
}