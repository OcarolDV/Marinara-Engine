import { useMemo } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import { normalizeAvatarCrop } from "@marinara-engine/shared";
import { useCharacterSummaries } from "../../hooks/use-characters";
import { useHomeFeed } from "../../hooks/use-home-feed";
import { cn, getAvatarCropStyle } from "../../lib/utils";
import { useChatStore } from "../../stores/chat.store";
import { useTranslation } from "react-i18next";
import { isVisibleChatMode } from "../../lib/ui-visibility";

function messagePreview(role: string, content: string, fallback: string, youLabel: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return role === "user" ? `${youLabel}: ${normalized}` : normalized;
}

export function RecentChats() {
  const { t } = useTranslation();
  const feed = useHomeFeed();
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const recentChats = useMemo(
    () => (feed.data?.recentChats ?? []).filter(({ chat }) => isVisibleChatMode(chat.mode)),
    [feed.data?.recentChats],
  );
  const characterIds = useMemo(
    () => Array.from(new Set(recentChats.flatMap(({ chat }) => chat.characterIds))),
    [recentChats],
  );
  const summaries = useCharacterSummaries(characterIds);
  const characterLookup = useMemo(
    () => new Map((summaries.data ?? []).map((character) => [character.id, character])),
    [summaries.data],
  );

  if (feed.isPending) {
    return (
      <div className="space-y-3 py-4" role="status" aria-label={t("home.recentChats.loading")}>
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-16 animate-pulse rounded-md bg-[var(--muted)]" />
        ))}
      </div>
    );
  }
  if (feed.isError) {
    return (
      <div className="py-6" role="alert">
        <p className="text-sm font-semibold">{t("home.recentChats.errorTitle")}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {t("home.recentChats.errorDescription")}
        </p>
        <button
          type="button"
          onClick={() => void feed.refetch()}
          className="mari-chrome-control mt-3 min-h-11 px-3 text-sm"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {t("home.recentChats.retry")}
        </button>
      </div>
    );
  }
  if (recentChats.length === 0) {
    return (
      <div className="py-6">
        <p className="text-sm font-semibold">{t("home.recentChats.emptyTitle")}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
          {t("home.recentChats.emptyDescription")}
        </p>
      </div>
    );
  }
  return (
    <div
      className="divide-y divide-[var(--border)]"
      data-component="RecentChats"
      data-mobile-limit="3"
      data-narrow-desktop-limit="4"
    >
      {recentChats.slice(0, 4).map(({ chat, latestMessage }, index) => {
        const characterId = chat.characterIds.find((id) => characterLookup.has(id));
        const character = characterId ? characterLookup.get(characterId) : null;
        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => setActiveChatId(chat.id)}
            data-chat-mode={chat.mode}
            data-recent-chat-index={index}
            className={cn(
              "flex min-h-24 w-full items-center gap-3 px-2 py-4 text-left hover:bg-[var(--accent)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]",
              index === 3 && "hidden md:flex",
            )}
          >
            {character?.avatarUrl ? (
              <img
                src={character.avatarUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-md object-cover"
                style={getAvatarCropStyle(normalizeAvatarCrop(character.avatarCrop))}
                loading="lazy"
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center text-[var(--muted-foreground)]">
                <MessageSquare size={22} aria-hidden="true" />
              </span>
            )}
            <span className="block min-w-0 flex-1">
              <span className="block truncate text-base font-medium">{chat.name}</span>
              <span className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--muted-foreground)]">
                {latestMessage
                  ? messagePreview(
                      latestMessage.role,
                      latestMessage.content,
                      t("home.recentChats.noPreview"),
                      t("home.recentChats.you"),
                    )
                  : t("home.recentChats.noPreview")}
              </span>
              <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                {t(`home.recentChats.mode.${chat.mode}`)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
