import assert from "node:assert/strict";
import {
  isDiceNotation as sharedIsDiceNotation,
  isWithinDiceLimits,
  parseDiceNotation,
  MAX_DICE_COUNT,
  MAX_DICE_SIDES,
} from "../../packages/shared/dist/index.js";
import { isDiceNotation, rollDice } from "../../packages/server/src/services/game/dice.service.js";
import { executeToolCalls } from "../../packages/server/src/services/tools/tool-executor.js";
import { parseGmTags } from "../../packages/client/src/lib/game-tag-parser.js";

// One NdM grammar, four readers. The engine used to carry four private regexes
// that disagreed about the most common notation a GM writes: the roll_dice tool
// refused a bare "d20" while /roll, the slash roller and the skill-check tag all
// accepted it. This pins the grammar in the shared module and then drives the
// same table through each call site's own entry point, so a site that grows its
// own regex again fails here rather than in a chat.

type ToolOutcome = "rolled" | "invalid" | "out-of-range";

interface NotationCase {
  notation: string;
  /** Does the shared grammar accept it at all? */
  grammar: boolean;
  /** What the roll_dice tool does with it (its bounds policy is refuse, not clamp). */
  tool: ToolOutcome;
  /** Rolls a GM would have reported for this notation, used to drive the tag parser. */
  tagRolls: number[];
  /** Does the skill-check tag accept it as a dice label? */
  tagLabel: boolean;
}

const CASES: NotationCase[] = [
  // Bare dN — legal everywhere. This row is the whole point of the change.
  { notation: "d20", grammar: true, tool: "rolled", tagRolls: [12], tagLabel: true },
  { notation: "d6", grammar: true, tool: "rolled", tagRolls: [4], tagLabel: true },
  { notation: "1d20", grammar: true, tool: "rolled", tagRolls: [12], tagLabel: true },
  { notation: "2d6", grammar: true, tool: "rolled", tagRolls: [3, 4], tagLabel: true },
  { notation: "2D6", grammar: true, tool: "rolled", tagRolls: [3, 4], tagLabel: true },
  { notation: " 2d6 ", grammar: true, tool: "rolled", tagRolls: [3, 4], tagLabel: true },
  { notation: "1d020", grammar: true, tool: "rolled", tagRolls: [12], tagLabel: true },
  { notation: "100d1000", grammar: true, tool: "rolled", tagRolls: Array.from({ length: 100 }, () => 7), tagLabel: true },
  // Modifiers are part of the grammar, but a dice *label* names dice only —
  // the modifier belongs in modifier=, so the tag refuses one.
  { notation: "2d6+3", grammar: true, tool: "rolled", tagRolls: [3, 4], tagLabel: false },
  { notation: "d20+5", grammar: true, tool: "rolled", tagRolls: [12], tagLabel: false },
  { notation: "4d8-1", grammar: true, tool: "rolled", tagRolls: [1, 2, 3, 4], tagLabel: false },
  // Grammatical, but past a caller's ceiling or floor. Each caller owns that
  // policy; the grammar does not.
  { notation: "101d20", grammar: true, tool: "out-of-range", tagRolls: [12], tagLabel: false },
  { notation: "500d6", grammar: true, tool: "out-of-range", tagRolls: [3], tagLabel: false },
  { notation: "1d1001", grammar: true, tool: "out-of-range", tagRolls: [12], tagLabel: false },
  // One-faced dice: refused by the tool (2-sided floor), accepted elsewhere.
  { notation: "1d1", grammar: true, tool: "out-of-range", tagRolls: [1], tagLabel: true },
  // Not dice notation.
  { notation: "0d20", grammar: false, tool: "invalid", tagRolls: [12], tagLabel: false },
  { notation: "1d0", grammar: false, tool: "invalid", tagRolls: [12], tagLabel: false },
  { notation: "d", grammar: false, tool: "invalid", tagRolls: [12], tagLabel: false },
  { notation: "20", grammar: false, tool: "invalid", tagRolls: [12], tagLabel: false },
  { notation: "2d", grammar: false, tool: "invalid", tagRolls: [3, 4], tagLabel: false },
  { notation: "2d6+", grammar: false, tool: "invalid", tagRolls: [3, 4], tagLabel: false },
  { notation: "2d6x3", grammar: false, tool: "invalid", tagRolls: [3, 4], tagLabel: false },
  { notation: "-1d6", grammar: false, tool: "invalid", tagRolls: [3], tagLabel: false },
  { notation: "1d20+3 extra", grammar: false, tool: "invalid", tagRolls: [12], tagLabel: false },
  // Too large to be an exact integer: refused rather than silently clamped.
  { notation: "99999999999999999999d6", grammar: false, tool: "invalid", tagRolls: [3], tagLabel: false },
];

// ── Entry 1: the shared grammar ──

for (const testCase of CASES) {
  const parsed = parseDiceNotation(testCase.notation);
  assert.equal(parsed !== null, testCase.grammar, `shared grammar disagrees on ${JSON.stringify(testCase.notation)}`);
  assert.equal(sharedIsDiceNotation(testCase.notation), testCase.grammar);
  if (parsed) {
    assert.equal(parsed.notation, testCase.notation.trim());
    assert.ok(parsed.count >= 1 && parsed.sides >= 1);
    assert.equal(parsed.dice, `${parsed.notation.split(/[+-]/)[0]}`.toLowerCase());
  }
}

// The grammar reports the pieces every caller needs, modifier included.
const withModifier = parseDiceNotation("2d6+3");
assert.ok(withModifier);
assert.deepEqual(
  { dice: withModifier.dice, count: withModifier.count, sides: withModifier.sides, modifier: withModifier.modifier },
  { dice: "2d6", count: 2, sides: 6, modifier: 3 },
);
const bare = parseDiceNotation("d20");
assert.ok(bare);
assert.deepEqual({ dice: bare.dice, count: bare.count, modifier: bare.modifier }, { dice: "d20", count: 1, modifier: 0 });

// ── Entry 2: the /roll service ──

for (const testCase of CASES) {
  // The route's zod refine and the grammar are the same predicate.
  assert.equal(isDiceNotation(testCase.notation), testCase.grammar);

  if (!testCase.grammar) {
    assert.throws(() => rollDice(testCase.notation), /Invalid dice notation/);
    continue;
  }

  const parsed = parseDiceNotation(testCase.notation)!;
  const rolled = rollDice(testCase.notation);
  const expectedCount = Math.min(parsed.count, MAX_DICE_COUNT);
  assert.equal(rolled.rolls.length, expectedCount, `wrong die count for ${testCase.notation}`);
  assert.equal(rolled.notation, testCase.notation.trim());
  assert.equal(rolled.modifier, parsed.modifier);
  assert.equal(
    rolled.total,
    rolled.rolls.reduce((sum, roll) => sum + roll, 0) + parsed.modifier,
  );
  for (const roll of rolled.rolls) {
    assert.ok(roll >= 1 && roll <= Math.min(parsed.sides, MAX_DICE_SIDES), `die out of range for ${testCase.notation}`);
  }
}

// This path clamps an oversized roll rather than refusing it, and always has.
// Pinned because the tool path deliberately does the opposite.
assert.equal(rollDice("500d6").rolls.length, MAX_DICE_COUNT);
assert.equal(rollDice("1d5000").rolls.length, 1);
assert.ok(!isWithinDiceLimits(parseDiceNotation("500d6")!));

// ── Entry 3: the roll_dice tool ──

async function rollThroughTool(notation: string): Promise<Record<string, unknown>> {
  const [result] = await executeToolCalls([
    { id: "call_1", type: "function", function: { name: "roll_dice", arguments: JSON.stringify({ notation }) } },
  ]);
  assert.ok(result);
  return JSON.parse(result.result) as Record<string, unknown>;
}

for (const testCase of CASES) {
  const result = await rollThroughTool(testCase.notation);

  if (testCase.tool === "invalid") {
    assert.match(String(result.error), /^Invalid dice notation/, `expected invalid: ${testCase.notation}`);
    assert.ok(typeof result.hint === "string" && result.hint.length > 0, "an invalid notation keeps its hint");
    continue;
  }

  if (testCase.tool === "out-of-range") {
    assert.match(String(result.error), /^Dice values out of range/, `expected out of range: ${testCase.notation}`);
    assert.equal(result.rolls, undefined, "a refused roll never reports dice it did not throw");
    continue;
  }

  const parsed = parseDiceNotation(testCase.notation)!;
  assert.equal(result.error, undefined, `expected a roll for ${testCase.notation}`);
  assert.equal(result.notation, testCase.notation.trim());
  assert.ok(Array.isArray(result.rolls));
  assert.equal((result.rolls as number[]).length, parsed.count);
  assert.equal(result.modifier, parsed.modifier);
  assert.equal(result.sum, (result.rolls as number[]).reduce((sum, roll) => sum + roll, 0));
  assert.equal(result.total, (result.sum as number) + parsed.modifier);
  assert.match(String(result.display), /^🎲 /);
}

// The tool's own shape is unchanged by the consolidation.
const toolReason = await rollThroughTool("2d6+3");
assert.equal(toolReason.reason, "");
const toolWithReason = await executeToolCalls([
  {
    id: "call_2",
    type: "function",
    function: { name: "roll_dice", arguments: JSON.stringify({ notation: "d20", reason: "Perception check" }) },
  },
]);
const parsedToolResult = JSON.parse(toolWithReason[0]!.result) as Record<string, unknown>;
assert.equal(parsedToolResult.reason, "Perception check");
assert.match(String(parsedToolResult.display), /^🎲 d20 \(Perception check\): \[\d+\] = \*\*\d+\*\*$/);
assert.equal(toolWithReason[0]!.success, true, "a bare d20 is a successful tool call, not an error result");

// ── Entry 4: the GM skill-check tag ──

function parseDiceLabel(notation: string, rolls: number[]) {
  const total = rolls.reduce((sum, roll) => sum + roll, 0);
  const dc = 10;
  const attributes = [
    'skill="Stealth"',
    `dc="${dc}"`,
    `rolls="${rolls.join("|")}"`,
    `used="${rolls[0]}"`,
    'modifier="0"',
    `total="${total}"`,
    `result="${total >= dc ? "success" : "failure"}"`,
    `dice="${notation}"`,
  ].join(" ");
  return parseGmTags(`[skill_check: ${attributes}]`).skillChecks[0];
}

for (const testCase of CASES) {
  const tag = parseDiceLabel(testCase.notation, testCase.tagRolls);
  assert.ok(tag, `the tag itself must still parse for ${testCase.notation}`);
  if (testCase.tagLabel) {
    assert.equal(
      tag.resolvedResult?.dice,
      testCase.notation.trim().toLowerCase(),
      `expected the tag to accept ${testCase.notation}`,
    );
  } else {
    assert.equal(tag.resolvedResult, undefined, `expected the tag to refuse ${testCase.notation}`);
  }
}

// The ceiling itself, not just a roll-count mismatch: a label whose dice all
// line up is still refused once it passes the shared limits.
assert.equal(
  parseDiceLabel(
    `${MAX_DICE_COUNT + 1}d20`,
    Array.from({ length: MAX_DICE_COUNT + 1 }, () => 7),
  )?.resolvedResult,
  undefined,
);
assert.equal(parseDiceLabel(`1d${MAX_DICE_SIDES + 1}`, [MAX_DICE_SIDES + 1])?.resolvedResult, undefined);
assert.ok(parseDiceLabel(`${MAX_DICE_COUNT}d20`, Array.from({ length: MAX_DICE_COUNT }, () => 7))?.resolvedResult);

// The same grammar reads a rolls="..." value that is notation rather than
// numbers, and keeps labelling it with the NdM half only.
function parseRollsNotation(rollsValue: string) {
  return parseGmTags(
    `[skill_check: skill="Stealth" dc="10" rolls="${rollsValue}" modifier="0" total="12" result="success"]`,
  ).skillChecks[0];
}
assert.equal(parseRollsNotation("d20")?.resolvedResult?.dice, "d20");
assert.equal(parseRollsNotation("1d20")?.resolvedResult?.dice, "1d20");
assert.equal(parseRollsNotation("1d20+3")?.resolvedResult?.dice, "1d20");
assert.equal(parseRollsNotation("1d100")?.resolvedResult, undefined, "only a d20 resolves without a dice label");
assert.equal(parseRollsNotation("0d20")?.resolvedResult, undefined);

process.stdout.write("Dice notation regression passed.\n");
