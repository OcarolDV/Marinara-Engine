import { ArrowRight, BookOpen, Images, Plus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { openWorkspace } from "../../lib/workspace-navigation";
import { HomeNewChatLauncher } from "./HomeNewChatLauncher";
import { RecentChats } from "./RecentChats";

export function WritersRoomHome() {
  const { t } = useTranslation();
  const resources = [
    { key: "characters", icon: Users, open: () => useUIStore.getState().openCharacterLibrary() },
    { key: "lore", icon: BookOpen, open: () => useUIStore.getState().openRightPanel("lorebooks") },
    { key: "assets", icon: Images, open: () => useUIStore.getState().openGameAssetsBrowser() },
  ];
  return (
    <div data-component="WritersRoomHome" className="mx-auto w-full max-w-5xl px-5 py-7 sm:px-10 sm:py-10">
      <header data-tour="home-hub" className="mb-8 flex flex-wrap items-center justify-between gap-5">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{t("writersRoom.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <HomeNewChatLauncher
            mode="conversation"
            ariaLabel={t("writersRoom.newConversation")}
            className="!h-11 !px-3 !text-sm"
          >
            <Plus size={16} aria-hidden="true" />
            {t("writersRoom.newConversation")}
          </HomeNewChatLauncher>
          <HomeNewChatLauncher
            mode="roleplay"
            ariaLabel={t("writersRoom.newRoleplay")}
            className="!h-11 !px-3 !text-sm"
          >
            <Plus size={16} aria-hidden="true" />
            {t("writersRoom.newRoleplay")}
          </HomeNewChatLauncher>
        </div>
      </header>
      <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_14rem] @3xl:gap-12">
        <section aria-labelledby="workspace-chats" className="min-w-0">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border)] pb-2">
            <h2 id="workspace-chats" className="text-base font-semibold">
              {t("writersRoom.continue")}
            </h2>
            <button
              type="button"
              onClick={() => useUIStore.getState().setSidebarOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              {t("writersRoom.allChats")}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
          <RecentChats />
        </section>
        <section aria-labelledby="workspace-materials">
          <h2
            id="workspace-materials"
            className="flex min-h-14 items-center border-b border-[var(--border)] pb-2 text-base font-semibold"
          >
            {t("writersRoom.materials")}
          </h2>
          <div className="py-2">
            {resources.map(({ key, icon: Icon, open }) => (
              <button
                key={key}
                type="button"
                onClick={open}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-[var(--accent)]"
              >
                <Icon size={18} className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
                {t(`writersRoom.nav.${key}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => openWorkspace("professor")}
            className="flex min-h-16 w-full items-center gap-3 border-t border-[var(--border)] px-2 text-left text-sm hover:bg-[var(--accent)]"
          >
            <img src="/sprites/mari/Mari_profile.png" alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
            {t("writersRoom.nav.mari")}
          </button>
        </section>
      </div>
      <footer className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-[var(--muted-foreground)]">
        <button type="button" className="min-h-11 hover:underline" onClick={() => openWorkspace("extras")}>
          {t("writersRoom.extras")}
        </button>
        <button
          type="button"
          className="min-h-11 hover:underline"
          data-tour="home-documentation"
          onClick={() => useUIStore.getState().openModal("docs-viewer")}
        >
          {t("home.actions.documentation")}
        </button>
      </footer>
    </div>
  );
}
