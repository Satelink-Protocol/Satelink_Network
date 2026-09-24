"use client";
// Full-width product walkthrough band (claude.com pattern). Autoplays muted
// and looped with a visible pause control; on Save-Data connections or under
// prefers-reduced-motion it waits for a tap instead. Captions are always
// attached. Renders nothing unless a real recording is registered in
// src/lib/media.ts.
import * as React from "react";
import { Pause, Play } from "lucide-react";
import type { ProductVideo as Media } from "@/lib/media";

export function ProductVideo({ media }: { media: Media | null }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (reduced || saveData) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().catch(() => undefined);
      else v.pause();
    }, { threshold: 0.35 });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  if (!media) return null;

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  };

  return (
    <section aria-labelledby="walkthrough" className="border-b border-sl-border">
      <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 md:py-20">
        <h2 id="walkthrough" className="sr-only">Product walkthrough</h2>
        <div className="relative overflow-hidden rounded-[var(--sl-radius-lg)] border border-sl-border bg-sl-surface shadow-[var(--sl-shadow-2)]">
          <video
            ref={ref}
            className="block aspect-video w-full"
            muted
            loop
            playsInline
            preload="none"
            poster={media.poster}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            aria-describedby="walkthrough-caption"
          >
            <source src={media.webm} type="video/webm" />
            <source src={media.mp4} type="video/mp4" />
            <track kind="captions" src={media.captions} srcLang="en" label="English" default />
          </video>
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause walkthrough video" : "Play walkthrough video"}
            className="absolute bottom-3 right-3 inline-flex size-10 items-center justify-center rounded-full border border-sl-border bg-sl-surface/90 text-sl-text backdrop-blur hover:bg-sl-surface"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
        </div>
        <p id="walkthrough-caption" className="mt-3 text-sm text-sl-text-muted">
          The real Satelink console, recorded {media.recordedOn} with a test account: create an agent key, run a Trading
          Intelligence query, see usage and the receipt. Test data, not a customer.
        </p>
      </div>
    </section>
  );
}
