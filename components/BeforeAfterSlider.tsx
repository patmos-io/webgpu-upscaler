"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  beforeDims?: { w: number; h: number };
  afterDims?: { w: number; h: number };
}

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Original",
  afterLabel = "Upscaled",
  beforeDims,
  afterDims,
}: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);

  const handleMove = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.max(0, Math.min(100, pct)));
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouch = (e: TouchEvent) => handleMove(e.touches[0].clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouch);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging, handleMove]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden border border-[var(--border)] bg-black select-none"
      style={{ minHeight: "200px" }}
      onMouseDown={(e) => {
        // Click anywhere on the image to move the slider there
        handleMove(e.clientX);
        setDragging(true);
      }}
      onTouchStart={(e) => {
        handleMove(e.touches[0].clientX);
        setDragging(true);
      }}
    >
      {/* After (full, background) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt={afterLabel}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
      <span className="absolute right-3 top-3 z-10 bg-[var(--bg)]/80 px-2 py-1 text-xs font-mono text-[var(--accent)] backdrop-blur-sm">
        {afterLabel}
        {afterDims && ` ${afterDims.w}×${afterDims.h}`}
      </span>

      {/* Before (clipped via clip-path — no deformation) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={beforeUrl}
        alt={beforeLabel}
        className="absolute inset-0 h-full w-full object-contain"
        style={{
          clipPath: `inset(0 ${100 - position}% 0 0)`,
        }}
        draggable={false}
      />
      <span
        className="absolute left-3 top-3 z-10 bg-[var(--bg)]/80 px-2 py-1 text-xs font-mono text-[var(--text-muted)] backdrop-blur-sm"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {beforeLabel}
        {beforeDims && ` ${beforeDims.w}×${beforeDims.h}`}
      </span>

      {/* Slider line + handle */}
      <div
        className="absolute top-0 bottom-0 z-20 w-0.5 bg-[var(--accent)] pointer-events-none"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      >
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border-2 border-[var(--accent)] bg-[var(--bg)] shadow-lg pointer-events-auto cursor-ew-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(true);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragging(true);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent)]">
            <path d="M8 18L4 12l4-6M16 6l4 6-4 6" />
          </svg>
        </div>
      </div>
    </div>
  );
}
