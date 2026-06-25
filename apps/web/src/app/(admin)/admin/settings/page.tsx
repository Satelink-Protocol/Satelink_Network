"use client";

import { useState } from "react";
import { Save, RefreshCw, ShieldAlert, Cpu, Settings2, Trash2 } from "lucide-react";
import {
  Button,
  Input,
  KPIGrid,
  StatCard,
  DashboardSection,
  Badge,
} from "@satelink/ui";

export default function AdminSettingsPage() {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    freeLimit: "500",
    epochThreshold: "0.5",
    gasAlarm: "0.05",
    cacheTtl: "3600",
    strictShield: true,
    throttleEnabled: true,
  });

  const [message, setMessage] = useState<string | null>(null);

  const handleSave = () => {
    setSaving(true);
    setMessage(null);
    setTimeout(() => {
      setSaving(false);
      setMessage("Configuration updated successfully. Settings synced with all API nodes.");
      setTimeout(() => setMessage(null), 5000);
    }, 1000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <KPIGrid columns={3}>
        <StatCard
          label="Strict Shield Mode"
          value={formData.strictShield ? "ACTIVE" : "INACTIVE"}
          caption="Protects gateway against unknown scanners"
          icon={ShieldAlert}
          accent={formData.strictShield}
        />
        <StatCard
          label="Epoch Threshold"
          value={`${formData.epochThreshold} USDT`}
          caption="Triggers blockchain settlement run"
          icon={Settings2}
        />
        <StatCard
          label="Active Node Throttle"
          value={formData.throttleEnabled ? "ENABLED" : "DISABLED"}
          caption="Enforces rate limits on RPC clients"
          icon={Cpu}
          accent={formData.throttleEnabled}
        />
      </KPIGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DashboardSection
          title="Rate Limits & Epoch Policies"
          description="Enforce global policies across satelink API gateways"
        >
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 block">Free Tier Daily Limit (calls/IP)</label>
              <Input
                type="number"
                value={formData.freeLimit}
                onChange={(e) => setFormData((prev) => ({ ...prev, freeLimit: e.target.value }))}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Applies to unauthenticated requests from public clients.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 block">Epoch Accumulator Settlement Threshold (USDT)</label>
              <Input
                type="number"
                step="0.01"
                value={formData.epochThreshold}
                onChange={(e) => setFormData((prev) => ({ ...prev, epochThreshold: e.target.value }))}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Minimum credit usage accumulated across the network before triggering settlement.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 block">EVM Hot Signer Gas Balance Warning Alarm (POL)</label>
              <Input
                type="number"
                step="0.01"
                value={formData.gasAlarm}
                onChange={(e) => setFormData((prev) => ({ ...prev, gasAlarm: e.target.value }))}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Alerts the on-call engineer when the hot signer drops below this gas level.</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 block">Global Cache Expiration Time (seconds)</label>
              <Input
                type="number"
                value={formData.cacheTtl}
                onChange={(e) => setFormData((prev) => ({ ...prev, cacheTtl: e.target.value }))}
                className="font-mono text-xs"
              />
            </div>
          </div>
        </DashboardSection>

        <DashboardSection
          title="Security Policies & Flags"
          description="Configure real-time threat overrides and gateways flags"
        >
          <div className="space-y-6 p-4">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-zinc-300 block">Strict IP Shield Mode</span>
                <span className="text-[10px] text-muted-foreground">Blocks all crawl classifications and suspicious user-agents instantly.</span>
              </div>
              <Button
                variant={formData.strictShield ? "default" : "outline"}
                size="sm"
                onClick={() => setFormData((prev) => ({ ...prev, strictShield: !prev.strictShield }))}
              >
                {formData.strictShield ? "Enabled" : "Disabled"}
              </Button>
            </div>

            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-zinc-300 block">Gateway Rate Limiter Throttling</span>
                <span className="text-[10px] text-muted-foreground">Enable active request limits for public free tiers. Turn off to handle spike events.</span>
              </div>
              <Button
                variant={formData.throttleEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => setFormData((prev) => ({ ...prev, throttleEnabled: !prev.throttleEnabled }))}
              >
                {formData.throttleEnabled ? "Active" : "Bypassed"}
              </Button>
            </div>

            <div className="pt-4 flex flex-col gap-2">
              <span className="text-xs font-semibold text-red-400 block">Dangerous Operations</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => alert("Clearing memory caches... Done.")} className="text-rose-400 hover:bg-rose-500/10">
                  Clear Cache Stores
                </Button>
                <Button variant="outline" size="sm" onClick={() => alert("Re-syncing with Polygon indexer... Done.")}>
                  Re-Index Smart Contracts
                </Button>
              </div>
            </div>
          </div>
        </DashboardSection>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        {message ? (
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 px-3 py-1 text-xs">
            {message}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Configure with care. Changes take effect across all gateway pools immediately.</span>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save System Configuration
        </Button>
      </div>
    </div>
  );
}
