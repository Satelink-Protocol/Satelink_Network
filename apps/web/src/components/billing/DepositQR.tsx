"use client";

import { QRCodeSVG } from "qrcode.react";

/**
 * Renders a wallet-scannable QR for the RevenueVault deposit address. The QR is
 * generated locally as an SVG (no external image service), keeping the deposit
 * flow entirely inside Satelink OS.
 */
export function DepositQR({ address, size = 148 }: { address: string; size?: number }) {
  if (!address) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-lg border border-border bg-white p-3">
        <QRCodeSVG value={address} size={size} level="M" marginSize={0} />
      </div>
      <p className="text-center text-[10px] text-muted-foreground">Scan to send USDT (Polygon)</p>
    </div>
  );
}
