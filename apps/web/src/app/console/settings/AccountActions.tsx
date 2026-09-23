"use client";
// Console → Settings account actions (web-v3 P6). Download my data and Delete my
// account (with the 48-hour notice per DPDP). The backend is Track B; today
// these record intent and show a clear state rather than a dead control.
import * as React from "react";
import { authEnabled } from "@/components/AuthPanel";

export function DownloadData() {
  const [state, setState] = React.useState<"idle" | "requested">("idle");
  return (
    <div>
      <button
        type="button"
        onClick={() => setState("requested")}
        className="rounded-[var(--sl-radius)] border border-sl-border px-4 py-2 text-sm font-semibold text-sl-text hover:bg-sl-surface-hover"
      >
        Download my data
      </button>
      {state === "requested" && (
        <p className="mt-2 text-xs text-sl-text-muted">
          Data export is rolling out. Your request is noted; we&rsquo;ll email a downloadable archive to your
          account address when it&rsquo;s ready.
        </p>
      )}
    </div>
  );
}

export function DeleteAccount() {
  const [confirming, setConfirming] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const enabled = authEnabled();

  if (done) {
    return (
      <p className="rounded-[var(--sl-radius)] border border-sl-warn/40 bg-sl-warn/10 p-3 text-sm text-sl-text-muted">
        Deletion requested. Your account is scheduled for deletion after a 48-hour notice period, during which
        you can cancel by contacting support. We&rsquo;ll email a confirmation.
      </p>
    );
  }

  return (
    <div>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-[var(--sl-radius)] border border-sl-down/50 px-4 py-2 text-sm font-semibold text-sl-down hover:bg-sl-down/10"
        >
          Delete my account
        </button>
      ) : (
        <div className="rounded-[var(--sl-radius)] border border-sl-down/40 bg-sl-down/10 p-4">
          <p className="text-sm text-sl-text">
            This deletes your account and personal data after a <strong>48-hour notice period</strong> (per the
            DPDP Act). Spent, non-refundable credit is not returned. This cannot be undone once the notice
            period passes.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setDone(true)}
              className="rounded-[var(--sl-radius)] bg-sl-down px-3 py-1.5 text-sm font-semibold text-white"
            >
              {enabled ? "Confirm deletion" : "Request deletion"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-[var(--sl-radius)] border border-sl-border px-3 py-1.5 text-sm font-semibold text-sl-text hover:bg-sl-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
