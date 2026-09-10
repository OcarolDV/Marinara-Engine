import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDefaultPreset, seedFreakyFrankensteinPreset } from "../../packages/server/src/db/seed.js";
import { seedDefaultRegexScripts, CLEAN_HTML_ID } from "../../packages/server/src/db/seed-regex.js";
import {
  FREAKY_FRANKENSTEIN_REGEX_HASH_KEY,
  FREAKY_FRANKENSTEIN_REGEX_ID_PREFIX,
  seedFreakyFrankensteinRegexScripts,
} from "../../packages/server/src/db/seed-freaky-frankenstein-regex.js";
import { createFileNativeDB } from "../../packages/server/src/db/file-backed-store.js";
import { regexScripts } from "../../packages/server/src/db/schema/index.js";
import { eq } from "../../packages/server/src/db/file-query.js";
import { createAppSettingsStorage } from "../../packages/server/src/services/storage/app-settings.storage.js";
import { createPromptsStorage } from "../../packages/server/src/services/storage/prompts.storage.js";
import {
  FREAKY_FRANKENSTEIN_PRESET_NAME,
  FREAKY_FRANKENSTEIN_PRESET_SYSTEM_KEY,
  isStockMarinaraUniversalPreset,
  isStockPreset,
} from "../../packages/shared/src/types/prompt.js";
import { resolveMacros } from "../../packages/shared/src/utils/macro-engine.js";

const dir = mkdtempSync(join(tmpdir(), "marinara-freaky-frankenstein-"));
process.env.FILE_STORAGE_DIR = dir;
const db = await createFileNativeDB();

function parseArray(value: unknown): string[] {
  return typeof value === "string" ? (JSON.parse(value) as string[]) : [];
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function seedAll() {
  await seedDefaultPreset(db);
  const presetId = await seedFreakyFrankensteinPreset(db);
  await seedDefaultRegexScripts(db);
  await seedFreakyFrankensteinRegexScripts(db, presetId);
  return presetId;
}

async function suiteRows() {
  return (await db.select().from(regexScripts))
    .filter((row) => row.id.startsWith(FREAKY_FRANKENSTEIN_REGEX_ID_PREFIX))
    .sort((a, b) => a.order - b.order);
}

try {
  const storage = createPromptsStorage(db);
  const appSettings = createAppSettingsStorage(db);

  // ── Fresh profile ──
  const presetId = await seedAll();
  assert.ok(presetId, "the Freaky Frankenstein seed returns the preset id");
  const presets = await storage.list();
  const universal = presets.find(isStockMarinaraUniversalPreset);
  const freaky = presets.find((preset) => preset.systemKey === FREAKY_FRANKENSTEIN_PRESET_SYSTEM_KEY);
  assert.ok(universal, "the Universal preset is seeded");
  assert.ok(freaky, "the Freaky Frankenstein preset is seeded");
  assert.equal(freaky.id, presetId);
  assert.equal(freaky.name, FREAKY_FRANKENSTEIN_PRESET_NAME);
  assert.equal(String(freaky.isDefault), "false", "Freaky Frankenstein never claims the default star");
  assert.equal(String(universal.isDefault), "true", "the Universal preset stays the default");
  assert.ok(isStockPreset(freaky) && isStockPreset(universal), "both bundled presets are stock");

  assert.equal((await storage.listSections(freaky.id)).length, 69, "all 69 sections are seeded");
  assert.equal((await storage.listGroups(freaky.id)).length, 12, "all 12 groups are seeded");
  assert.equal((await storage.listChoiceBlocksForPreset(freaky.id)).length, 12, "all 12 choice blocks are seeded");
  const parameters = parseObject(freaky.parameters);
  assert.ok(Object.keys(parameters).length > 0, "generation parameters are carried by the bundle");
  const defaults = parseObject(freaky.defaultChoices);
  assert.equal(defaults.cot_style, "BOLT");
  assert.equal(defaults.state_mode, "INTERNAL");
  assert.equal(defaults.reasoning_format, "NATIVE");

  // ── Regex suite ──
  const rows = await suiteRows();
  assert.equal(rows.length, 25, "the FF5 Regex 3.0 suite has 25 rows");
  const cleanHtml = (await db.select().from(regexScripts)).find((row) => row.id === CLEAN_HTML_ID);
  assert.ok(cleanHtml, "the built-in Clean HTML script is present");
  for (const row of rows) {
    assert.deepEqual(parseArray(row.targetPromptPresetIds), [freaky.id], `${row.id} targets the FF preset`);
    assert.ok(row.order < cleanHtml.order, `${row.id} runs before Clean HTML`);
    assert.doesNotThrow(() => new RegExp(row.findRegex, row.flags), `${row.id} compiles`);
    assert.equal(row.enabled, "true");
  }

  // ── Idempotent re-run ──
  const before = JSON.stringify({ presets: await storage.list(), rows });
  await seedAll();
  const after = JSON.stringify({ presets: await storage.list(), rows: await suiteRows() });
  assert.equal(after, before, "re-running every seed changes nothing");

  // ── Render sanity with the shipped defaults ──
  const variables = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value)]),
  );
  const context = {
    user: "Alex",
    char: "Mira",
    characters: ["Mira"],
    variables,
    localVariables: variables,
    agentData: {},
  };
  const sections = await storage.listSections(freaky.id);
  const rendered = new Map(sections.map((section) => [section.name.trim(), resolveMacros(section.content, context)]));
  for (const [name, text] of rendered) {
    for (const token of ["{{#if", "{{/if}}", "{{else", "{{roll::"]) {
      assert.ok(!text.includes(token), `${name} leaves no ${token} in the rendered prompt`);
    }
  }
  assert.ok((rendered.get("🐉🗡️DnD Simulator 🎲") ?? "").includes("DND SIM"), "the DnD module renders under defaults");
  assert.equal((rendered.get("📖Story Mode ✍🏻") ?? "x").trim(), "", "Story Mode is off when Cinematic is chosen");
  assert.equal(
    (rendered.get("🎤NPC Voice + Dialogue Output🗣️") ?? "x").trim(),
    "",
    "the older NPC Voice toggle does not match the 2.0 selection by substring",
  );
  assert.ok((rendered.get("🎤NPC Voice + Dialogue 2.0 🗣️") ?? "").includes("<npc_voice>"), "NPC Voice 2.0 renders");

  // ── User edits are preserved as a copy and the stock preset is restored ──
  const originalDescription = freaky.description;
  await storage.update(freaky.id, { description: "My tweaked Frankenstein" });
  await seedAll();
  const afterEdit = await storage.list();
  const restored = afterEdit.find((preset) => preset.systemKey === FREAKY_FRANKENSTEIN_PRESET_SYSTEM_KEY);
  const copy = afterEdit.find((preset) => preset.name === `${FREAKY_FRANKENSTEIN_PRESET_NAME} (Copy)`);
  assert.equal(restored?.description, originalDescription, "startup restores the bundled description");
  assert.equal(copy?.description, "My tweaked Frankenstein", "the edit survives as an editable copy");
  assert.equal(copy?.systemKey, "", "the copy is not stock");
  assert.equal(String(afterEdit.find(isStockMarinaraUniversalPreset)?.isDefault), "true", "the default is untouched");

  // ── Regex rows: user choices survive a bundle change ──
  const [globalRow, editedRow] = await suiteRows();
  await db.update(regexScripts).set({ targetPromptPresetIds: "[]" }).where(eq(regexScripts.id, globalRow!.id));
  await db.update(regexScripts).set({ replaceString: "USER EDIT" }).where(eq(regexScripts.id, editedRow!.id));
  await appSettings.set(FREAKY_FRANKENSTEIN_REGEX_HASH_KEY, "outdated-bundle-hash");
  await seedFreakyFrankensteinRegexScripts(db, restored!.id);
  const afterBundleChange = await suiteRows();
  assert.deepEqual(
    parseArray(afterBundleChange.find((row) => row.id === globalRow!.id)?.targetPromptPresetIds),
    [],
    "a script the user made global stays global",
  );
  assert.equal(
    afterBundleChange.find((row) => row.id === editedRow!.id)?.replaceString,
    "USER EDIT",
    "a user-edited script is not overwritten by a bundle change",
  );

  // ── Deleted stock preset is recovered and stale regex targets are rebound ──
  await storage.remove(restored!.id);
  const recoveredId = await seedAll();
  assert.ok(recoveredId && recoveredId !== restored!.id, "the deleted preset is recovered under a new id");
  const recoveredRows = await suiteRows();
  assert.equal(recoveredRows.length, 25, "no duplicate suite rows after recovery");
  for (const row of recoveredRows) {
    const targets = parseArray(row.targetPromptPresetIds);
    if (row.id === globalRow!.id) {
      assert.deepEqual(targets, [], "the global script stays global after recovery");
    } else {
      assert.deepEqual(targets, [recoveredId], `${row.id} is rebound to the recovered preset`);
    }
  }
  assert.equal(
    String((await storage.list()).find(isStockMarinaraUniversalPreset)?.isDefault),
    "true",
    "recovery does not steal the default",
  );
} finally {
  await db._fileStore.close();
  rmSync(dir, { recursive: true, force: true });
}

console.info("Freaky Frankenstein seed regression checks passed.");
