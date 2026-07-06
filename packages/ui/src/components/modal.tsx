"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
} from "./ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "../lib/utils";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Right-aligned action row (8px gap). Put the primary action LAST. */
  footer?: React.ReactNode;
  className?: string;
  showCloseButton?: boolean;
}

/**
 * Modal — the ONLY dialog surface for OS/admin screens.
 *
 * Exists because ad-hoc modals shipped transparent over page content (the
 * production Create-API-Key bug): Tailwind semantic color classes can fail to
 * resolve inside the `.satelink-os` scope, silently dropping the background.
 * The surface + overlay colors here are inline `hsl(var(--…))` styles, which
 * always resolve against theme.css — the panel can never render transparent.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  showCloseButton = true,
}: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay
          className="backdrop-blur-sm"
          style={{ backgroundColor: "rgb(0 0 0 / 0.6)" }}
        />
        <DialogPrimitive.Content
          data-slot="modal-content"
          style={{
            backgroundColor: "hsl(var(--popover))",
            borderColor: "hsl(var(--border))",
          }}
          className={cn(
            // Radix portals mount at document.body — OUTSIDE the .satelink-os
            // token scope. Carry the scope class here so every var resolves;
            // without it the surface color is undefined → transparent modal.
            "satelink-os",
            "fixed top-[50%] left-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border p-6 shadow-xl duration-200",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            className
          )}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {footer ? (
            <div className="flex items-center justify-end gap-2 pt-1">{footer}</div>
          ) : null}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:outline-hidden"
            >
              <XIcon className="size-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
