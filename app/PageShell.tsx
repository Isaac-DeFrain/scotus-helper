/**
 * Root layout for the main chat page (`/`).
 *
 * Composes the history sidebar and chat surface, keeps sidebar data in sync
 * after each completed query, and wires keyboard navigation between past
 * exchanges (Ctrl+ArrowUp/Down navigates to `/history/[id]`).
 */

"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { ChatPage } from "./ChatPage";
import { FooterBar } from "./FooterBar";
import {
  HistorySidebar,
  useHistoryItemRefs,
  useHistorySidebarScroll,
} from "./history/HistorySidebar";
import { useHistoryBrowse } from "./history/useHistoryBrowse";
import { useHistoryKeyboardNav } from "./history/useHistoryKeyboardNav";
import styles from "./page.module.css";
import { getOrCreateUserId } from "@/src/userId";

/** Returns the exchange id when the URL is `/history/[id]`; otherwise null. */
function activeExchangeIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/history\/(\d+)/);
  if (!match) return null;

  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function PageShell() {
  const [userId] = useState(() => getOrCreateUserId());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const itemRefs = useHistoryItemRefs();
  const pathname = usePathname();
  const router = useRouter();

  // Lifted from ChatPage so keyboard nav can defer while the user is typing.
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isInputFocused, setIsInputFocused] = useState(false);

  const { historyItems, summary, refreshHistory } = useHistoryBrowse(userId);
  const activeExchangeId = useMemo(
    () => activeExchangeIdFromPath(pathname),
    [pathname],
  );

  useHistoryKeyboardNav({
    items: historyItems,
    selectedExchangeId: activeExchangeId,
    onSelect: (id) => {
      router.push(`/history/${id}`);
    },
    isBlocked: isStreaming || (isInputFocused && inputValue.trim().length > 0),
  });

  // Scroll the sidebar so the active item stays visible after keyboard nav.
  useHistorySidebarScroll(activeExchangeId, itemRefs);

  return (
    <div className={styles.pageShell}>
      <HistorySidebar
        items={historyItems}
        summary={summary}
        activeExchangeId={activeExchangeId}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((open) => !open)}
        // Collapse the drawer after selecting a history link on narrow viewports.
        onNavigate={() => setSidebarOpen(false)}
        itemRefs={itemRefs}
      />

      <div className={styles.container}>
        <ChatPage
          userId={userId}
          onChatComplete={refreshHistory}
          onStreamingChange={setIsStreaming}
          onInputValueChange={setInputValue}
          onInputFocusChange={setIsInputFocused}
        />
        <FooterBar />
      </div>
    </div>
  );
}
