"use client";

import { useCallback, useEffect, useState } from "react";

const REFRESH_MS = 60_000;

export interface WidgetState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
}

export function useEndpoint<T>(urls: string[]): WidgetState<T> & { name: string; reload: () => Promise<void> } {
  const [state, setState] = useState<WidgetState<T>>({
    data: null,
    error: null,
    loading: true,
    updatedAt: null,
  });

  const load = useCallback(async () => {
    let lastError = "request failed";
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        const data = (await res.json()) as T;
        setState({ data, error: null, loading: false, updatedAt: Date.now() });
        return;
      } catch {
        lastError = "network error";
      }
    }
    setState((prev) => ({
      data: prev.data,
      error: lastError,
      loading: false,
      updatedAt: prev.updatedAt,
    }));
  }, [urls.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return { ...state, name: urls[0], reload: load };
}
