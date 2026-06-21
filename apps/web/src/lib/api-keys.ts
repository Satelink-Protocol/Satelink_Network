"use client";

/**
 * Customer-Zero API-key store. Keys are kept in localStorage (the gateway has
 * no per-user session yet), so every billing surface reads/writes through this
 * one module — create, select, name and revoke (local removal) all live here.
 */

import { useCallback, useEffect, useState } from "react";

const LIST_KEY = "satelink_api_keys";
const nameKeyOf = (k: string) => `sat_key_name_${k}`;

export function loadKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function persist(list: string[]) {
  localStorage.setItem(LIST_KEY, JSON.stringify(list));
}

export function getKeyName(key: string): string {
  if (typeof window === "undefined") return "API Key";
  return localStorage.getItem(nameKeyOf(key)) || "API Key";
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 14) return `${key.slice(0, 6)}••••`;
  return `${key.slice(0, 12)}${"•".repeat(12)}${key.slice(-4)}`;
}

export interface UseApiKeys {
  keys: string[];
  selected: string;
  ready: boolean;
  setSelected: (key: string) => void;
  addKey: (key: string, name: string) => void;
  removeKey: (key: string) => void;
  nameOf: (key: string) => string;
}

export function useApiKeys(): UseApiKeys {
  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const list = loadKeys();
    setKeys(list);
    setSelected(list[0] ?? "");
    setReady(true);
  }, []);

  const addKey = useCallback((key: string, name: string) => {
    if (name) localStorage.setItem(nameKeyOf(key), name);
    setKeys((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      persist(next);
      return next;
    });
    setSelected(key);
  }, []);

  const removeKey = useCallback((key: string) => {
    localStorage.removeItem(nameKeyOf(key));
    setKeys((prev) => {
      const next = prev.filter((k) => k !== key);
      persist(next);
      setSelected((cur) => (cur === key ? next[0] ?? "" : cur));
      return next;
    });
  }, []);

  return { keys, selected, ready, setSelected, addKey, removeKey, nameOf: getKeyName };
}

// ---- shared billing fetch types + helpers ----

export interface UsageSummary {
  ok?: boolean;
  tier: string;
  daily_limit: number;
  requests_today: number;
  requests_remaining: number;
  usdt_spent_today: number;
  total_spent_usdt: number;
  credits_remaining: number;
  status: string;
  created_at?: string;
}

export interface DepositInfo {
  current_tier: string;
  current_limit: number;
  credits_balance: number;
  total_deposited: number;
  deposit: { address: string; network: string; token: string; token_address: string };
  pricing: Record<"basic" | "pro" | "enterprise", { price: number; limit: number }>;
}

export interface DepositRecord {
  tx_hash: string;
  amount_usdt: string;
  created_at: string;
}

export const PRICE_PER_CALL = 0.00003; // USDT per metered RPC call
export const MIN_CONFIRMATIONS = 25; // mirrors apps/api deposit_validation.mjs

export async function keyFetch<T>(path: string, key: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { ...(init?.headers || {}), "X-API-Key": key },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
  return body as T;
}
