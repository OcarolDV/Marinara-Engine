import assert from "node:assert/strict";
import { chatModeSchema } from "../../packages/shared/src/schemas/chat.schema.js";
import { resolveProfessorMariNavigation } from "../../packages/client/src/lib/professor-mari-navigation.js";
import {
  VISIBLE_CHAT_MODES,
  isVisibleCapability,
  isVisibleCommand,
  isVisibleEditorSection,
  isVisibleSettingsSection,
  isVisibleTrackerSection,
} from "../../packages/client/src/lib/ui-visibility.js";

assert.deepEqual(VISIBLE_CHAT_MODES, ["conversation", "roleplay"]);
// UI policy must leave the storage/import contract intact.
assert.equal(chatModeSchema.parse("game"), "game");
for (const id of ["combat", "poker", "uno", "chess", "inventory-tracker", "quest", "persona-stats"]) {
  assert.equal(isVisibleCapability({ id }), false, id);
}
assert.equal(isVisibleCapability({ id: "future-table-game", kind: ["feature", "turn-game"] }), false);
for (const id of [
  "professor-mari",
  "illustrator",
  "game-assets",
  "world-state",
  "character-tracker",
  "custom-tracker",
  "long-term-memory",
  "storyboard",
  "lorebook-keeper",
]) {
  assert.equal(isVisibleCapability({ id, kind: ["agent"] }), true, id);
}
for (const name of ["games", "roll", "schedule_update", "chess", "poker"]) assert.equal(isVisibleCommand(name), false);
for (const name of ["scene", "guided", "illustrate", "selfie", "continue", "as"])
  assert.equal(isVisibleCommand(name), true);
assert.equal(isVisibleEditorSection("stats"), false);
assert.equal(isVisibleEditorSection("lorebook"), true);
assert.equal(isVisibleSettingsSection("game-presentation"), false);
assert.equal(isVisibleSettingsSection("game-assets"), true);
assert.deepEqual(["world", "persona", "characters", "inventory", "quests", "custom"].filter(isVisibleTrackerSection), [
  "world",
  "characters",
  "custom",
]);
// Mari's resource navigation must retain legacy internal names.
const assets = resolveProfessorMariNavigation("game assets", [], [], []);
assert.deepEqual(assets, { kind: "surface", surface: "game-assets" });
console.log("Writers room policy preserves authoring capabilities and Mari asset navigation.");
