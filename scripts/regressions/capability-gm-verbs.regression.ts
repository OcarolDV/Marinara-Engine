// Package-declared Game Master verbs (#5798) — the DECLARATION half.
//
// The two pinned constants in gm-verb-table.schema.ts are the only reason the guards mean
// anything, and both are copies of facts that live somewhere else. This regression re-derives
// each of them from its real source and fails when the copy falls behind:
//   - RESERVED_GM_TAG_NAMES vs every bracket tag the GM reminder can render and every tag the
//     client parser knows, so a new built-in tag cannot become shadowable by a package verb;
//   - ENGINE_OWNED_METADATA_KEY_PREFIXES vs every top-level ChatMetadata key and every
//     engine-owned *_METADATA_KEY constant, so a new engine namespace cannot become squattable.
// The derivations are asserted to have found something first: a broken extractor that yields an
// empty set would otherwise make both pins pass vacuously.
//
// The rest drives the schema itself — the effect/metadataKey split, the D1 key-ownership rules,
// the per-argument caps, and the per-verb degradation — plus the fact that PR1a is inert: nothing
// in the Engine imports this schema yet.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  camelCaseCapabilityPackageId,
  createGmVerbTableSchema,
  ENGINE_OWNED_METADATA_KEY_PREFIXES,
  GM_VERB_TABLE_ASSET_PATH,
  GM_VERB_TABLE_MAX_BYTES,
  gmVerbMetadataKeyIssue,
  gmVerbTableSchema,
  parseGmVerbTableWithCompat,
  RESERVED_GM_TAG_NAMES,
} from "../../packages/shared/src/schemas/gm-verb-table.schema.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Comments are stripped before every sweep below: a bracket tag inside a doc comment
 *  (`[some_tag: …]`, `"[tagPrefix:"`) is prose about the parser, not vocabulary it handles. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function sourceOf(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function walkSourceFiles(relativeDirectory: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(entryPath);
    }
  };
  walk(join(repositoryRoot, relativeDirectory));
  return files;
}

// ── Pin 1: reserved GM tag names ─────────────────────────────────────────────

// Source A — every `[name:` the GM format reminder can render, across all of its branches.
const reminderTags = new Set<string>();
for (const match of withoutComments(sourceOf("packages/server/src/services/game/gm-prompts.ts")).matchAll(
  /\[([A-Za-z_][A-Za-z0-9_]*)\s*:/g,
)) {
  reminderTags.add(match[1]!.toLowerCase());
}

// Source B — the client parser's whole vocabulary, which is wider than the reminder renders. Tag
// names appear there as `\[name` inside a regex literal or `"[name` inside a string literal.
const parserTags = new Set<string>();
for (const match of withoutComments(sourceOf("packages/client/src/lib/game-tag-parser.ts")).matchAll(
  /(?:\\\[|["'`]\[)([A-Za-z_][A-Za-z0-9_-]*)/g,
)) {
  parserTags.add(match[1]!.toLowerCase());
}

assert.ok(reminderTags.size >= 15, `the GM reminder sweep found only ${reminderTags.size} tags; the extractor broke`);
assert.ok(parserTags.size >= 20, `the tag-parser sweep found only ${parserTags.size} tags; the extractor broke`);
// Two names that must survive any refactor of the sweep: `reputation` only ever appears in the
// reminder, `element_attack` only in the client parser, so losing either proves a source dropped out.
assert.ok(reminderTags.has("reputation"), "the reminder sweep must still see [reputation:");
assert.ok(parserTags.has("element_attack"), "the parser sweep must still see [element_attack:");

const reserved = new Set<string>(RESERVED_GM_TAG_NAMES);
const unpinnedTags = [...new Set([...reminderTags, ...parserTags])].filter((tag) => !reserved.has(tag)).sort();
assert.deepEqual(unpinnedTags, [], `new built-in GM tags are not in RESERVED_GM_TAG_NAMES: ${unpinnedTags.join(", ")}`);
// Case-folding is the point of the pin: the reminder renders [Note:/[Book: capitalized while the
// shipped parse regex is case-insensitive.
assert.ok(reserved.has("note") && reserved.has("book"), "the journal tags are pinned case-folded");

// ── Pin 2: engine-owned metadata namespaces ──────────────────────────────────

/** Top-level members of `interface ChatMetadata`, by brace matching then two-space indentation —
 *  nested object types are indented deeper, so only the interface's own keys match. */
function chatMetadataKeys(): string[] {
  const source = sourceOf("packages/shared/src/types/chat.ts");
  const declaration = source.indexOf("export interface ChatMetadata {");
  assert.notEqual(declaration, -1, "interface ChatMetadata moved; the metadata-key sweep needs updating");
  const open = source.indexOf("{", declaration);
  let depth = 0;
  let close = -1;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  assert.notEqual(close, -1, "interface ChatMetadata is unbalanced; the metadata-key sweep needs updating");
  return [...source.slice(open + 1, close).matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm)].map(
    (match) => match[1]!,
  );
}

const engineMetadataKeys = new Set(chatMetadataKeys());
assert.ok(
  engineMetadataKeys.size >= 150,
  `the ChatMetadata sweep found only ${engineMetadataKeys.size} keys; the extractor broke`,
);
assert.ok(engineMetadataKeys.has("gameExperienceId") || engineMetadataKeys.has("gameSetupConfig"), "game keys survive");

// Engine-owned metadata keys that no interface declares — the write-ordinal mirror is the one that
// matters, because a package squatting `metadataWriteOrdinals` would corrupt write ordering.
for (const file of [...walkSourceFiles("packages/server/src"), ...walkSourceFiles("packages/shared/src")]) {
  for (const match of readFileSync(file, "utf8").matchAll(/\b([A-Z][A-Z0-9_]*_KEY)\s*=\s*"([a-zA-Z][a-zA-Z0-9]*)"/g)) {
    if (match[1]!.includes("METADATA")) engineMetadataKeys.add(match[2]!);
  }
}
assert.ok(engineMetadataKeys.has("metadataWriteOrdinals"), "METADATA_WRITE_ORDINALS_KEY is part of the sweep");

const ownedPrefixes = new Set<string>(ENGINE_OWNED_METADATA_KEY_PREFIXES);
const unpinnedPrefixes = [...new Set([...engineMetadataKeys].map((key) => /^[a-z]+/.exec(key)?.[0] ?? key))]
  .filter((prefix) => !ownedPrefixes.has(prefix))
  .sort();
assert.deepEqual(
  unpinnedPrefixes,
  [],
  `new engine metadata namespaces are not in ENGINE_OWNED_METADATA_KEY_PREFIXES: ${unpinnedPrefixes.join(", ")}`,
);
// The floor the decision named explicitly. `chat` and `persona` are engine namespaces no current
// top-level key starts with, so the sweep alone would never produce them.
for (const floor of ["game", "conversation", "chat", "lorebook", "character", "persona", "macro", "summary"]) {
  assert.ok(ownedPrefixes.has(floor), `"${floor}" must stay in the engine-owned denylist`);
}

// ── Key ownership (decision D1) ──────────────────────────────────────────────

assert.equal(camelCaseCapabilityPackageId("pixelforge"), "pixelforge");
assert.equal(camelCaseCapabilityPackageId("hierarchical-maps"), "hierarchicalMaps");
assert.equal(camelCaseCapabilityPackageId("rock-paper-scissors"), "rockPaperScissors");

assert.equal(gmVerbMetadataKeyIssue("pixelforge", "pixelforgeWeather"), null);
assert.match(gmVerbMetadataKeyIssue("pixelforge", "weather") ?? "", /must start with "pixelforge"/);
assert.match(gmVerbMetadataKeyIssue("pixelforge", "pixelforge") ?? "", /must add a name/);
// The uppercase boundary is what stops one package prefixing another's namespace: without it
// `pixelforge` could mint `pixelforgery…` and squat a `pixelforgery` package's keys.
assert.match(gmVerbMetadataKeyIssue("pixelforge", "pixelforgeweather") ?? "", /uppercase letter/);
assert.match(gmVerbMetadataKeyIssue("pixelforge", "pixelforge_weather") ?? "", /uppercase letter/);
// Denylist, exact match.
assert.match(gmVerbMetadataKeyIssue("game", "gameThing") ?? "", /engine-owned metadata namespace "game"/);
// Denylist, extension at an uppercase boundary. This one is live, not hypothetical: the shipped
// conversation-calls package normalizes to `conversationCalls`, and `conversationCalls` + `Enabled`
// is an existing ChatMetadata key.
assert.ok(engineMetadataKeys.has("conversationCallsEnabled"), "the collision this rule exists for is real");
assert.match(
  gmVerbMetadataKeyIssue("conversation-calls", "conversationCallsEnabled") ?? "",
  /engine-owned metadata namespace "conversationCalls"/,
);
// A lowercase continuation is NOT an extension: `gamepad` cannot collide with `game` + uppercase.
assert.equal(gmVerbMetadataKeyIssue("gamepad", "gamepadThing"), null);

// ── Constants ────────────────────────────────────────────────────────────────

assert.equal(GM_VERB_TABLE_ASSET_PATH, "gm-verbs.json");
assert.equal(GM_VERB_TABLE_MAX_BYTES, 64 * 1024);

// ── The two proving verbs ────────────────────────────────────────────────────

const weatherVerb = {
  name: "weather",
  description: "Set the sky when the weather visibly changes.",
  effect: "state",
  metadataKey: "pixelforgeWeather",
  args: [
    { name: "word", type: "string", enum: ["fair", "overcast", "rain", "storm", "snow"] },
    { name: "intensity", type: "string", enum: ["light", "heavy"], optional: true },
  ],
};
const standingVerb = {
  name: "standing",
  description: "Set where an NPC stands with the player after something changed it.",
  effect: "event",
  args: [
    { name: "npc", type: "string", maxLength: 40 },
    { name: "stance", type: "string", enum: ["none", "known", "friend", "close", "hostile"] },
    { name: "line", type: "string", maxLength: 80, optional: true },
  ],
};
const pixelforgeTable = { schemaVersion: 1, verbs: [weatherVerb, standingVerb] };

const pixelforgeSchema = createGmVerbTableSchema("pixelforge");
const proven = pixelforgeSchema.parse(pixelforgeTable);
assert.equal(proven.verbs.length, 2);
assert.equal(proven.verbs[0]?.effect, "state");
assert.equal(proven.verbs[0]?.metadataKey, "pixelforgeWeather");
assert.equal(proven.verbs[1]?.effect, "event");
assert.equal(proven.verbs[1]?.metadataKey, undefined);
// `optional` defaults rather than being required of every argument.
assert.equal(proven.verbs[0]?.args[0]?.optional, false);
assert.equal(proven.verbs[0]?.args[1]?.optional, true);
// The same table declared by a different package is refused: the key is not that package's to write.
assert.equal(createGmVerbTableSchema("chess").safeParse(pixelforgeTable).success, false);
// Without an owning package the shape still parses — key ownership is the package-aware layer.
assert.equal(gmVerbTableSchema.safeParse(pixelforgeTable).success, true);

// ── Shape guards ─────────────────────────────────────────────────────────────

function refusesVerb(verb: unknown, why: string): void {
  assert.equal(pixelforgeSchema.safeParse({ schemaVersion: 1, verbs: [verb] }).success, false, why);
}

refusesVerb({ ...weatherVerb, name: "reputation" }, "a reserved built-in tag name is refused");
refusesVerb({ ...weatherVerb, name: "note" }, "a reserved name is refused case-folded");
refusesVerb({ ...weatherVerb, name: "Weather" }, "an uppercase verb name is refused");
refusesVerb({ ...weatherVerb, name: "party-turn" }, "a hyphenated verb name is refused");
refusesVerb({ ...weatherVerb, description: "Line one.\nLine two." }, "a prompt line cannot break");
refusesVerb({ ...weatherVerb, description: "Emit [weather: …] here." }, "a prompt line cannot carry brackets");
refusesVerb({ ...weatherVerb, description: "" }, "a verb must describe itself");
refusesVerb({ ...weatherVerb, metadataKey: undefined }, "a state verb must name its metadata key");
refusesVerb({ ...standingVerb, metadataKey: "pixelforgeStanding" }, "an event verb must not squat a key");
refusesVerb({ ...weatherVerb, effect: "broadcast" }, "an unknown effect is refused");
refusesVerb({ ...weatherVerb, repeatable: true }, "an unknown verb key is refused");
refusesVerb(
  { ...weatherVerb, args: [{ name: "note", type: "string" }] },
  "an un-enum'd string argument must declare maxLength",
);
refusesVerb(
  { ...weatherVerb, args: [{ name: "turns", type: "number", maxLength: 10 }] },
  "maxLength is meaningless on a number argument",
);
refusesVerb(
  { ...weatherVerb, args: [{ name: "word", type: "number", enum: ["1"] }] },
  "only a string argument can declare an enum",
);
refusesVerb(
  { ...weatherVerb, args: [{ name: "word", type: "string", enum: ["fair"], maxLength: 10 }] },
  "an enum already bounds the value",
);
refusesVerb(
  {
    ...weatherVerb,
    args: [
      { name: "word", type: "string", maxLength: 10 },
      { name: "word", type: "string", maxLength: 10 },
    ],
  },
  "two arguments cannot share a name",
);
refusesVerb(
  {
    ...weatherVerb,
    args: Array.from({ length: 7 }, (_unused, index) => ({ name: `a${index}`, type: "string", maxLength: 8 })),
  },
  "at most six arguments",
);
refusesVerb({ ...weatherVerb, args: [{ name: "sky", type: "string", maxLength: 501 }] }, "maxLength is capped at 500");

assert.equal(pixelforgeSchema.safeParse({ schemaVersion: 2, verbs: [weatherVerb] }).success, false);
assert.equal(pixelforgeSchema.safeParse({ schemaVersion: 1, verbs: [] }).success, false);
assert.equal(
  pixelforgeSchema.safeParse({
    schemaVersion: 1,
    verbs: Array.from({ length: 17 }, (_unused, index) => ({ ...weatherVerb, name: `verb${index}` })),
  }).success,
  false,
  "at most sixteen verbs",
);
assert.equal(
  pixelforgeSchema.safeParse({ schemaVersion: 1, verbs: [weatherVerb, { ...weatherVerb, metadataKey: "pixelforgeB" }] })
    .success,
  false,
  "two verbs cannot share a name",
);
assert.equal(
  pixelforgeSchema.safeParse({
    schemaVersion: 1,
    verbs: [weatherVerb, { ...weatherVerb, name: "sky" }],
  }).success,
  false,
  "two verbs cannot write the same metadata key",
);
assert.equal(
  pixelforgeSchema.safeParse({ schemaVersion: 1, verbs: [weatherVerb], extra: true }).success,
  false,
  "an unknown top-level key is refused by the strict schema",
);

// ── Per-verb degradation ─────────────────────────────────────────────────────

// One verb this Engine cannot represent must not cost the package its whole vocabulary — the same
// per-entry rule the capability catalog already uses.
const degraded = parseGmVerbTableWithCompat(
  { schemaVersion: 1, verbs: [weatherVerb, { name: "teleport", effect: "quantum" }, standingVerb] },
  "pixelforge",
);
assert.deepEqual(
  degraded.table.verbs.map((verb) => verb.name),
  ["weather", "standing"],
);
assert.equal(degraded.droppedEntries, 1);
assert.deepEqual(degraded.droppedNames, ["teleport"]);

// A later duplicate is dropped rather than failing the table on this path.
const duplicated = parseGmVerbTableWithCompat(
  { schemaVersion: 1, verbs: [weatherVerb, { ...weatherVerb, description: "A second sky." }] },
  "pixelforge",
);
assert.equal(duplicated.table.verbs.length, 1);
assert.equal(duplicated.droppedEntries, 1);

// A verb whose key belongs to someone else is dropped, not silently written under.
const foreign = parseGmVerbTableWithCompat({ schemaVersion: 1, verbs: [weatherVerb] }, "chess");
assert.equal(foreign.table.verbs.length, 0);
assert.deepEqual(foreign.droppedNames, ["weather"]);

// An unusable envelope throws instead of degrading, so the caller logs it and serves an empty table.
assert.throws(() => parseGmVerbTableWithCompat({ schemaVersion: 2, verbs: [] }, "pixelforge"));
assert.throws(() => parseGmVerbTableWithCompat("not a table", "pixelforge"));
assert.throws(() => parseGmVerbTableWithCompat({ schemaVersion: 1 }, "pixelforge"));
// Unknown TOP-LEVEL fields are stripped rather than refused, so a table written for a newer Engine
// still yields the verbs this one understands.
assert.equal(
  parseGmVerbTableWithCompat({ schemaVersion: 1, verbs: [weatherVerb], future: 1 }, "pixelforge").table.verbs.length,
  1,
);

// ── PR1a is inert ────────────────────────────────────────────────────────────

// The runtime lands separately. Until it does, nothing in the Engine may import this schema —
// otherwise "no behavior change" stops being checkable by reading the diff.
const importers = [
  ...walkSourceFiles("packages/server/src"),
  ...walkSourceFiles("packages/shared/src"),
  ...walkSourceFiles("packages/client/src"),
].filter((file) => !file.endsWith("gm-verb-table.schema.ts") && readFileSync(file, "utf8").includes("gm-verb-table"));
assert.deepEqual(
  importers.map((file) => file.slice(repositoryRoot.length).replace(/\\/g, "/")),
  [],
  "the GM verb schema ships ahead of its runtime and must have no Engine importers yet",
);

console.info("Capability GM verb declaration regressions passed.");
