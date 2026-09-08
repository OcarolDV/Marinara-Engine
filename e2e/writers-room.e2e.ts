import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedUIState } from "./ui-state-fixture.js";

type PageApi = typeof import("../packages/client/src/lib/api-client");
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

test.beforeEach(async ({ page }) => {
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: false,
    chatHelpSeenModes: ["conversation", "roleplay", "game"],
  });
  await page.addInitScript((v) => localStorage.setItem("marinara:whats-new:seen-version", v), version);
  await page.goto("/");
  await expect(page.locator('[data-component="WritersRoomHome"]')).toBeVisible();
});

async function openTool(page: Page, name: string) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.locator("#workspace-tools").getByRole("button", { name, exact: true }).click();
}

test("workspace navigation keeps Mari and authoring resources reachable", async ({ page }) => {
  const topbar = page.locator('[data-component="TopBar"]');
  await expect(page.getByRole("button", { name: "New conversation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New roleplay", exact: true })).toBeVisible();
  await expect(page.locator('[data-home-chat-mode="game"]')).toHaveCount(0);
  await topbar.getByRole("button", { name: "Professor Mari", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ask Professor Mari", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Skills & Memories/ })).toBeVisible();
  await topbar.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator('[data-component="WritersRoomHome"]')).toBeVisible();
  const assets = topbar.getByRole("button", { name: "Assets", exact: true });
  if (await assets.isVisible()) await assets.click();
  else await openTool(page, "Assets");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          ((await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule).useUIStore.getState()
            .gameAssetsBrowserOpen,
      ),
    )
    .toBe(true);
  await topbar.getByRole("button", { name: "Professor Mari", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Ask Professor Mari", exact: true })).toBeVisible();
  await openTool(page, "Home widgets & more");
  await expect(page.locator('[data-component="HomeBrowserHub.HomePage"]')).toBeVisible();
  await expect(topbar.getByRole("button", { name: "Workspace", exact: true })).toHaveAttribute("aria-pressed", "false");
  await topbar.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect(page.locator('[data-component="WritersRoomHome"]')).toBeVisible();
});

test("game records survive while mode pickers and slash commands stay focused", async ({ page }) => {
  const id = await page.evaluate(async () => {
    const { api } = (await import("/src/lib/api-client.ts" as string)) as PageApi;
    return (
      await api.post<{ id: string }>("/chats", { name: "UI regression retained game", mode: "game", characterIds: [] })
    ).id;
  });
  try {
    await page.locator('[data-component="TopBar"]').getByRole("button", { name: "Chats", exact: true }).click();
    await expect(page.locator('[data-chat-mode-tab="conversation"]')).toBeVisible();
    await expect(page.locator('[data-chat-mode-tab="roleplay"]')).toBeVisible();
    await expect(page.locator('[data-chat-mode-tab="game"]')).toHaveCount(0);
    const commands = await page.evaluate(async () => {
      const { getSlashCompletions } = (await import("/src/lib/slash-commands.ts" as string)) as PageSlashCommandsModule;
      return getSlashCompletions("/", {
        conversationGames: [
          { packageId: "future-game", packageName: "Future game", command: "/futuregame", aliases: [] },
        ],
      }).map((command) => command.name);
    });
    expect(commands).toContain("scene");
    expect(commands).not.toContain("games");
    expect(commands).not.toContain("roll");
    expect(commands).not.toContain("futuregame");
    await page.evaluate(async (chatId) => {
      ((await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule).useUIStore
        .getState()
        .setSidebarOpen(false);
      ((await import("/src/stores/chat.store.ts" as string)) as PageChatStoreModule).useChatStore
        .getState()
        .setActiveChatId(chatId);
    }, id);
    await expect(page.getByText("This game chat is outside the writers’ room.")).toBeVisible();
    expect(
      await page.evaluate(async (chatId) => {
        const { api } = (await import("/src/lib/api-client.ts" as string)) as PageApi;
        return (await api.get<{ mode: string }>(`/chats/${chatId}`)).mode;
      }, id),
    ).toBe("game");
  } finally {
    await page.evaluate(async (chatId) => {
      const { api } = (await import("/src/lib/api-client.ts" as string)) as PageApi;
      await api.delete(`/chats/${chatId}`);
    }, id);
  }
});

test("failed character save blocks navigation, then a successful save opens Mari", async ({ page }) => {
  const id = await page.evaluate(async () => {
    const { api } = (await import("/src/lib/api-client.ts" as string)) as PageApi;
    const character = await api.post<{ id: string }>("/characters", { data: { name: "UI regression original" } });
    ((await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule).useUIStore
      .getState()
      .openCharacterDetail(character.id);
    return character.id;
  });
  const pattern = `**/api/characters/${id}`;
  try {
    await expect(page.locator('[data-editor-section="stats"]')).toBeHidden();
    const name = page.getByPlaceholder("Character name", { exact: true });
    await expect(name).toBeVisible();
    await page.route(pattern, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "Simulated save failure" }),
          })
        : route.continue(),
    );
    await name.fill("UI regression edited");
    await openTool(page, "Settings");
    await expect(name).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            ((await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule).useUIStore.getState()
              .rightPanelOpen,
        ),
      )
      .toBe(false);
    await page.unroute(pattern);
    await page
      .locator('[data-component="TopBar"]')
      .getByRole("button", { name: "Professor Mari", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "Ask Professor Mari", exact: true })).toBeVisible();
    const data = await page.evaluate(async (characterId) => {
      const { api } = (await import("/src/lib/api-client.ts" as string)) as PageApi;
      return (await api.get<{ data: string }>(`/characters/${characterId}`)).data;
    }, id);
    expect(JSON.parse(data).name).toBe("UI regression edited");
  } finally {
    await page.unroute(pattern);
    await page.evaluate(async (characterId) => {
      const { api } = (await import("/src/lib/api-client.ts" as string)) as PageApi;
      await api.delete(`/characters/${characterId}`);
    }, id);
  }
});

test("tools disclosure supports keyboard access and tablet navigation fits", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  await tools.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace-tools")).toBeVisible();
  await expect(page.locator("#workspace-tools").getByRole("button", { name: "Characters", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.locator("#workspace-tools").getByRole("button", { name: "World & Lore", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tools).toBeFocused();
  await expect(page.locator("#workspace-tools")).toHaveCount(0);
  const bounds = await page.locator('[data-component="TopBar"] button').evaluateAll((buttons) =>
    buttons
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
  );
  for (let index = 1; index < bounds.length; index++)
    expect(bounds[index]!.left).toBeGreaterThanOrEqual(bounds[index - 1]!.right);
});

test("Settings uses available space and returns to the same Mari draft", async ({ page, isMobile }) => {
  await page.locator('[data-component="TopBar"]').getByRole("button", { name: "Professor Mari", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Ask Professor Mari", exact: true });
  await draft.fill("Review Mira's dialogue without changing her character card.");
  const original = await draft.elementHandle();
  await openTool(page, "Settings");
  const settings = page.locator('[data-panel-key="settings"]:visible');
  const search = settings.getByRole("textbox", { name: "Search settings", exact: true });
  await expect(search).toBeVisible();
  const bounds = await settings.boundingBox();
  expect(bounds!.width).toBeGreaterThan(page.viewportSize()!.width - 30);
  if (!isMobile) {
    expect(await original!.evaluate((element) => !!element.closest("[inert]"))).toBe(true);
    await expect(page.getByRole("separator", { name: "Resize right sidebar" })).toHaveCount(0);
  }
  const general = settings.getByRole("tab", { name: "General", exact: true });
  await general.focus();
  await page.keyboard.press("ArrowRight");
  await expect(settings.getByRole("tab", { name: "Appearance", exact: true })).toBeFocused();
  await search.fill("Professor Mari Permissions Mode");
  await settings.getByRole("button", { name: /Professor Mari Permissions Mode Select/ }).click();
  const permissions = settings.locator("#settings-control-mari-permissions-mode select");
  await expect(permissions).toBeFocused();
  await expect(permissions).toBeEnabled();
  await expect(permissions.locator("option")).toHaveCount(5);
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(draft).toHaveValue("Review Mira's dialogue without changing her character card.");
  expect(await original!.evaluate((element) => element.isConnected && !element.closest("[inert]"))).toBe(true);
});
