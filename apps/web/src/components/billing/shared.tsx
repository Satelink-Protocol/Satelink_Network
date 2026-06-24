"use client";

/**
 * Shared Customer-Zero billing UI: key selector, no-key empty state, copy
 * field, the 402 / insufficient-balance recovery panel, and the onboarding
 * progress strip. Every piece composes @satelink/ui only.
 */

import * as React from "react";
import { Copy, Check, Wallet, KeyRound, Send, Coins, CircleCheck } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
  EmptyState,
  StatusBadge,
} from "@satelink/ui";
import { getKeyName, MIN_CONFIRMATIONS } from "@/lib/api-keys";

/* ---------- Copy-to-clipboard button ---------- */
export function CopyButton({
  value,
  label = "Copy",
  size = "xs",
  variant = "ghost",
  className,
}: {
  value: string;
  label?: string;
  size?: "xs" | "sm" | "icon";
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — no-op */
    }
  };
  if (size === "icon") {
    return (
      <Button size="icon-sm" variant={variant} onClick={copy} aria-label={label} title={label} className={className}>
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </Button>
    );
  }
  return (
    <Button size={size} variant={variant} onClick={copy} className={className}>
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/* ---------- Labeled value + copy (addresses, hashes) ---------- */
export function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="block flex-1 break-all rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {value}
        </code>
        <CopyButton value={value} size="icon" variant="outline" label="Copy" />
      </div>
    </div>
  );
}

/* ---------- Key selector ---------- */
export function KeySelector({
  keys,
  selected,
  onSelect,
}: {
  keys: string[];
  selected: string;
  onSelect: (k: string) => void;
}) {
  if (keys.length <= 1) return null;
  return (
    <Card className="flex-row items-center justify-between py-3">
      <span className="px-5 text-xs text-muted-foreground">Active API Key</span>
      <div className="px-5">
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none"
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {getKeyName(k)} ({k.substring(0, 10)}…)
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}

/* ---------- No-key empty state (with action + next step) ---------- */
export function NoKeyState({ context }: { context: string }) {
  return (
    <div className="mx-auto my-12 w-full max-w-md">
      <EmptyState
        title="Create your API key to begin"
        description={`You need an API key before you can ${context}. It takes one click — no signup, free tier included.`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button asChild size="sm">
              <a href="/satelink/os/keys">Create API Key →</a>
            </Button>
            <span className="text-[11px] text-muted-foreground">Next: fund credits, then make your first request.</span>
          </div>
        }
      />
    </div>
  );
}

/* ---------- 402 / insufficient-balance recovery (Task 6) ---------- */
export function InsufficientBalance({
  balance,
  required,
  vaultAddress,
  onRetry,
}: {
  balance: number;
  required?: number;
  vaultAddress?: string;
  onRetry?: () => void;
}) {
  const need = required ?? 0.001;
  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Coins className="size-4" /> Insufficient credits — requests will return HTTP 402
        </CardTitle>
        <CardDescription>
          Your gateway requests are blocked because the key has no spendable USDT credits. Top up to resume.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current balance</p>
            <p className="font-mono text-base font-bold text-destructive">${balance.toFixed(5)}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Minimum to resume</p>
            <p className="font-mono text-base font-bold text-foreground">${need.toFixed(5)}</p>
          </div>
          <div className="rounded-lg border border-border bg-background/50 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</p>
            <StatusBadge status="failed" label="402 Payment Required" />
          </div>
        </div>
        {vaultAddress ? (
          <div className="flex items-center gap-2">
            <code className="block flex-1 break-all rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {vaultAddress}
            </code>
            <CopyButton value={vaultAddress} size="icon" variant="outline" label="Copy vault address" />
          </div>
        ) : null}
        <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
          <li>Send USDT to the RevenueVault on Polygon (≥ {MIN_CONFIRMATIONS} confirmations).</li>
          <li>Paste the transaction hash on the Deposit page to claim credits.</li>
          <li>Re-send your request — it will be billed again normally.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href="/satelink/os/deposit">Add Credits →</a>
          </Button>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Re-check balance
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Onboarding progress strip (Task 7) ---------- */
export interface OnboardingState {
  hasKey: boolean;
  deposited: boolean;
  firstRequest: boolean;
  firstDeduction: boolean;
  active: boolean;
}

const STEPS = [
  { key: "hasKey", label: "API Key", icon: KeyRound, hint: "create a key" },
  { key: "deposited", label: "Deposit", icon: Wallet, hint: "fund USDT credits" },
  { key: "firstRequest", label: "First Request", icon: Send, hint: "call the gateway" },
  { key: "firstDeduction", label: "First Deduction", icon: Coins, hint: "credits billed" },
  { key: "active", label: "Active Customer", icon: CircleCheck, hint: "live & spending" },
] as const;

export function OnboardingStrip({ state, loading }: { state: OnboardingState; loading?: boolean }) {
  const done = STEPS.filter((s) => state[s.key]).length;
  const nextStep = STEPS.find((s) => !state[s.key]);
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle>Customer Zero Progress</CardTitle>
        <CardDescription>
          {loading
            ? "Checking your account…"
            : done === STEPS.length
              ? "All steps complete — you are an active customer. 🎉"
              : `${done}/${STEPS.length} complete · next: ${nextStep?.hint}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STEPS.map((s, i) => {
            const complete = state[s.key];
            const isNext = nextStep?.key === s.key;
            const Icon = complete ? CircleCheck : s.icon;
            return (
              <div
                key={s.key}
                className={
                  "flex flex-col gap-1.5 rounded-lg border p-3 transition-colors " +
                  (complete
                    ? "border-success/40 bg-success/5"
                    : isNext
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-background/40")
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Step {i + 1}
                  </span>
                  <Icon className={"size-4 " + (complete ? "text-success" : isNext ? "text-primary" : "text-muted-foreground")} />
                </div>
                <span className="text-sm font-semibold text-foreground">{s.label}</span>
                {complete ? (
                  <Badge variant="success" className="w-fit">Done</Badge>
                ) : isNext ? (
                  <Badge variant="default" className="w-fit">Next</Badge>
                ) : (
                  <Badge variant="neutral" className="w-fit">Pending</Badge>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
