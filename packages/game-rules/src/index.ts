export const RULES_ID = 'classic-wilds-v1'
export const TURN_MS = 30_000
export const REVEAL_MS = 5_000

export type Face = 1 | 2 | 3 | 4 | 5 | 6
export type RoundMode = 'NORMAL' | 'PALIFICO'
export type Bid = { readonly quantity: number; readonly face: Face }
type PlacedBid = Bid & { readonly playerId: string }
export type Roll = Readonly<Record<string, readonly Face[]>>
export type Player = {
  readonly id: string
  readonly dice: number
  readonly consecutiveTimeouts: number
}
type Round = {
  readonly players: readonly Player[]
  readonly round: number
  readonly mode: RoundMode
  readonly turn: string
  readonly hands: Roll
  readonly bid: PlacedBid | null
  readonly deadlineAt: number
}
type Resolution =
  | { readonly reason: 'CHALLENGE'; readonly loserId: string; readonly matches: number }
  | { readonly reason: 'TIMEOUT'; readonly loserId: string }
type RoundResult = Resolution & { readonly diceLost: number }
type Settled = Round & { readonly result: RoundResult }
export type Bidding = Round & { readonly phase: 'BIDDING' }
export type Revealing = Settled & {
  readonly phase: 'ROUND_REVEAL'
  readonly nextTurn: string
  readonly nextMode: RoundMode
}
export type Finished = Omit<Settled, 'deadlineAt'> & {
  readonly phase: 'FINISHED'
  readonly winnerId: string
}
export type Match = Bidding | Revealing | Finished
export type Action = { readonly type: 'BID'; readonly bid: Bid } | { readonly type: 'CHALLENGE' }

const faces: readonly Face[] = [1, 2, 3, 4, 5, 6]

export function isLegalBid(bid: Bid, previous: Bid | null, total: number, mode: RoundMode): boolean {
  const { quantity, face } = bid
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > total || !faces.includes(face)) {
    return false
  }
  if (!previous) return mode === 'PALIFICO' || face !== 1
  if (mode === 'PALIFICO') return face === previous.face && quantity > previous.quantity
  if (face === 1 && previous.face === 1) return quantity > previous.quantity
  if (face === 1) return quantity >= Math.ceil(previous.quantity / 2)
  if (previous.face === 1) return quantity >= previous.quantity * 2 + 1
  return quantity > previous.quantity || (quantity === previous.quantity && face > previous.face)
}

export function legalBids(previous: Bid | null, total: number, mode: RoundMode): Bid[] {
  const bids: Bid[] = []
  for (const face of faces) {
    for (let quantity = 1; quantity <= total; quantity++) {
      const bid = { quantity, face }
      if (isLegalBid(bid, previous, total, mode)) bids.push(bid)
    }
  }
  return bids
}

export function countMatches(hands: Roll, face: Face, mode: RoundMode): number {
  const wilds = mode === 'NORMAL' && face !== 1
  return Object.values(hands).flat().filter(die => die === face || (wilds && die === 1)).length
}

export function resolveChallenge(
  hands: Roll, mode: RoundMode, bid: PlacedBid, challengerId: string,
): Resolution & { reason: 'CHALLENGE' } {
  const matches = countMatches(hands, bid.face, mode)
  return { reason: 'CHALLENGE', matches, loserId: matches >= bid.quantity ? challengerId : bid.playerId }
}

function followingPlayer(players: readonly Player[], id: string): string {
  const index = players.findIndex(player => player.id === id)
  if (index === -1) throw new RangeError('Unknown seat')
  const next = [...players.slice(index + 1), ...players.slice(0, index)]
    .find(player => player.dice > 0)
  if (!next) throw new RangeError('No other active seat')
  return next.id
}

export function nextOpener(players: readonly Player[], loserId: string): string {
  return players.some(player => player.id === loserId && player.dice > 0)
    ? loserId
    : followingPlayer(players, loserId)
}

export function nextRoundMode(before: number, after: number, activeCount: number): RoundMode {
  return before === 2 && after === 1 && activeCount >= 3 ? 'PALIFICO' : 'NORMAL'
}

function openRound(
  players: readonly Player[], round: number, mode: RoundMode, turn: string, hands: Roll, now: number,
): Bidding {
  const active = players.filter(player => player.dice > 0)
  if (Object.keys(hands).length !== active.length) throw new RangeError('Invalid roll seats')
  const copiedHands = Object.fromEntries(active.map(({ id, dice }) => {
    const hand = Object.hasOwn(hands, id) ? hands[id] : undefined
    if (!Array.isArray(hand) || hand.length !== dice || !Array.from(hand).every(die => faces.includes(die))) {
      throw new RangeError('Invalid roll values or length')
    }
    return [id, [...hand]]
  }))
  return { phase: 'BIDDING', players, round, mode, turn, hands: copiedHands, bid: null, deadlineAt: now + TURN_MS }
}

export function startMatch(ids: readonly string[], opener: string, hands: Roll, now: number): Bidding {
  if (ids.length < 2 || ids.length > 5 || new Set(ids).size !== ids.length || !ids.includes(opener)) {
    throw new RangeError('Invalid starting seats')
  }
  const players = ids.map(id => ({ id, dice: 5, consecutiveTimeouts: 0 }))
  return openRound(players, 1, 'NORMAL', opener, hands, now)
}

function settle(state: Bidding, resolution: Resolution, now: number): Revealing | Finished {
  const loser = state.players.find(player => player.id === resolution.loserId)!
  const timedOut = resolution.reason === 'TIMEOUT'
  const consecutiveTimeouts = timedOut ? loser.consecutiveTimeouts + 1 : loser.consecutiveTimeouts
  const dice = timedOut && consecutiveTimeouts >= 2 ? 0 : loser.dice - 1
  const players = state.players.map(player => player.id === loser.id
    ? { ...player, dice, consecutiveTimeouts }
    : player)
  const active = players.filter(player => player.dice > 0)
  const { deadlineAt: _deadline, ...round } = state
  const settled = { ...round, players, result: { ...resolution, diceLost: loser.dice - dice } }
  if (active.length === 1) return { ...settled, phase: 'FINISHED', winnerId: active[0].id }
  return {
    ...settled,
    phase: 'ROUND_REVEAL',
    deadlineAt: now + REVEAL_MS,
    nextTurn: nextOpener(players, loser.id),
    nextMode: nextRoundMode(loser.dice, dice, active.length),
  }
}

export type ActionResult =
  | { readonly ok: true; readonly state: Match }
  | { readonly ok: false; readonly state: Match; readonly error:
      'MATCH_FINISHED' | 'WRONG_PHASE' | 'TURN_EXPIRED' | 'NOT_YOUR_TURN' | 'INVALID_BID' | 'NO_BID' }

export function applyAction(state: Match, playerId: string, action: Action, now: number): ActionResult {
  if (state.phase === 'FINISHED') return { ok: false, state, error: 'MATCH_FINISHED' }
  if (state.phase !== 'BIDDING') return { ok: false, state, error: 'WRONG_PHASE' }
  if (now >= state.deadlineAt) return { ok: false, state, error: 'TURN_EXPIRED' }
  if (state.turn !== playerId) return { ok: false, state, error: 'NOT_YOUR_TURN' }

  const total = state.players.reduce((sum, player) => sum + player.dice, 0)
  if (action.type === 'BID' && !isLegalBid(action.bid, state.bid, total, state.mode)) {
    return { ok: false, state, error: 'INVALID_BID' }
  }

  const players = state.players.map(player => player.id === playerId
    ? { ...player, consecutiveTimeouts: 0 }
    : player)
  if (action.type === 'CHALLENGE') {
    if (!state.bid) return { ok: false, state, error: 'NO_BID' }
    const result = resolveChallenge(state.hands, state.mode, state.bid, playerId)
    return { ok: true, state: settle({ ...state, players }, result, now) }
  }
  const { quantity, face } = action.bid
  return {
    ok: true,
    state: {
      ...state, players, bid: { quantity, face, playerId },
      turn: followingPlayer(players, playerId), deadlineAt: now + TURN_MS,
    },
  }
}

export function expireTurn(state: Match, now: number): Match {
  if (state.phase !== 'BIDDING' || now < state.deadlineAt) return state
  return settle(state, { reason: 'TIMEOUT', loserId: state.turn }, now)
}

export function advanceRound(state: Match, hands: Roll, now: number): Match {
  if (state.phase !== 'ROUND_REVEAL' || now < state.deadlineAt) return state
  return openRound(state.players, state.round + 1, state.nextMode, state.nextTurn, hands, now)
}
