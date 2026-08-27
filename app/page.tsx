"use client";

import { useState } from "react";
import { TabSwitcher, type Tab } from "@/components/TabSwitcher";
import { ImageUpscaler } from "@/components/ImageUpscaler";
import { VideoUpscaler } from "@/components/VideoUpscaler";

export default function Home() {
  const [tab, setTab] = useState<Tab>("image");

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">
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

      {/* Main */}
      <main className="mx-auto max-w-5xl px-6 py-12">
        {/* Intro */}
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Escalá imágenes y video con tu GPU.
            <br />
            <span className="text-[var(--text-muted)]">
              Gratis, sin servidor, sin upload.
            </span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
            Una red neural corre en los Tensor Cores de tu placa de video via
            WebGPU. El video nunca sale de tu navegador. Necesitás Chrome 113+,
            Edge 113+, o cualquier navegador con soporte WebGPU.
          </p>
        </div>

        {/* Tabs */}
        <div className="border border-[var(--border)] bg-[var(--surface)]">
          <TabSwitcher active={tab} onChange={setTab} />
          <div className="p-6">
            {tab === "image" && <ImageUpscaler />}
            {tab === "video" && <VideoUpscaler />}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-muted)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <p>
              Todo el procesamiento ocurre en tu GPU local. Cero costos de
              servidor. Build con Next.js + WebSR SDK + WebCodecs.
            </p>
            <p className="font-mono">
              $0.00 / mes · 0 bytes subidos · ∞ escalados
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
