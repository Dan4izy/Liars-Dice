import { expect, test } from 'vitest'
import {
  advanceRound, applyAction, countMatches, expireTurn, isLegalBid, legalBids,
  resolveChallenge, startMatch, REVEAL_MS, TURN_MS,
  type Action, type Bid, type Bidding, type Face, type Match, type Player, type Roll, type RoundMode,
} from '../src/index.js'

const faces: Face[] = [1, 2, 3, 4, 5, 6]
const bid = (quantity: number, face: Face): Bid => ({ quantity, face })
const challenge = { type: 'CHALLENGE' } as const
const offer = (quantity: number, face: Face): Action => ({ type: 'BID', bid: bid(quantity, face) })
const seats = ['A', 'B', 'C', 'D', 'E']

function roll(players: readonly Player[], die: () => Face): Roll {
  return Object.fromEntries(players.filter(p => p.dice > 0)
    .map(p => [p.id, Array.from({ length: p.dice }, die)]))
}

function start(count: number, die: () => Face = () => 4): Bidding {
  const ids = seats.slice(0, count)
  return startMatch(ids, ids[0], roll(ids.map(id => ({ id, dice: 5, consecutiveTimeouts: 0 })), die), 0)
}

function fixture(hands: Roll, ids = Object.keys(hands)): Bidding {
  return {
    ...start(ids.length),
    players: ids.map(id => ({ id, dice: hands[id]?.length ?? 0, consecutiveTimeouts: 0 })),
    hands,
  }
}

function play(state: Bidding, action: Action): Match {
  const result = applyAction(state, state.turn, action, state.deadlineAt - 1)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

function bidding(state: Match): Bidding {
  if (state.phase !== 'BIDDING') throw new Error(state.phase)
  return state
}

function reveal(state: Match) {
  if (state.phase !== 'ROUND_REVEAL') throw new Error(state.phase)
  return state
}

function restart(state: Match): Bidding {
  const result = reveal(state)
  return bidding(advanceRound(result, roll(result.players, () => 5), result.deadlineAt))
}

function total(state: Match): number {
  return state.players.reduce((sum, player) => sum + player.dice, 0)
}

test('G01 — 2–5 seats, five dice each; invalid seats and rolls rejected', () => {
  for (const count of [2, 3, 4, 5]) {
    const state = start(count)
    expect(state.players.map(p => p.dice)).toEqual(Array(count).fill(5))
    expect(Object.values(state.hands)).toEqual(Array(count).fill([4, 4, 4, 4, 4]))
  }
  for (const ids of [['A'], [...seats, 'F'], ['A', 'A'], ['A', 'B']]) {
    expect(() => startMatch(ids, 'Z', {}, 0)).toThrow(RangeError)
    expect(() => startMatch(ids, 'A', {}, 0)).toThrow(RangeError)
  }
  expect(() => startMatch(['A', 'B'], 'A', { A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 7 as Face] }, 0))
    .toThrow(RangeError)
})

test('G02 — normal opening forbids ones and requires a bid before challenging', () => {
  const state = start(2)
  expect(applyAction(state, 'A', offer(1, 1), 0)).toMatchObject({ error: 'INVALID_BID' })
  expect(applyAction(state, 'A', challenge, 0)).toMatchObject({ error: 'NO_BID' })
  expect(applyAction(state, 'B', offer(1, 2), 0)).toMatchObject({ error: 'NOT_YOUR_TURN' })
  expect(play(state, offer(1, 2))).toMatchObject({ turn: 'B', bid: bid(1, 2) })
})

test.each([
  ['G03', 5, 4, 5, 3, false],
  ['G03', 5, 4, 5, 5, true],
  ['G03', 5, 4, 6, 2, true],
  ['G04', 5, 4, 2, 1, false],
  ['G04', 5, 4, 3, 1, true],
  ['G04', 8, 6, 4, 1, true],
  ['G05', 3, 1, 3, 1, false],
  ['G05', 3, 1, 4, 1, true],
  ['G05', 3, 1, 6, 6, false],
  ['G05', 3, 1, 7, 2, true],
] as const)('%s — raise %i×%i to %i×%i is %s', (_, q, f, nextQ, nextF, accepted) => {
  expect(isLegalBid(bid(nextQ, nextF), bid(q, f), 10, 'NORMAL')).toBe(accepted)
})

test('G06 — equality, wilds and ones-only count', () => {
  const hands = { A: [1, 4, 6], B: [2, 4], C: [1, 5] } as const
  for (const [quantity, face, matches, loserId] of [[4, 4, 4, 'B'], [5, 4, 4, 'A'], [3, 1, 2, 'A']] as const) {
    const placed = { ...bid(quantity, face), playerId: 'A' }
    const state = { ...fixture(hands), turn: 'B', bid: placed }
    expect(resolveChallenge(hands, 'NORMAL', placed, 'B')).toMatchObject({ matches, loserId })
    const result = reveal(play(state, challenge))
    expect(result.result).toMatchObject({ matches, loserId, diceLost: 1 })
    expect(result.hands).toEqual(hands)
    expect(total(result)).toBe(total(state) - 1)
  }
})

test('G07 — Palifico fixes the face and lasts one round unless another player qualifies', () => {
  const state = fixture({ A: [1, 4], B: [4], C: [6, 2, 3] })
  const result = reveal(expireTurn(state, state.deadlineAt))
  expect(result).toMatchObject({ nextTurn: 'A', nextMode: 'PALIFICO' })
  const special = bidding(advanceRound(result, { A: [1], B: [2], C: [1, 2, 3] }, result.deadlineAt))
  const opened = bidding(play(special, offer(1, 1)))
  expect(play(opened, offer(2, 1))).toMatchObject({ bid: bid(2, 1) })
  expect(applyAction(opened, 'B', offer(2, 2), 0)).toMatchObject({ error: 'INVALID_BID' })
  expect(countMatches(special.hands, 2, 'PALIFICO')).toBe(2)
  const challenged = reveal(play(opened, challenge))
  expect(challenged.nextMode).toBe('NORMAL')

  const otherQualifies = { ...fixture({ A: [1], B: [2, 3], C: [2] }), mode: 'PALIFICO' } as const
  const raised = bidding(play(otherQualifies, offer(1, 2)))
  expect(reveal(play(raised, challenge))).toMatchObject({ nextMode: 'PALIFICO', nextTurn: 'B' })
})

test('G08 — duel keeps wilds; final state preserves reveal and rejects every action', () => {
  const state = fixture({ A: [1], B: [3] })
  const result = play(bidding(play(state, offer(2, 3))), challenge)
  expect(result).toMatchObject({ phase: 'FINISHED', winnerId: 'A', hands: state.hands, result: { matches: 2 } })
  for (const action of [challenge, offer(1, 2)]) {
    const rejected = applyAction(result, 'A', action, TURN_MS)
    expect(rejected).toMatchObject({ ok: false, error: 'MATCH_FINISHED' })
    expect(rejected.state).toBe(result)
  }
  expect(expireTurn(result, 100_000)).toBe(result)
  expect(advanceRound(result, {}, 100_000)).toBe(result)
  const duel = fixture({ A: [1, 2], B: [3] })
  expect(reveal(expireTurn(duel, duel.deadlineAt)).nextMode).toBe('NORMAL')
})

test('G09 — opener and later turns skip eliminated seats', () => {
  const state = fixture({ A: [4], B: [4], D: [4] }, ['A', 'B', 'C', 'D'])
  const result = reveal(play(bidding(play(state, offer(1, 4))), challenge))
  expect(result.nextTurn).toBe('D')
  const next = restart(result)
  const a = bidding(play(next, offer(1, 2)))
  expect(a.turn).toBe('A')
  expect(play(a, offer(1, 3))).toMatchObject({ turn: 'D' })
})

test('G10 — ceiling blocks all raises but permits challenging', () => {
  for (const [face, mode] of [[1, 'NORMAL'], [4, 'PALIFICO']] as const) {
    const state = { ...fixture({ A: [4, 4, 4], B: [4, 4, 4] }), mode, turn: 'B', bid: { ...bid(6, face), playerId: 'A' } }
    expect(legalBids(state.bid, 6, mode)).toEqual([])
    expect(applyAction(state, 'B', offer(7, face), 0)).toMatchObject({ error: 'INVALID_BID' })
    expect(play(state, challenge)).toMatchObject({ phase: 'ROUND_REVEAL' })
  }
})

test('G11 — timeouts use absolute deadlines and only accepted personal moves reset the counter', () => {
  const state = start(3)
  expect(expireTurn(state, TURN_MS - 1)).toBe(state)
  expect(applyAction(state, 'A', offer(1, 2), TURN_MS)).toMatchObject({ error: 'TURN_EXPIRED' })
  const first = reveal(expireTurn(state, TURN_MS + 1_000))
  expect(first).toMatchObject({ deadlineAt: TURN_MS + 1_000 + REVEAL_MS, result: { reason: 'TIMEOUT', diceLost: 1 } })
  expect(advanceRound(first, {}, first.deadlineAt - 1)).toBe(first)
  const a = restart(first)
  expect(a.deadlineAt).toBe(first.deadlineAt + TURN_MS)
  const second = reveal(expireTurn(a, a.deadlineAt))
  expect(second).toMatchObject({ nextTurn: 'B', result: { diceLost: 4 } })
  expect(second.players[0].dice).toBe(0)

  const b = bidding(play(a, offer(1, 2)))
  const c = bidding(play(b, offer(1, 3)))
  const backToA = bidding(play(c, offer(1, 4)))
  const afterManual = reveal(expireTurn(backToA, backToA.deadlineAt))
  expect(afterManual.result).toEqual({ reason: 'TIMEOUT', loserId: 'A', diceLost: 1 })
  expect(afterManual.players[0].consecutiveTimeouts).toBe(1)

  const afterChallenge = reveal(play({ ...a, bid: { ...bid(1, 5), playerId: 'C' } }, challenge))
  expect(afterChallenge.players[0].consecutiveTimeouts).toBe(0)
})

test('legalBids and isLegalBid agree for 2–25 dice, all previous bids and both modes', () => {
  for (let totalDice = 2; totalDice <= 25; totalDice++) {
    const all = faces.flatMap(face => Array.from({ length: totalDice }, (_, index) => bid(index + 1, face)))
    for (const mode of ['NORMAL', 'PALIFICO'] satisfies RoundMode[]) {
      for (const previous of [null, ...all]) {
        expect(legalBids(previous, totalDice, mode))
          .toEqual(all.filter(candidate => isLegalBid(candidate, previous, totalDice, mode)))
      }
    }
  }
})

test.each([2, 3, 4, 5])('simulated match reaches a winner with %i seats', count => {
  let seed = 12345
  const die = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return faces[seed % faces.length]
  }
  let state: Match = start(count, die)
  for (let step = 0; step < 100 && state.phase !== 'FINISHED'; step++) {
    if (state.phase === 'ROUND_REVEAL') {
      state = advanceRound(state, roll(state.players, die), state.deadlineAt)
    } else if (state.bid) {
      const before = total(state)
      state = play(state, challenge)
      expect(total(state)).toBe(before - 1)
    } else {
      state = play(state, { type: 'BID', bid: legalBids(null, total(state), state.mode)[0] })
    }
  }
  expect(state.phase).toBe('FINISHED')
  if (state.phase === 'FINISHED') {
    expect(state.players.filter(p => p.dice > 0).map(p => p.id)).toEqual([state.winnerId])
  }
})
