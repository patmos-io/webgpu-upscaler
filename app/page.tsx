"use client";

import { useState } from "react";
import { TabSwitcher, type Tab } from "@/components/TabSwitcher";
import { ImageUpscaler } from "@/components/ImageUpscaler";
import { VideoUpscaler } from "@/components/VideoUpscaler";

export default function Home() {
  const [tab, setTab] = useState<Tab>("image");

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header — slim, full width */}
      <header className="shrink-0 border-b border-[var(--border)]">
        <div className="flex items-center justify-between px-6 py-3 lg:px-8">
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-semibold tracking-tight">
              GPU Upscaler
            </h1>
            <span className="font-mono text-xs text-[var(--text-muted)]">
              WebGPU · client-side
            </span>
          </div>
          <a
            href="https://github.com/sb2702/websr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Powered by WebSR
          </a>
        </div>
      </header>

      {/* Main — fills all remaining height, no scroll on page */}
      <main className="flex-1 flex flex-col px-4 py-4 lg:px-8 lg:py-6 min-h-0 gap-4">
        {/* Intro — compact, one line */}
        <div className="shrink-0">
          <h2 className="text-xl font-semibold leading-tight tracking-tight lg:text-2xl">
            Escalá imágenes y video con tu GPU.{" "}
            <span className="text-[var(--text-muted)] font-normal">
              Gratis, sin servidor, sin upload.
            </span>
          </h2>
        </div>

        {/* Work panel — fills all remaining space */}
        <div className="flex-1 flex flex-col border border-[var(--border)] bg-[var(--surface)] min-h-0 overflow-hidden">
          <TabSwitcher active={tab} onChange={setTab} />
          <div className="flex-1 flex flex-col p-4 lg:p-6 min-h-0 overflow-y-auto">
            {tab === "image" && <ImageUpscaler />}
            {tab === "video" && <VideoUpscaler />}
          </div>
        </div>

        {/* Footer — slim */}
        <footer className="shrink-0 flex items-center justify-between text-xs text-[var(--text-muted)] py-1">
          <p>
            Todo el procesamiento ocurre en tu GPU local. Cero costos de
            servidor.
          </p>
          <p className="font-mono hidden sm:block">
            $0.00/mes · 0 bytes subidos · ∞ escalados
          </p>
        </footer>
      </main>
    </div>
  );
}
