import { BookOpen, ChevronDown, Home, Images, MessageSquareText, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useUIStore, type Panel } from "../../stores/ui.store";
import { useChatStore } from "../../stores/chat.store";
import { openWorkspace, leaveWorkspaceEditor } from "../../lib/workspace-navigation";
import { cn } from "../../lib/utils";
import { SpotifyMiniPlayer } from "../spotify/SpotifyMiniPlayer";
import { YouTubePlayer } from "../chat/YouTubePlayer";
import { LocalMusicPlayer } from "../chat/LocalMusicPlayer";
import { useInstalledCapabilityPackages } from "../../hooks/use-capability-packages";
import {
  PersonalExtensionContributionsMenu,
  PersonalExtensionTopbarButtons,
} from "./PersonalExtensionContributionsMenu";

export function TopBar({ mobileTopbarNavigation }: { mobileTopbarNavigation: boolean }) {
  const { t } = useTranslation();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const rightPanel = useUIStore((s) => s.rightPanel);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const workspaceView = useUIStore((s) => s.workspaceView);
  const characterDetailId = useUIStore((s) => s.characterDetailId);
  const characterLibraryOpen = useUIStore((s) => s.characterLibraryOpen);
  const lorebookDetailId = useUIStore((s) => s.lorebookDetailId);
  const gameAssetsBrowserOpen = useUIStore((s) => s.gameAssetsBrowserOpen);
  const hasDetails = useUIStore((s) => s.hasAnyDetailOpen());
  const activeChatId = useChatStore((s) => s.activeChatId);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsLayout, setToolsLayout] = useState({ left: 8, top: 48, includeResources: true });
  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLElement>(null);
  const toolsPressRef = useRef<PointerEvent | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data: capabilities = [] } = useInstalledCapabilityPackages();
  const musicInstalled = capabilities.some((item) => item.id === "spotify" && item.status === "active");
  useEffect(() => {
    if (!toolsOpen) return;
    toolsMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      // React capture also includes extension menus rendered in their own portals.
      if (event === toolsPressRef.current) return;
      if (event.target instanceof Node && !toolsRef.current?.contains(event.target)) setToolsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToolsOpen(false);
        triggerRef.current?.focus();
      }
    };
    const resize = () => setToolsOpen(false);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    };
  }, [toolsOpen]);
  const panel = (target: Panel) => {
    setToolsOpen(false);
    const ui = useUIStore.getState();
    leaveWorkspaceEditor(() => ui.openRightPanel(target));
  };
  const resources = [
    {
      key: "characters",
      icon: Users,
      active: Boolean(characterDetailId) || characterLibraryOpen || (rightPanelOpen && rightPanel === "characters"),
      open: () => useUIStore.getState().openCharacterLibrary(),
    },
    {
      key: "lore",
      icon: BookOpen,
      active: Boolean(lorebookDetailId) || (rightPanelOpen && rightPanel === "lorebooks"),
      open: () => panel("lorebooks"),
    },
    {
      key: "assets",
      icon: Images,
      active: gameAssetsBrowserOpen,
      open: () => useUIStore.getState().openGameAssetsBrowser(),
    },
  ];
  const navigation = [
    {
      key: "workspace",
      icon: Home,
      active: !activeChatId && !hasDetails && !rightPanelOpen && workspaceView === "workspace",
      open: () => openWorkspace(),
    },
    {
      key: "chats",
      icon: MessageSquareText,
      active: sidebarOpen || (!!activeChatId && !hasDetails && !rightPanelOpen),
      open: () => {
        const ui = useUIStore.getState();
        leaveWorkspaceEditor(() => {
          ui.closeRightPanel();
          ui.toggleSidebar();
        });
      },
    },
    ...resources,
    {
      key: "mari",
      icon: null,
      active: !activeChatId && !hasDetails && !rightPanelOpen && workspaceView === "professor",
      open: () => openWorkspace("professor"),
    },
  ];
  return (
    <header
      data-component="TopBar"
      className="@container/workspace-nav mari-topbar relative z-40 flex h-12 shrink-0 items-center border-b border-[var(--border)] bg-[var(--marinara-topbar-surface)] px-2 sm:px-4"
    >
      <nav
        data-tour="panel-buttons"
        aria-label={t("writersRoom.navigation")}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        {navigation.map(({ key, icon: Icon, active, open }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setToolsOpen(false);
              open();
            }}
            aria-pressed={active}
            title={t(`writersRoom.nav.${key}`)}
            aria-label={t(`writersRoom.nav.${key}`)}
            data-tour={key === "chats" ? "sidebar-toggle" : `panel-${key === "lore" ? "lorebooks" : key}`}
            className={cn(
              "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors hover:bg-[var(--accent)] sm:px-3",
              ["characters", "lore", "assets"].includes(key) && "@max-[56rem]/workspace-nav:hidden",
              mobileTopbarNavigation && "flex-1 flex-col gap-0.5 text-[0.65rem]",
              active ? "bg-[var(--accent)] text-[var(--foreground)]" : "text-[var(--muted-foreground)]",
            )}
          >
            {Icon ? (
              <Icon size={16} aria-hidden="true" />
            ) : (
              <img src="/sprites/mari/Mari_profile.png" alt="" className="h-5 w-5 rounded-full object-cover" />
            )}
            <span className="max-w-[11rem] truncate">{t(`writersRoom.nav.${key}`)}</span>
          </button>
        ))}
        <div ref={toolsRef} className="relative ml-auto shrink-0">
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={toolsOpen}
            aria-controls="workspace-tools"
            onClick={() => {
              if (!toolsOpen && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect();
                const characters = triggerRef.current
                  .closest("header")
                  ?.querySelector('[data-tour="panel-characters"]');
                setToolsLayout({
                  left: Math.max(8, Math.min(rect.right - 256, window.innerWidth - 264)),
                  top: rect.bottom + 4,
                  includeResources: !characters?.getClientRects().length,
                });
              }
              setToolsOpen((open) => !open);
            }}
            className="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            {t("writersRoom.tools")}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {toolsOpen &&
            createPortal(
              <nav
                ref={toolsMenuRef}
                onPointerDownCapture={(event) => {
                  toolsPressRef.current = event.nativeEvent;
                }}
                aria-label={t("writersRoom.tools")}
                id="workspace-tools"
                style={{ left: toolsLayout.left, top: toolsLayout.top }}
                className="mari-chrome-token-scope fixed z-[1000] max-h-[calc(100dvh-5rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl"
              >
                {toolsLayout.includeResources &&
                  resources.map(({ key, open }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setToolsOpen(false);
                        open();
                      }}
                      className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-[var(--accent)]"
                    >
                      {t(`writersRoom.nav.${key}`)}
                    </button>
                  ))}
                {(["personas", "presets", "connections", "agents", "settings"] as const).map((target) => (
                  <button
                    key={target}
                    type="button"
                    data-tour={`panel-${target}`}
                    onClick={() => panel(target)}
                    className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-[var(--accent)]"
                  >
                    {t(`writersRoom.toolsNav.${target}`)}
                  </button>
                ))}
                <div className="my-1 border-t border-[var(--border)]" />
                <button
                  type="button"
                  onClick={() => {
                    setToolsOpen(false);
                    openWorkspace("extras");
                  }}
                  className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-[var(--accent)]"
                >
                  {t("writersRoom.extras")}
                </button>
                <div className="flex items-center gap-2 px-3">
                  <PersonalExtensionTopbarButtons />
                  <PersonalExtensionContributionsMenu />
                </div>
              </nav>,
              document.body,
            )}
        </div>
      </nav>
      {musicInstalled && (
        <>
          <SpotifyMiniPlayer forceFloating />
          <YouTubePlayer />
          <LocalMusicPlayer />
        </>
      )}
    </header>
  );
}
