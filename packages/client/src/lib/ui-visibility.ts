import type { ChatMode } from "@marinara-engine/shared";

/** Presentation policy for this fork. Never use this to filter storage, tools,
 * provider routing, or capability execution: Mari retains the full workspace. */
export const UI_VISIBILITY = {
  gameMode: false,
  turnGames: false,
  combat: false,
  rpgHud: false,
  rpgStats: false,
  schedules: false,
} as const;

export const VISIBLE_CHAT_MODES: readonly ChatMode[] = ["conversation", "roleplay"];
export const isVisibleChatMode = (mode: string) => VISIBLE_CHAT_MODES.some((visible) => visible === mode);

const GAME_CAPABILITIES = new Set([
  "combat",
  "persona-stats",
  "inventory-tracker",
  "quest",
  "gacha-forge",
  "uno",
  "chess",
  "poker",
  "eightball",
  "tic-tac-toe",
  "rock-paper-scissors",
]);

export function isVisibleCapability(manifest: { id: string; kind?: string | readonly string[] }) {
  return !manifest.kind?.includes("turn-game") && !GAME_CAPABILITIES.has(manifest.id);
}

const HIDDEN_COMMANDS = new Set([
  "games",
  "game",
  "combat",
  "encounter",
  "roll",
  "dice",
  "schedule",
  "schedule_update",
  "uno",
  "chess",
  "poker",
  "eightball",
  "tic_tac_toe",
  "rock_paper_scissors",
]);
export const isVisibleCommand = (name: string) => !HIDDEN_COMMANDS.has(name);
export const isVisibleEditorSection = (id: string) => id !== "stats";
export const isVisibleTrackerSection = (id: string) => !["persona", "inventory", "quests"].includes(id);
export const isVisibleSettingsSection = (id: string) => !["game-playback", "game-presentation"].includes(id);
export const isVisibleSettingsControl = (id: string) => id !== "notification-game-sound";

export function isVisibleDoc(path: string) {
  if (path.startsWith("game/"))
    return ["game/game-assets.md", "game/storyboard.md", "game/ltx-2-3-storyboards.md"].includes(path);
  return !["roleplay/combat-encounters.md", "conversation/table-games.md", "conversation/schedules.md"].includes(path);
}
