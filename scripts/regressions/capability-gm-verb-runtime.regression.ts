// Package-declared Game Master verbs (#5798) — the RUNTIME half.
//
// The declaration half is pinned by `capability-gm-verbs.regression.ts`. This one drives the parts
// that can actually change a chat: the gated read of a package's verb table off disk, the narration
// scan, and the executor. Everything below runs against a REAL installed-package registry in a
// temporary DATA_DIR and a REAL chats store, because the three claims worth pinning are all claims
// about persisted state:
//
//   1. A state verb's write is ABSOLUTE and lands through `patchMetadata` — the key's whole value is
//      replaced, the write ordinal is stamped, `updatedAt` is not touched, and applying the same
//      verb twice moves nothing. That absoluteness, not the claim record, is the entire reason a
//      duplicate dispatch is harmless.
//   2. An event verb emits exactly one `gm_verb` frame carrying an explicit packageId and the
//      chatId:messageId:swipeIndex triple, and leaves nothing behind.
//   3. Every refusal tier — no table, no permission, oversized, tampered, malformed, not ready,
//      wrong owner — yields no verbs and never throws, because none of them may cost a player a turn.
//
// Plus the two coherence pins that no single-function test can make: the prompt render and the
// narration parse agree on every verb (a verb advertised but unmatchable leaks a raw bracket tag
// into the player's prose), and both client SSE switches handle the events the server emits.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = mkdtempSync(join(tmpdir(), "marinara-gm-verb-runtime-"));
const previousDataDir = process.env.DATA_DIR;
const previousFileStorageDir = process.env.FILE_STORAGE_DIR;
const previousMarinaraFileStorageDir = process.env.MARINARA_FILE_STORAGE_DIR;

const fileStorageDir = join(dataDir, "file-storage");
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = fileStorageDir;
process.env.MARINARA_FILE_STORAGE_DIR = fileStorageDir;

const packagesRoot = join(dataDir, "capability-packages");
const registryPath = join(packagesRoot, "installed.json");

const PACKAGE_ID = "pixelforge";
const OTHER_PACKAGE_ID = "chess";
const TABLE_PATH = "gm-verbs.json";
const OTHER_ASSET_PATH = "tilemap.json";

/** The two proving verbs: one of each effect, shaped exactly as the plan's first declarations. */
const verbTable = {
  schemaVersion: 1,
  verbs: [
    {
      name: "weather",
      description: "Set the world's weather when the sky visibly changes.",
      effect: "state",
      metadataKey: "pixelforgeWeather",
      args: [
        { name: "word", type: "string", enum: ["fair", "overcast", "rain", "storm", "snow"] },
        { name: "intensity", type: "string", enum: ["light", "heavy"], optional: true },
      ],
    },
    {
      name: "standing",
      description: "Record how an NPC now regards the player.",
      effect: "event",
      args: [
        { name: "npc", type: "string", maxLength: 40 },
        { name: "stance", type: "string", enum: ["none", "known", "friend", "close", "hostile"] },
        { name: "line", type: "string", maxLength: 80, optional: true },
      ],
    },
  ],
};

type ManifestOverrides = {
  packageId?: string;
  permissions?: string[];
  assetPaths?: string[];
  declaredBytes?: number;
  status?: string;
  tableJson?: string;
};

/** Install one fixture package, hash-pinned the way a real install leaves it on disk. */
function installFixture(overrides: ManifestOverrides = {}) {
  const packageId = overrides.packageId ?? PACKAGE_ID;
  const version = "1.0.0";
  const versionRoot = join(packagesRoot, "versions", packageId, version);
  mkdirSync(versionRoot, { recursive: true });
  const tableJson = overrides.tableJson ?? JSON.stringify(verbTable);
  writeFileSync(join(versionRoot, TABLE_PATH), tableJson);
  writeFileSync(join(versionRoot, "client.js"), "x");
  // An unrelated JSON asset, so the "declares assets but not a verb table" case can be built out of
  // a manifest that is otherwise completely valid.
  writeFileSync(join(versionRoot, OTHER_ASSET_PATH), "{}");
  const tableBytes = Buffer.byteLength(tableJson);
  const manifest = {
    // `contributions.assets` — the delivery surface a verb table rides on — needs schemaVersion 2
    // and capabilityApi 1.10, so the fixture is shaped the way any package shipping one must be.
    schemaVersion: 2,
    capabilityApi: { major: 1, minor: 10 },
    builtAgainst: { engineVersion: "2.4.5", engineCommit: "0".repeat(40) },
    id: packageId,
    name: packageId,
    version,
    description: "GM verb runtime regression fixture.",
    engine: { min: "2.3.0", maxExclusive: "3.0.0" },
    kind: ["turn-game"],
    entrypoints: { client: "client.js" },
    contributions: { assets: { paths: overrides.assetPaths ?? [TABLE_PATH] } },
    files: [
      { path: TABLE_PATH, sha256: createHash("sha256").update(tableJson).digest("hex"), bytes: tableBytes },
      { path: "client.js", sha256: createHash("sha256").update("x").digest("hex"), bytes: 1 },
      { path: OTHER_ASSET_PATH, sha256: createHash("sha256").update("{}").digest("hex"), bytes: 2 },
    ],
    permissions: overrides.permissions ?? ["chat-write"],
    restartRequired: false,
  };
  // The byte ceiling is checked against what the MANIFEST declares, so the two are separable on
  // purpose: an inflated declaration must refuse a file that is perfectly readable.
  if (overrides.declaredBytes !== undefined) manifest.files[0]!.bytes = overrides.declaredBytes;
  mkdirSync(packagesRoot, { recursive: true });
  writeFileSync(
    registryPath,
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        {
          id: packageId,
          version,
          manifest,
          installedAt: "2026-09-06T00:00:00.000Z",
          status: overrides.status ?? "active",
          error: null,
          legacy: false,
        },
      ],
    }),
  );
  return { versionRoot, tableJson };
}

installFixture();

const [
  { capabilityPackageManager },
  gmVerbRuntime,
  { createChatsStorage },
  { getDB, closeDB },
  { supportedCapabilityApi },
] = await Promise.all([
  import("../../packages/server/src/services/capability-packages/package-manager.service.js"),
  import("../../packages/server/src/services/capability-packages/capability-gm-verb-runtime.service.js"),
  import("../../packages/server/src/services/storage/chats.storage.js"),
  import("../../packages/server/src/db/connection.js"),
  import("../../packages/shared/src/schemas/capability-package.schema.js"),
]);

const {
  applyGmVerbWrite,
  claimGmVerb,
  executeGmVerbCalls,
  parseAndStripGmVerbCalls,
  renderGmVerbInstructions,
  resolveGmVerbTable,
  validateGmVerbArgs,
} = gmVerbRuntime;

type ResolvedTable = NonNullable<Awaited<ReturnType<typeof resolveGmVerbTable>>>;

/** A FastifyReply stand-in that records the frames the real `sendSseEvent` writes to it. The real
 *  serializer runs — only the socket is fake — so the envelope shape asserted below is the shape a
 *  browser would receive. */
function createReplyDouble(options: { writable?: boolean } = {}) {
  const frames: Array<{ type: string; data: Record<string, unknown> }> = [];
  const raw = {
    destroyed: options.writable === false,
    writableEnded: false,
    writableFinished: false,
    write(chunk: string) {
      const payload = chunk.replace(/^data: /, "").trim();
      frames.push(JSON.parse(payload));
      return true;
    },
  };
  return { reply: { raw } as never, frames };
}

const db = await getDB();
const chats = createChatsStorage(db);
const createdChatIds: string[] = [];

async function createGameChat() {
  const chat = await chats.create({ name: "GM verb runtime", mode: "game", characterIds: [] } as Parameters<
    typeof chats.create
  >[0]);
  assert.ok(chat);
  createdChatIds.push(chat.id);
  await chats.patchMetadata(chat.id, { gameExperienceId: PACKAGE_ID });
  return chat.id;
}

async function readMetadata(chatId: string): Promise<Record<string, unknown>> {
  const row = await chats.getById(chatId);
  assert.ok(row);
  return JSON.parse((row.metadata as string) ?? "{}");
}

try {
  // ── The gated read, tier by tier ───────────────────────────────────────────

  const table = await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID });
  assert.ok(table, "a ready package declaring a hash-pinned table with chat-write resolves its verbs");
  assert.equal(table.packageId, PACKAGE_ID);
  assert.deepEqual(
    table.verbs.map((verb) => verb.name),
    ["weather", "standing"],
  );

  // A chat with no Experience package never reaches the package manager at all.
  assert.equal(await resolveGmVerbTable({}), null);
  assert.equal(await resolveGmVerbTable({ gameExperienceId: 42 }), null);
  assert.equal(await resolveGmVerbTable({ gameExperienceId: "not-installed" }), null);

  // Shipped in files[] but never declared as an asset: silent in both directions everywhere else in
  // the pipeline, and no verbs here.
  installFixture({ assetPaths: [OTHER_ASSET_PATH] });
  assert.equal(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }), null);

  // The permission gate. This is the first place a declared capability permission is enforced
  // anywhere in the Engine, so its refusal is worth pinning rather than assuming.
  installFixture({ permissions: ["ui"] });
  assert.equal(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }), null);

  // The byte ceiling keys on the DECLARED size, before any read: the same on-disk file is refused
  // when the manifest inflates it past the ceiling and accepted when the manifest tells the truth.
  installFixture({ declaredBytes: 64 * 1024 + 1 });
  assert.equal(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }), null);
  installFixture();
  assert.ok(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }));

  // Tampering: the bytes on disk are no longer the bytes that were installed. Loud in the log, and
  // no verbs — but still not an exception, because the turn survives every tier.
  const { versionRoot } = installFixture();
  writeFileSync(join(versionRoot, TABLE_PATH), JSON.stringify({ ...verbTable, schemaVersion: 1, tampered: true }));
  assert.equal(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }), null);

  // Malformed content that IS the installed content: a hash-valid file that is not JSON.
  installFixture({ tableJson: "{ not json" });
  assert.equal(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }), null);

  // An update that needs a restart stops the verbs until one — readiness, not servability, so the
  // previous version's vocabulary is never served to a running Engine that no longer matches it.
  installFixture({ status: "restart-required" });
  assert.equal(await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID }), null);

  // Key ownership is checked against the INSTALLING package at runtime, not against whoever authored
  // the JSON. The identical bytes that give Pixelforge two verbs give a package that does not own
  // `pixelforgeWeather` only the verb that writes nothing.
  installFixture({ packageId: OTHER_PACKAGE_ID });
  const foreign = await resolveGmVerbTable({ gameExperienceId: OTHER_PACKAGE_ID });
  assert.ok(foreign);
  assert.deepEqual(
    foreign.verbs.map((verb) => verb.name),
    ["standing"],
    "a state verb whose metadataKey belongs to another package is refused at runtime",
  );

  // A table of nothing but refusable verbs resolves as no table at all rather than as an empty one.
  installFixture({
    packageId: OTHER_PACKAGE_ID,
    tableJson: JSON.stringify({ schemaVersion: 1, verbs: [verbTable.verbs[0]] }),
  });
  assert.equal(await resolveGmVerbTable({ gameExperienceId: OTHER_PACKAGE_ID }), null);

  // A reserved built-in tag name can never become a package verb. `state` is the sharpest: it drives
  // the combat transition, so a package verb by that name would have the engine's own tag stripped.
  installFixture({
    tableJson: JSON.stringify({
      schemaVersion: 1,
      verbs: [{ ...verbTable.verbs[0], name: "state" }, verbTable.verbs[1]],
    }),
  });
  const reservedFiltered = await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID });
  assert.ok(reservedFiltered);
  assert.deepEqual(
    reservedFiltered.verbs.map((verb) => verb.name),
    ["standing"],
    "a reserved tag name is refused and the rest of the table still runs",
  );

  installFixture();
  const live = (await resolveGmVerbTable({ gameExperienceId: PACKAGE_ID })) as ResolvedTable;
  assert.ok(live);
  const weatherVerb = live.verbs.find((verb) => verb.name === "weather")!;
  const standingVerb = live.verbs.find((verb) => verb.name === "standing")!;

  // ── The prompt render and the parse agree ──────────────────────────────────

  const instructions = renderGmVerbInstructions(live);
  assert.equal(instructions.length, 2);
  assert.match(instructions[0]!, /^- \[weather:\{"word":"fair"\}\] — /);
  assert.match(instructions[1]!, /^- \[standing:\{"npc":"<npc>","stance":"none"\}\] — /);

  // D9, the pin that matters most: every example the reminder shows the GM must parse back out as a
  // real call. A verb advertised but unmatchable would be emitted and left in the saved prose.
  for (const line of instructions) {
    const example = line.match(/^- (\[[^\]]*\}\])/)?.[1];
    assert.ok(example, `a rendered verb line must carry a copyable example: ${line}`);
    const round = parseAndStripGmVerbCalls(`The scene shifts. ${example}`, live);
    assert.equal(round.calls.length, 1, `the reminder's own example must parse: ${example}`);
    assert.equal(round.content.trim(), "The scene shifts.");
  }

  // ── Narration scan ─────────────────────────────────────────────────────────

  const clean = parseAndStripGmVerbCalls('Rain sheets down. [weather:{"word":"storm","intensity":"heavy"}]', live);
  assert.equal(clean.matched, true);
  assert.equal(clean.content.trim(), "Rain sheets down.");
  assert.deepEqual(clean.calls.map((call) => call.args), [{ word: "storm", intensity: "heavy" }]);

  // A tag is stripped on the NAME match, never on validation success — a command the model got
  // slightly wrong is still a command, and leaving it in shows the player machinery.
  for (const bad of [
    '[weather:{"word":"apocalypse"}]', // out of enum
    "[weather:{not json}]", // unparseable payload
    '[weather:{"word":"fair","unknown":1}]', // undeclared argument
    "[weather:{}]", // missing a required argument
    '[weather:{"word":3}]', // wrong type
    '[standing:{"npc":"Mira","stance":"friend","line":"' + "x".repeat(81) + '"}]', // over maxLength
  ]) {
    const refused = parseAndStripGmVerbCalls(`Before. ${bad} After.`, live);
    assert.equal(refused.calls.length, 0, `must refuse ${bad}`);
    assert.equal(refused.matched, true);
    assert.equal(refused.content.replace(/\s+/g, " ").trim(), "Before. After.", `must still strip ${bad}`);
  }

  // A tag this chat's package does not declare is left exactly as written — it may belong to another
  // parser, or be ordinary prose in brackets.
  const untouched = '[inventory: action="add" item="Rope"] and [state: combat]';
  assert.equal(parseAndStripGmVerbCalls(untouched, live).content, untouched);
  assert.equal(parseAndStripGmVerbCalls(untouched, live).matched, false);

  // One call per verb name per message. Both tags go, one call survives — a real ceiling, not a
  // formality: a repeated event verb is meaningful prose this cut collapses.
  const repeated = parseAndStripGmVerbCalls('[weather:{"word":"rain"}] then [weather:{"word":"fair"}]', live);
  assert.equal(repeated.calls.length, 1);
  assert.deepEqual(repeated.calls[0]!.args, { word: "rain" });
  assert.equal(repeated.content.trim(), "then");

  // An optional argument may simply be absent; it is never defaulted into the payload.
  assert.deepEqual(validateGmVerbArgs(weatherVerb, '{"word":"snow"}'), { ok: true, args: { word: "snow" } });
  // A number argument is rejected rather than coerced from its string spelling.
  assert.equal(validateGmVerbArgs(standingVerb, '{"npc":"Mira","stance":"friend"}').ok, true);
  assert.equal(validateGmVerbArgs(standingVerb, '{"npc":5,"stance":"friend"}').ok, false);
  assert.equal(validateGmVerbArgs(standingVerb, "[]").ok, false);

  // ── The executor, against a real chat row ──────────────────────────────────

  const chatId = await createGameChat();
  const message = await chats.createMessage({ chatId, role: "assistant", content: "The sky turns." });
  assert.ok(message?.id);
  const turn = { chatId, messageId: message.id, swipeIndex: 0 };

  const before = await chats.getById(chatId);
  assert.ok(before);
  const updatedAtBefore = before.updatedAt;

  const stateReply = createReplyDouble();
  await executeGmVerbCalls({
    calls: [{ verb: weatherVerb, args: { word: "storm" } }],
    table: live,
    turn,
    store: chats,
    reply: stateReply.reply,
  });

  const afterWrite = await readMetadata(chatId);
  assert.deepEqual(afterWrite.pixelforgeWeather, { word: "storm" }, "a state verb writes its args wholesale");
  const ordinals = afterWrite.metadataWriteOrdinals as Record<string, number>;
  assert.ok(typeof ordinals?.pixelforgeWeather === "number", "the write draws from the chat's write ordinal");
  const firstOrdinal = ordinals.pixelforgeWeather;
  // A GM verb is not the player touching the chat; bumping the row would reorder the chat list.
  assert.equal((await chats.getById(chatId))!.updatedAt, updatedAtBefore, "a verb write must not touch updatedAt");
  // A state verb emits nothing itself — props re-delivery after the route's metadata_patch is the
  // whole delivery mechanism.
  assert.deepEqual(stateReply.frames, []);

  // Provenance: a truthy OBJECT, or the storage guard treats the slot as unclaimed forever.
  const claimedSwipes = await chats.getSwipes(message.id);
  const claim = JSON.parse((claimedSwipes.find((swipe: { index: number }) => swipe.index === 0)!.extra as string) ?? "{}");
  assert.equal(typeof claim["gmVerb:weather"], "object");
  assert.equal(claim["gmVerb:weather"].verb, "weather");
  assert.deepEqual(claim["gmVerb:weather"].args, { word: "storm" });

  // THE safety property. The same verb applied again replaces the same value, so nothing accumulates
  // and the ordinal does not move — this, not the claim, is why a duplicate dispatch is harmless.
  await executeGmVerbCalls({
    calls: [{ verb: weatherVerb, args: { word: "storm" } }],
    table: live,
    turn,
    store: chats,
    reply: createReplyDouble().reply,
  });
  const afterDuplicate = await readMetadata(chatId);
  assert.deepEqual(afterDuplicate.pixelforgeWeather, { word: "storm" });
  assert.equal((afterDuplicate.metadataWriteOrdinals as Record<string, number>).pixelforgeWeather, firstOrdinal);

  // A second, different apply replaces the whole value rather than merging into it, so a payload can
  // never accumulate stale keys from an earlier turn.
  await executeGmVerbCalls({
    calls: [{ verb: weatherVerb, args: { word: "fair", intensity: "light" } }],
    table: live,
    turn,
    store: chats,
    reply: createReplyDouble().reply,
  });
  assert.deepEqual((await readMetadata(chatId)).pixelforgeWeather, { word: "fair", intensity: "light" });

  // ── The event half ─────────────────────────────────────────────────────────

  const eventReply = createReplyDouble();
  await executeGmVerbCalls({
    calls: [{ verb: standingVerb, args: { npc: "Mira", stance: "hostile" } }],
    table: live,
    turn,
    store: chats,
    reply: eventReply.reply,
  });
  assert.equal(eventReply.frames.length, 1, "one validated event verb emits exactly one frame");
  assert.deepEqual(eventReply.frames[0], {
    type: "gm_verb",
    data: {
      packageId: PACKAGE_ID,
      verb: "standing",
      args: { npc: "Mira", stance: "hostile" },
      chatId,
      messageId: message.id,
      swipeIndex: 0,
    },
  });
  // The package is addressed explicitly on the envelope rather than through a convention field
  // inside the payload, which is the one thing this channel improves on the turn-game bridge.
  assert.equal(eventReply.frames[0]!.data.packageId, PACKAGE_ID);
  // Nothing durable: the event verb wrote no metadata key of its own.
  assert.equal("standing" in (await readMetadata(chatId)), false);

  // A stream the client has already dropped: no frame, no throw, and the claim still records that
  // the Engine executed the verb — which is true whether or not anyone heard it.
  const deadReply = createReplyDouble({ writable: false });
  const deadMessage = await chats.createMessage({ chatId, role: "assistant", content: "Lost turn." });
  await executeGmVerbCalls({
    calls: [{ verb: standingVerb, args: { npc: "Tam", stance: "friend" } }],
    table: live,
    turn: { chatId, messageId: deadMessage!.id, swipeIndex: 0 },
    store: chats,
    reply: deadReply.reply,
  });
  assert.deepEqual(deadReply.frames, [], "an unwritable reply delivers nothing");

  // ── Isolation, and the paths with no message to claim against ──────────────

  // One verb's failure never costs another verb its effect.
  const mixedReply = createReplyDouble();
  const throwingStore = {
    ...chats,
    patchMetadata: async () => {
      throw new Error("storage is down");
    },
  } as unknown as typeof chats;
  await executeGmVerbCalls({
    calls: [
      { verb: weatherVerb, args: { word: "snow" } },
      { verb: standingVerb, args: { npc: "Mira", stance: "known" } },
    ],
    table: live,
    turn,
    store: throwingStore,
    reply: mixedReply.reply,
  });
  assert.equal(mixedReply.frames.length, 1, "a failed state verb must not stop the event verb behind it");
  assert.deepEqual((await readMetadata(chatId)).pixelforgeWeather, { word: "fair", intensity: "light" });

  // The committed-write signal must not ride on the claim. The claim is provenance and can fail on
  // its own; a write the client is never told to refetch leaves the package showing a stale world
  // until the chat is reopened, which is the one failure the player would actually see.
  let notifiedDespiteClaimFailure = false;
  await executeGmVerbCalls({
    calls: [{ verb: weatherVerb, args: { word: "snow" } }],
    table: live,
    turn,
    store: {
      ...chats,
      claimMessageExtraForSwipe: async () => {
        throw new Error("claim storage is down");
      },
    } as unknown as typeof chats,
    reply: createReplyDouble().reply,
    onMetadataWritten: () => {
      notifiedDespiteClaimFailure = true;
    },
  });
  assert.equal(notifiedDespiteClaimFailure, true, "a committed write is announced even when its claim fails");
  assert.deepEqual((await readMetadata(chatId)).pixelforgeWeather, { word: "snow" });

  // A mixed turn: both halves run, and each does its own thing.
  const bothReply = createReplyDouble();
  await executeGmVerbCalls({
    calls: [
      { verb: weatherVerb, args: { word: "overcast" } },
      { verb: standingVerb, args: { npc: "Tam", stance: "close" } },
    ],
    table: live,
    turn,
    store: chats,
    reply: bothReply.reply,
  });
  assert.equal(bothReply.frames.length, 1);
  assert.deepEqual((await readMetadata(chatId)).pixelforgeWeather, { word: "overcast" });

  // An empty messageId costs the CLAIM, never the write or the emit. The claim buys provenance, not
  // dedupe, so losing it loses a record and nothing else.
  const anonymousReply = createReplyDouble();
  await executeGmVerbCalls({
    calls: [
      { verb: weatherVerb, args: { word: "rain" } },
      { verb: standingVerb, args: { npc: "Mira", stance: "none" } },
    ],
    table: live,
    turn: { chatId, messageId: "", swipeIndex: 0 },
    store: chats,
    reply: anonymousReply.reply,
  });
  assert.deepEqual((await readMetadata(chatId)).pixelforgeWeather, { word: "rain" });
  assert.equal(anonymousReply.frames.length, 1);
  assert.equal(await claimGmVerb(chats, weatherVerb, { word: "rain" }, { chatId, messageId: "", swipeIndex: 0 }), false);

  // The write shape is `patchMetadata` and nothing else, so a state verb can only ever replace its
  // own key — never read-modify-write a whole metadata object and lose a concurrent turn's write.
  await assert.rejects(
    () => applyGmVerbWrite(chats, chatId, standingVerb, { npc: "Mira", stance: "none" }),
    /no metadataKey/,
    "an event verb has no key and must never reach the write path",
  );

  // ── Wiring pins the unit tests above cannot see ────────────────────────────

  const generateRoute = readFileSync(join(repositoryRoot, "packages/server/src/routes/generate.routes.ts"), "utf8");
  // C4: the Conversation command surface is gated by one flag for the whole surface. The verb path
  // must never flip it — that would arm every registered conversation command on every game turn.
  assert.match(
    generateRoute,
    /const conversationCommandsEnabled = chatMode === "conversation" && chatMeta\.characterCommands !== false;/,
    "the conversation-command gate must stay conversation-only",
  );
  assert.match(
    generateRoute,
    /if \(chatMode === "game" && !input\.impersonate && fullResponse\) \{/,
    "the GM verb scan must run on its own game-mode-only path",
  );

  const useGenerate = readFileSync(join(repositoryRoot, "packages/client/src/hooks/use-generate.ts"), "utf8");
  // Both SSE switches, always. A case in one switch and not the other is a silent no-op on whichever
  // route was forgotten — which is exactly how `metadata_patch` came to be missing from the retry
  // twin while three server sites were emitting it.
  for (const [eventType, expected] of [
    ["gm_verb", 2],
    ["metadata_patch", 2],
  ] as const) {
    assert.equal(
      useGenerate.split(`case "${eventType}":`).length - 1,
      expected,
      `${eventType} must be handled in BOTH the main and retry SSE switches`,
    );
  }
  assert.equal(
    (generateRoute.match(/type: "gm_verb"/g) ?? []).length +
      (
        readFileSync(
          join(repositoryRoot, "packages/server/src/services/capability-packages/capability-gm-verb-runtime.service.ts"),
          "utf8",
        ).match(/type: "gm_verb"/g) ?? []
      ).length,
    1,
    "the gm_verb envelope is built in exactly one place",
  );

  // The seam is advertised only now that the runtime behind it exists.
  assert.deepEqual({ ...supportedCapabilityApi }, { major: 1, minor: 16 });
  const manifestSchema = readFileSync(
    join(repositoryRoot, "packages/shared/src/schemas/capability-package.schema.ts"),
    "utf8",
  );
  assert.match(
    manifestSchema,
    /^\/\/ 1\.16: /m,
    "every capability API version carries its own line in the ladder — 1.9 is the counterexample nobody wants a second of",
  );

  console.log("Capability GM verb runtime regression passed.");
} finally {
  for (const chatId of createdChatIds) {
    await chats.remove(chatId).catch(() => undefined);
  }
  await closeDB().catch(() => undefined);
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (previousFileStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousFileStorageDir;
  if (previousMarinaraFileStorageDir === undefined) delete process.env.MARINARA_FILE_STORAGE_DIR;
  else process.env.MARINARA_FILE_STORAGE_DIR = previousMarinaraFileStorageDir;
}
