import { ArrowRight, BookOpen, Images, MessageSquareText, Users } from "lucide-react";
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
    <div data-component="WritersRoomHome" className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-10 sm:py-9">
      <header data-tour="home-hub" className="mb-6 max-w-2xl">
        <p className="mb-3 text-sm font-medium text-[var(--muted-foreground)]">{t("writersRoom.brand")}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          {t("writersRoom.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)] sm:text-base">
          {t("writersRoom.description")}
        </p>
      </header>
      <section aria-labelledby="workspace-chats" className="mb-7 sm:mb-9">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 id="workspace-chats" className="text-lg font-semibold">
            {t("writersRoom.continue")}
          </h2>
          <button
            type="button"
            onClick={() => useUIStore.getState().setSidebarOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            {t("writersRoom.allChats")}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
        <RecentChats compact />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <HomeNewChatLauncher
            mode="conversation"
            ariaLabel={t("writersRoom.newConversation")}
            className="!h-11 !rounded-lg !px-4 !text-sm"
          >
            <MessageSquareText size={16} aria-hidden="true" />
            {t("writersRoom.newConversation")}
          </HomeNewChatLauncher>
          <HomeNewChatLauncher
            mode="roleplay"
            ariaLabel={t("writersRoom.newRoleplay")}
            className="!h-11 !rounded-lg !px-4 !text-sm"
          >
            {t("writersRoom.newRoleplay")}
          </HomeNewChatLauncher>
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">{t("writersRoom.chatHint")}</p>
      </section>
      <section aria-labelledby="workspace-materials" className="mb-10">
        <h2 id="workspace-materials" className="mb-4 text-lg font-semibold">
          {t("writersRoom.materials")}
        </h2>
        <div className="grid divide-y divide-[var(--border)] border-y border-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {resources.map(({ key, icon: Icon, open }) => (
            <button
              key={key}
              type="button"
              onClick={open}
              className="group flex min-h-28 items-start gap-3 px-3 py-5 text-left transition-colors hover:bg-[var(--accent)] sm:px-5"
            >
              <Icon size={19} className="mt-0.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold">{t(`writersRoom.nav.${key}`)}</span>
                <span className="mt-1.5 block text-sm leading-5 text-[var(--muted-foreground)]">
                  {t(`writersRoom.resources.${key}`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section
        aria-labelledby="workspace-mari"
        className="flex items-start gap-4 rounded-xl bg-[var(--secondary)] px-5 py-5 sm:items-center"
      >
        <img src="/sprites/mari/Mari_profile.png" alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <h2 id="workspace-mari" className="text-base font-semibold">
            {t("writersRoom.nav.mari")}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
            {t("writersRoom.mariDescription")}
          </p>
          <button
            type="button"
            onClick={() => openWorkspace("professor")}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-[var(--accent)]"
          >
            {t("writersRoom.askMari")}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
      <footer className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[var(--muted-foreground)]">
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
