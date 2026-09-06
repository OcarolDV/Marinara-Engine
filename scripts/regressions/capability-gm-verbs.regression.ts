// Package-declared Game Master verbs (#5798) — the DECLARATION half.
//
// The two pinned constants in gm-verb-table.schema.ts are the only reason the guards mean
// anything, and both are copies of facts that live somewhere else. This regression re-derives
// each of them from its real source and fails when the copy falls behind:
//   - RESERVED_GM_TAG_NAMES vs every bracket tag the GM and party reminders can render AND every
//     tag the Engine's own narration parsers match back out of a turn, so a new built-in tag
//     cannot become shadowable by a package verb;
//   - ENGINE_OWNED_METADATA_KEY_PREFIXES vs every top-level ChatMetadata key, every engine-owned
//     *_METADATA_KEY constant, and every key that lives in the interface's index signature rather
//     than in its declaration, so a new engine namespace cannot become squattable.
// A pin re-derived from an extractor narrower than the vocabulary passes vacuously, so each
// extractor is asserted to have found something first — a size floor, plus one canary per source
// that no other source in the union can supply.
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

/** Comments and string literals both stripped. The metadata-write sweep matches braces and
 *  parentheses by hand, so a `{`, `}` or `(` inside a string would throw the balance off. */
function withoutCommentsOrStrings(source: string): string {
  return withoutComments(source).replace(/"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

function sourceOf(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

type SourceFile = { path: string; source: string };

/** Every TypeScript source under a package directory, read once — three sweeps below scan the
 *  same files. */
function readSourceFiles(relativeDirectory: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        files.push({ path: entryPath, source: readFileSync(entryPath, "utf8") });
      }
    }
  };
  walk(join(repositoryRoot, relativeDirectory));
  return files;
}

const serverSourceFiles = readSourceFiles("packages/server/src");
const sharedSourceFiles = readSourceFiles("packages/shared/src");
const clientSourceFiles = readSourceFiles("packages/client/src");

// ── Pin 1: reserved GM tag names ─────────────────────────────────────────────

const groupOpeners = /(?:\((?:\?[:!=])?)*/y;
const tagIdentifier = /[A-Za-z_][A-Za-z0-9_-]*/y;
const tagAlternation = /:?\|/y;

/** Every bracket-tag name a parser matches, walking the alternation groups the dialogue tokens
 *  live in: `\[(main|side|extra|action|thought|whisper(?::…)?)\]` names six tags, and a scan that
 *  only reads the identifier straight after `\[` finds none of them, because what follows the
 *  bracket there is a `(`. An opener is an escaped bracket inside a regex literal or a bracket at
 *  the head of a string literal. */
function bracketTagNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const opener of source.matchAll(/(?:\\\[|["'`]\[)/g)) {
    let index = (opener.index ?? 0) + opener[0].length;
    for (;;) {
      // Step over regex group openers, so `\[(?!Note:|Book:)` and `\[(main|…` both reach a name.
      groupOpeners.lastIndex = index;
      index = groupOpeners.exec(source) ? groupOpeners.lastIndex : index;
      tagIdentifier.lastIndex = index;
      const name = tagIdentifier.exec(source);
      if (!name) break;
      names.add(name[0].toLowerCase());
      tagAlternation.lastIndex = tagIdentifier.lastIndex;
      if (!tagAlternation.exec(source)) break;
      index = tagAlternation.lastIndex;
    }
  }
  return names;
}

// Source A — every `[name:` the GM format reminder and the party/VN reminder can render, across
// all of their branches. Prompt files are swept in colon form only: they carry example lines whose
// brackets hold arbitrary speaker names and expressions (`[Dottore] [main] [smirk]:`), so a
// bare-bracket sweep of one would pin half a cast list.
const reminderTags = new Set<string>();
for (const file of [
  "packages/server/src/services/game/gm-prompts.ts",
  "packages/server/src/services/game/party-prompts.ts",
]) {
  for (const match of withoutComments(sourceOf(file)).matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
    reminderTags.add(match[1]!.toLowerCase());
  }
}

// Source B — every bracket name the Engine parses back out of a finished turn: the client parser,
// whose vocabulary is wider than any reminder renders, and the server's segment editor. The
// dialogue tokens are pinned from here rather than from the reminder, because the reminder renders
// them inside an alternation (`[main|side|whisper:Target|thought]`) that a `[name:` sweep cannot
// see — and a shadowed name does its damage where the Engine parses it, not where it prints it.
// The segment editor yields no name the client parser does not already yield today; it is swept so
// a server-only dialogue token cannot arrive without this pin noticing.
const parserTags = new Set<string>();
for (const file of [
  "packages/client/src/lib/game-tag-parser.ts",
  "packages/server/src/services/game/segment-edits.ts",
]) {
  for (const name of bracketTagNames(withoutComments(sourceOf(file)))) parserTags.add(name);
}

assert.ok(reminderTags.size >= 15, `the GM reminder sweep found only ${reminderTags.size} tags; the extractor broke`);
assert.ok(parserTags.size >= 25, `the tag-parser sweep found only ${parserTags.size} tags; the extractor broke`);
// Canaries no other source in the union can supply, so losing one proves a source dropped out:
// `reputation` only ever appears in the GM reminder, `whisper` in colon form only in the party
// reminder, `element_attack` only in the client parser, and `main`/`whisper` only inside a regex
// alternation, which is what the narrow sweep this pin used to run could not read.
assert.ok(reminderTags.has("reputation"), "the reminder sweep must still see [reputation:");
assert.ok(reminderTags.has("whisper"), "the party-prompts reminder must still be part of the sweep");
assert.ok(parserTags.has("element_attack"), "the parser sweep must still see [element_attack:");
assert.ok(
  parserTags.has("main") && parserTags.has("whisper"),
  "the alternation walk must still see the dialogue tokens",
);
// The walk's own behavior, on a synthetic source: a lookahead group, a plain group carrying an
// alternation, a string-literal bracket, and a `\w+` bracket that names nothing. The lookahead
// branch needs pinning here because no shipped parser depends on it alone — `Note` and `Book` also
// appear as plain string literals — so a regression in that branch would otherwise be invisible.
assert.deepEqual(
  [...bracketTagNames(String.raw`/\[(?!Note:|Book:)\w+:/ /\[(one|two(?::x)?)\]/ "[three:" /\[\w+:/`)].sort(),
  ["book", "note", "one", "three", "two"],
);

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
for (const file of [...serverSourceFiles, ...sharedSourceFiles]) {
  for (const match of file.source.matchAll(/\b([A-Z][A-Z0-9_]*_KEY)\s*=\s*"([a-zA-Z][a-zA-Z0-9]*)"/g)) {
    if (match[1]!.includes("METADATA")) engineMetadataKeys.add(match[2]!);
  }
}
assert.ok(engineMetadataKeys.has("metadataWriteOrdinals"), "METADATA_WRITE_ORDINALS_KEY is part of the sweep");

/** Every top-level key of the object literal a `patchMetadata`/`updateMetadata` call writes. The
 *  literal is walked rather than regex-matched because a multi-key patch has to surface all of its
 *  keys, and a key is read only at a property position so a ternary's `null :` inside a value is
 *  not mistaken for one. */
function metadataWriteKeys(source: string): string[] {
  const keys: string[] = [];
  for (const call of source.matchAll(/\b(?:patchMetadata|updateMetadata)\s*\([^,(){}]*,\s*\{/g)) {
    let depth = 0;
    let atProperty = false;
    for (let index = (call.index ?? 0) + call[0].length - 1; index < source.length; index += 1) {
      const character = source[index]!;
      if (character === "{") {
        depth += 1;
        atProperty = depth === 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) break;
      } else if (depth === 1 && character === ",") {
        atProperty = true;
      } else if (atProperty && !/\s/.test(character)) {
        // The first real character of a property position. A spread or a computed key matches
        // nothing here and simply closes the position, which is what keeps values out.
        const key = /^([a-z][a-zA-Z0-9]*)\s*:/.exec(source.slice(index));
        if (key) keys.push(key[1]!);
        atProperty = false;
      }
    }
  }
  return keys;
}

// Source 3 — the keys that live in `ChatMetadata`'s `[key: string]: unknown` index signature
// rather than in its declaration. Much of the Engine's own chat metadata is written and read that
// way with no declaration anywhere (`encounterActive`, `internalAssistant`, `professorMariActive`,
// `imageGenConnectionId`, `authorNotes`), and the two sources above are structurally blind to all
// of it — a pin derived from them alone passes while the guard is incomplete, which is exactly the
// failure this file exists to prevent. A package that squatted one of those namespaces could have
// a state verb overwrite the Engine's own key from model output.
for (const file of [...serverSourceFiles, ...sharedSourceFiles, ...clientSourceFiles]) {
  const source = withoutCommentsOrStrings(file.source);
  for (const key of metadataWriteKeys(source)) engineMetadataKeys.add(key);
  for (const pattern of [
    /\bchatMeta(?:data)?\??\.\s*([a-z][a-zA-Z0-9]*)/g,
    /\bchat\??\.metadata\??\.\s*([a-z][a-zA-Z0-9]*)/g,
  ]) {
    for (const match of source.matchAll(pattern)) engineMetadataKeys.add(match[1]!);
  }
}
// One canary per half of source 3, each unreachable from any other source in the union:
// `professorMariActive` is only ever seen as a written literal (its reads go through a local
// `metadata` binding), and `imageGenConnectionId` is only ever seen as a read (it is written
// through the generic chat-settings path). `encounterActive` is the key whose namespace a package
// called `encounter` would otherwise have been free to claim.
assert.ok(engineMetadataKeys.has("professorMariActive"), "the patchMetadata literal walk is part of the sweep");
assert.ok(engineMetadataKeys.has("imageGenConnectionId"), "the chat-metadata property-read sweep is part of the sweep");
assert.ok(engineMetadataKeys.has("encounterActive"), "the undeclared combat flag is part of the sweep");

const ownedPrefixes = new Set<string>(ENGINE_OWNED_METADATA_KEY_PREFIXES);
const unpinnedPrefixes = [...new Set([...engineMetadataKeys].map((key) => /^[a-z]+/.exec(key)?.[0] ?? key))]
  .filter((prefix) => !ownedPrefixes.has(prefix))
  .sort();
assert.deepEqual(
  unpinnedPrefixes,
  [],
  `new engine metadata namespaces are not in ENGINE_OWNED_METADATA_KEY_PREFIXES: ${unpinnedPrefixes.join(", ")}`,
);
// The floor the decision named explicitly. `persona` is the only one of them the three sweeps
// cannot produce on their own, so it is the one entry that is genuinely hand-maintained.
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
// Denylist, exact match on a namespace only the index-signature sweep can find: the shipped
// `background` package normalizes to `background`, which is an Engine chat-metadata key itself.
assert.ok(engineMetadataKeys.has("background"), "the undeclared key behind the `background` refusal is real");
assert.match(
  gmVerbMetadataKeyIssue("background", "backgroundSky") ?? "",
  /engine-owned metadata namespace "background"/,
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
// The dialogue tokens are reserved like any other built-in: a `whisper` verb would have
// `[whisper:Tam]` stripped out of a saved dialogue line, which then stops parsing as dialogue.
refusesVerb({ ...weatherVerb, name: "whisper" }, "a dialogue-format token is refused");
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
// Every verb in the over-cap table needs its own name AND its own metadataKey: seventeen copies of
// one key are refused by the duplicate-key rule whatever the cap is, which would pass the assertion
// for a reason it does not intend and leave the cap itself unpinned. The sixteen-verb table proves
// the refusal below is the cap and nothing else.
const sixteenVerbs = Array.from({ length: 16 }, (_unused, index) => ({
  ...weatherVerb,
  name: `verb${index}`,
  metadataKey: `pixelforgeKey${index}`,
}));
const seventeenVerbs = [...sixteenVerbs, { ...weatherVerb, name: "verb16", metadataKey: "pixelforgeKey16" }];
assert.equal(
  pixelforgeSchema.safeParse({ schemaVersion: 1, verbs: sixteenVerbs }).success,
  true,
  "sixteen verbs are allowed",
);
assert.equal(
  pixelforgeSchema.safeParse({ schemaVersion: 1, verbs: seventeenVerbs }).success,
  false,
  "at most sixteen verbs",
);
// All three copies of the cap carry it: the package-aware schema, the package-blind document
// schema, and the envelope the tolerant parse checks before it looks at a single verb.
assert.equal(gmVerbTableSchema.safeParse({ schemaVersion: 1, verbs: seventeenVerbs }).success, false);
assert.throws(() => parseGmVerbTableWithCompat({ schemaVersion: 1, verbs: seventeenVerbs }, "pixelforge"));
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

// A verb whose key belongs to someone else is dropped, not silently written under — and when it is
// the only verb, the parse returns an EMPTY table. That is why the result is typed
// `ParsedGmVerbTable` rather than `GmVerbTable`: the schema's one-verb minimum does not survive a
// path whose whole job is dropping entries, and a caller must check the length.
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
const importers = [...serverSourceFiles, ...sharedSourceFiles, ...clientSourceFiles].filter(
  (file) => !file.path.endsWith("gm-verb-table.schema.ts") && file.source.includes("gm-verb-table"),
);
assert.deepEqual(
  importers.map((file) => file.path.slice(repositoryRoot.length).replace(/\\/g, "/")),
  [],
  "the GM verb schema ships ahead of its runtime and must have no Engine importers yet",
);

console.info("Capability GM verb declaration regressions passed.");
