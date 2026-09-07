// ──────────────────────────────────────────────
// Dice Notation — the one NdM grammar
//
// The tool executor, the /roll service, the GM
// skill-check tag and the client slash roller all
// parse through this module (the {{roll}} macro and
// the dice card's display parser keep their own). Before it existed the tool executor,
// the /roll service, the GM skill-check tag and the
// client slash roller each carried their own regex,
// and they disagreed: bare "d20" was legal in three
// of them and an error in the fourth.
// ──────────────────────────────────────────────

import type { DiceRollResult } from "../types/game.js";

/**
 * NdM notation: an optional die count (bare `d20` means one die), a face count,
 * and an optional flat modifier. Case-insensitive.
 */
export const DICE_NOTATION_REGEX = /^(\d+)?d(\d+)([+-]\d+)?$/i;

/** Most dice one notation may throw. */
export const MAX_DICE_COUNT = 100;
/** Most faces a die may have. */
export const MAX_DICE_SIDES = 1000;

export interface ParsedDiceNotation {
  /** The notation as written, trimmed. */
  notation: string;
  /** The NdM half, lowercased and without the modifier — "d20", "2d6". */
  dice: string;
  /** Number of dice to throw (at least 1). */
  count: number;
  /** Faces per die (at least 1). */
  sides: number;
  /** Flat modifier; 0 when the notation carried none. */
  modifier: number;
}

/**
 * Parse NdM notation.
 *
 * Returns `null` when the text is not dice notation, when it asks for fewer
 * than one die or fewer than one face, or when a count, face or modifier value
 * is too large to be an exact integer.
 *
 * Ceilings past that are each caller's policy, not the grammar's: this module
 * does not decide whether `500d6` is refused or clamped, because the shipped
 * callers genuinely disagree — see `isWithinDiceLimits` and
 * `clampParsedDiceToLimits`.
 */
export function parseDiceNotation(value: string): ParsedDiceNotation | null {
  const notation = value.trim();
  const match = notation.match(DICE_NOTATION_REGEX);
  if (!match) return null;

  const countText = match[1];
  const sidesText = match[2]!;
  const count = Number.parseInt(countText ?? "1", 10);
  const sides = Number.parseInt(sidesText, 10);
  // The modifier is held to the same exactness bar as the count and the faces.
  // The regex puts no ceiling on its digits, so "1d6+<49 nines>" parses to an
  // imprecise float and a long enough one parses to Infinity — either way the
  // roll's total stops being a number anyone can trust, and a caller that hands
  // it to a model reports a wrong total rather than a rejected notation.
  const modifier = match[3] ? Number.parseInt(match[3], 10) : 0;
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(sides) || !Number.isSafeInteger(modifier)) return null;
  if (count < 1 || sides < 1) return null;

  return {
    notation,
    dice: `${countText ?? ""}d${sidesText}`.toLowerCase(),
    count,
    sides,
    modifier,
  };
}

/** Whether the text is dice notation this engine can roll. */
export function isDiceNotation(value: string): boolean {
  return parseDiceNotation(value) !== null;
}

/** Whether a parsed notation sits inside the shared count and face ceilings. */
export function isWithinDiceLimits(parsed: Pick<ParsedDiceNotation, "count" | "sides">): boolean {
  return parsed.count <= MAX_DICE_COUNT && parsed.sides <= MAX_DICE_SIDES;
}

/**
 * Trim an oversized notation down to the ceilings instead of refusing it.
 *
 * The clamping caller keeps the notation string the player typed, so a clamped
 * roll still reports what was asked for. Callers that must not lie to a model
 * about how many dice were thrown use `isWithinDiceLimits` and refuse instead.
 */
export function clampParsedDiceToLimits(parsed: ParsedDiceNotation): ParsedDiceNotation {
  return {
    ...parsed,
    count: Math.min(parsed.count, MAX_DICE_COUNT),
    sides: Math.min(parsed.sides, MAX_DICE_SIDES),
  };
}

/**
 * Throw the dice a parsed notation asks for.
 *
 * Unseeded `Math.random()`, exactly as each call site rolled before this module
 * existed — consolidating the grammar deliberately did not touch the RNG.
 */
export function rollParsedDice(parsed: ParsedDiceNotation): DiceRollResult {
  const rolls: number[] = [];
  for (let index = 0; index < parsed.count; index += 1) {
    rolls.push(Math.floor(Math.random() * parsed.sides) + 1);
  }
  return {
    notation: parsed.notation,
    rolls,
    modifier: parsed.modifier,
    total: rolls.reduce((sum, roll) => sum + roll, 0) + parsed.modifier,
  };
}
