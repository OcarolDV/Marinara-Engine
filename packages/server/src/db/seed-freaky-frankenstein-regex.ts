// ──────────────────────────────────────────────
// Seed: Freaky Frankenstein Regex 3.0 Suite
// Ships the regex scripts that render and trim the Freaky Frankenstein
// preset's Internal States blocks, colored dialogue and relationship bars.
// Rows are inserted with stable ids and targeted to the bundled preset so
// they only run while that preset is assigned.
// ──────────────────────────────────────────────
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createHash } from "crypto";
import { importRegexScriptSchema, type RegexApplyMode, type RegexPlacement } from "@marinara-engine/shared";
import { logger } from "../lib/logger.js";
import type { DB } from "./connection.js";
import { promptPresets, regexScripts } from "./schema/index.js";
import { now } from "../utils/id-generator.js";
import { eq } from "./file-query.js";
import { createAppSettingsStorage } from "../services/storage/app-settings.storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const FREAKY_FRANKENSTEIN_REGEX_FILE = "freaky-frankenstein-regex.json";
export const FREAKY_FRANKENSTEIN_REGEX_ID_PREFIX = "ff5-regex-";
export const FREAKY_FRANKENSTEIN_REGEX_HASH_KEY = "seed:freaky-frankenstein-regex:sha256";
export const FREAKY_FRANKENSTEIN_REGEX_ROWS_KEY = "seed:freaky-frankenstein-regex:rows";

/** Shape of one row in the bundled JSON (typed, not the file-store encoding). */
export interface BundledRegexRow {
  id: string;
  name: string;
  enabled: boolean;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: RegexPlacement[];
  flags: string;
  promptOnly: boolean;
  applyMode: RegexApplyMode;
  targetCharacterIds: string[];
  targetPromptPresetIds: string[];
  order: number;
  minDepth: number | null;
  maxDepth: number | null;
}

/** Fields that count as "content" for edit detection. `enabled` and targets are the user's. */
interface RegexContent {
  name: string;
  findRegex: string;
  replaceString: string;
  flags: string;
  placement: string[];
  applyMode: string;
  trimStrings: string[];
  minDepth: number | null;
  maxDepth: number | null;
  order: number;
}

export function readBundledFreakyFrankensteinRegex(): { hash: string; rows: BundledRegexRow[] } {
  const raw = readFileSync(join(__dirname, FREAKY_FRANKENSTEIN_REGEX_FILE), "utf-8");
  const rows = JSON.parse(raw) as BundledRegexRow[];
  return { hash: createHash("sha256").update(raw).digest("hex"), rows };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function depthValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function contentOf(row: {
  name: string;
  findRegex: string;
  replaceString: string;
  flags: string;
  placement: unknown;
  applyMode?: string | null;
  promptOnly?: unknown;
  trimStrings: unknown;
  minDepth: unknown;
  maxDepth: unknown;
  order: number;
}): RegexContent {
  const applyMode =
    row.applyMode === "prompt" || row.applyMode === "display" || row.applyMode === "both"
      ? row.applyMode
      : row.promptOnly === true || row.promptOnly === "true"
        ? "prompt"
        : "both";
  return {
    name: row.name,
    findRegex: row.findRegex,
    replaceString: row.replaceString,
    flags: row.flags,
    placement: parseStringArray(row.placement),
    applyMode,
    trimStrings: parseStringArray(row.trimStrings),
    minDepth: depthValue(row.minDepth),
    maxDepth: depthValue(row.maxDepth),
    order: row.order,
  };
}

function contentHash(content: RegexContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function toStoredRow(row: BundledRegexRow, targetPromptPresetIds: string[], timestamp: string) {
  return {
    id: row.id,
    name: row.name,
    enabled: String(row.enabled),
    findRegex: row.findRegex,
    replaceString: row.replaceString,
    trimStrings: JSON.stringify(row.trimStrings),
    placement: JSON.stringify(row.placement),
    flags: row.flags,
    promptOnly: String(row.applyMode === "prompt"),
    applyMode: row.applyMode,
    targetCharacterIds: JSON.stringify(row.targetCharacterIds),
    targetPromptPresetIds: JSON.stringify(targetPromptPresetIds),
    order: row.order,
    minDepth: row.minDepth,
    maxDepth: row.maxDepth,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validateBundledRow(row: BundledRegexRow): boolean {
  const parsed = importRegexScriptSchema.safeParse({
    name: row.name,
    enabled: row.enabled,
    findRegex: row.findRegex,
    replaceString: row.replaceString,
    trimStrings: row.trimStrings,
    placement: row.placement,
    flags: row.flags,
    promptOnly: row.promptOnly,
    applyMode: row.applyMode,
    targetCharacterIds: row.targetCharacterIds,
    targetPromptPresetIds: row.targetPromptPresetIds,
    order: row.order,
    minDepth: row.minDepth,
    maxDepth: row.maxDepth,
  });
  if (parsed.success) return true;
  logger.error("[seed] Skipping invalid bundled Freaky Frankenstein regex %s: %j", row.id, parsed.error.issues);
  return false;
}

/**
 * Insert missing suite rows, refresh untouched rows when the bundle changes,
 * and rebind rows whose preset target no longer exists. User edits to a row's
 * content are left alone; `enabled` and targets are never overwritten.
 */
export async function seedFreakyFrankensteinRegexScripts(db: DB, presetId: string | null): Promise<void> {
  const appSettings = createAppSettingsStorage(db);
  const bundle = readBundledFreakyFrankensteinRegex();
  const appliedHash = await appSettings.get(FREAKY_FRANKENSTEIN_REGEX_HASH_KEY);
  const previousRowHashes = parseRowHashes(await appSettings.get(FREAKY_FRANKENSTEIN_REGEX_ROWS_KEY));
  const bundleChanged = appliedHash !== bundle.hash;

  const existingRows = await db.select().from(regexScripts);
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const presetIds = new Set((await db.select({ id: promptPresets.id }).from(promptPresets)).map((row) => row.id));
  const targets = presetId ? [presetId] : [];
  if (!presetId) {
    logger.warn("[seed] Freaky Frankenstein preset id unavailable; seeding its regex suite without a preset target");
  }

  const timestamp = now();
  const nextRowHashes: Record<string, string> = {};
  let inserted = 0;
  let refreshed = 0;
  let rebound = 0;

  for (const row of bundle.rows) {
    if (!row.id.startsWith(FREAKY_FRANKENSTEIN_REGEX_ID_PREFIX) || !validateBundledRow(row)) continue;
    const bundledContent = contentOf(row);
    const bundledHash = contentHash(bundledContent);
    nextRowHashes[row.id] = bundledHash;

    const current = existingById.get(row.id);
    if (!current) {
      await db.insert(regexScripts).values(toStoredRow(row, targets, timestamp));
      inserted += 1;
      continue;
    }

    const patch: Record<string, unknown> = {};

    // Rebind a target that points at a preset row which no longer exists
    // (the stock preset was deleted and recovered under a new id). An empty
    // target list is the user's choice to run the script globally; keep it.
    const currentTargets = parseStringArray(current.targetPromptPresetIds);
    if (presetId && currentTargets.length > 0 && currentTargets.some((id) => !presetIds.has(id))) {
      const kept = currentTargets.filter((id) => presetIds.has(id));
      if (!kept.includes(presetId)) kept.push(presetId);
      patch.targetPromptPresetIds = JSON.stringify(kept);
      rebound += 1;
    }

    // Refresh content only when the bundle changed and the row still matches
    // what the previous bundle installed, so a user edit is never clobbered.
    if (bundleChanged) {
      const currentHash = contentHash(contentOf(current));
      const lastApplied = previousRowHashes[row.id];
      if (currentHash !== bundledHash) {
        if (lastApplied && currentHash === lastApplied) {
          Object.assign(patch, {
            name: row.name,
            findRegex: row.findRegex,
            replaceString: row.replaceString,
            trimStrings: JSON.stringify(row.trimStrings),
            placement: JSON.stringify(row.placement),
            flags: row.flags,
            promptOnly: String(row.applyMode === "prompt"),
            applyMode: row.applyMode,
            order: row.order,
            minDepth: row.minDepth,
            maxDepth: row.maxDepth,
          });
          refreshed += 1;
        } else {
          logger.debug("[seed] Keeping user-edited Freaky Frankenstein regex %s", row.id);
          // Record the row as user-owned so a later bundle does not treat the
          // current content as "last applied".
          nextRowHashes[row.id] = lastApplied ?? "";
        }
      }
    } else if (previousRowHashes[row.id] !== undefined) {
      nextRowHashes[row.id] = previousRowHashes[row.id]!;
    }

    if (Object.keys(patch).length > 0) {
      await db
        .update(regexScripts)
        .set({ ...patch, updatedAt: timestamp })
        .where(eq(regexScripts.id, row.id));
    }
  }

  if (bundleChanged) await appSettings.set(FREAKY_FRANKENSTEIN_REGEX_HASH_KEY, bundle.hash);
  const serializedRowHashes = JSON.stringify(nextRowHashes);
  if (serializedRowHashes !== JSON.stringify(previousRowHashes)) {
    await appSettings.set(FREAKY_FRANKENSTEIN_REGEX_ROWS_KEY, serializedRowHashes);
  }
  if (inserted > 0 || refreshed > 0 || rebound > 0) {
    logger.info(
      "[seed] Freaky Frankenstein regex suite: %d inserted, %d refreshed, %d rebound",
      inserted,
      refreshed,
      rebound,
    );
  }
}

function parseRowHashes(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
