"use client";

import { useState } from "react";

type Tab = "image" | "video";

interface TabSwitcherProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function TabSwitcher({ active, onChange }: TabSwitcherProps) {
  return (
    <div
      className="flex gap-1 border-b border-[var(--border)]"
      role="tablist"
      aria-label="Modo de upscaling"
    >
      <button
        role="tab"
        aria-selected={active === "image"}
        onClick={() => onChange("image")}
        className={`px-5 py-3 text-sm font-medium transition-colors ${
          active === "image"
            ? "text-[var(--accent)] border-b-2 border-[var(--accent)] -mb-px"
            : "text-[var(--text-muted)] hover:text-[var(--text)]"
        }`}
      >
        Imagen
      </button>
      <button
        role="tab"
        aria-selected={active === "video"}
        onClick={() => onChange("video")}
        className={`px-5 py-3 text-sm font-medium transition-colors ${
          active === "video"
            ? "text-[var(--accent)] border-b-2 border-[var(--accent)] -mb-px"
            : "text-[var(--text-muted)] hover:text-[var(--text)]"
        }`}
      >
        Video
      </button>
    </div>
  );
}

export type { Tab };
export function useTab() {
  return useState<Tab>("image");
}
