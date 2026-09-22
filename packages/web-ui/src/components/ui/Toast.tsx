"use client";
// Toast — sonner Toaster themed to the Satelink Signal tokens, plus a
// re-export of `toast()` for imperative use. Reads data-theme so it matches
// the active theme.
import { Toaster as SonnerToaster, toast } from "sonner";

export { toast };

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--sl-surface)",
          border: "1px solid var(--sl-border)",
          color: "var(--sl-text)",
          borderRadius: "var(--sl-radius)",
        },
      }}
    />
  );
}
