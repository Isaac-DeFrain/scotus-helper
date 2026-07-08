"use client";

import { useCallback, useEffect, useState } from "react";

import { useFetchHistory } from "./HistorySidebar";
import type { AnalyticsSummary, ExchangeSummary } from "@/src/chat/analytics";

/** Loads sidebar history for a user. */
export function useHistoryBrowse(userId: string) {
  const [historyItems, setHistoryItems] = useState<ExchangeSummary[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);

  const onHistoryLoaded = useCallback(
    (data: { items: ExchangeSummary[]; summary: AnalyticsSummary }) => {
      setHistoryItems(data.items);
      setSummary(data.summary);
    },
    [],
  );

  const refreshHistory = useFetchHistory(userId, onHistoryLoaded);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  return {
    historyItems,
    summary,
    refreshHistory,
  };
}
