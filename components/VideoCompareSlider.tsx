"use client";

import { useCallback, useRef, useState, useEffect } from "react";

interface VideoCompareSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
}

export function VideoCompareSlider({
  beforeUrl,
  afterUrl,
  beforeLabel = "Original",
  afterLabel = "Escalado",
}: VideoCompareSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Sync: before is the master, after follows
  const onBeforeTimeUpdate = useCallback(() => {
    const v = beforeRef.current;
    if (v) setCurrentTime(v.currentTime);
  }, []);

  const onBeforeLoaded = useCallback(() => {
    const v = beforeRef.current;
    if (v) setDuration(v.duration);
  }, []);

  // Keep after video in sync with before
  useEffect(() => {
    const before = beforeRef.current;
    const after = afterRef.current;
    if (!before || !after) return;

    const sync = () => {
      if (Math.abs(after.currentTime - before.currentTime) > 0.1) {
        after.currentTime = before.currentTime;
      }
    };
    const onPlay = () => {
      after.play().catch(() => {});
      setPlaying(true);
    };
    const onPause = () => {
      after.pause();
      setPlaying(false);
    };
    const onSeek = () => {
      after.currentTime = before.currentTime;
    };

    before.addEventListener("play", onPlay);
    before.addEventListener("pause", onPause);
    before.addEventListener("seeking", onSeek);
    before.addEventListener("timeupdate", sync);
    return () => {
      before.removeEventListener("play", onPlay);
      before.removeEventListener("pause", onPause);
      before.removeEventListener("seeking", onSeek);
      before.removeEventListener("timeupdate", sync);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const v = beforeRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }, []);

  const seek = useCallback((pct: number) => {
    const v = beforeRef.current;
    if (!v || !v.duration) return;
    v.currentTime = (pct / 100) * v.duration;
    setCurrentTime(v.currentTime);
  }, []);

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

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const progressPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Video compare area */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden border border-[var(--border)] bg-black select-none min-h-0"
        onMouseDown={(e) => {
          handleMove(e.clientX);
          setDragging(true);
        }}
        onTouchStart={(e) => {
          handleMove(e.touches[0].clientX);
          setDragging(true);
        }}
      >
        {/* After (background, full) */}
        <video
          ref={afterRef}
          src={afterUrl}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          muted
        />
        <span className="absolute right-3 top-3 z-10 bg-black/70 px-2 py-1 text-xs font-mono text-[var(--accent)] backdrop-blur-sm">
          {afterLabel}
        </span>

        {/* Before (clipped via clip-path) */}
        <video
          ref={beforeRef}
          src={beforeUrl}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          muted
          onTimeUpdate={onBeforeTimeUpdate}
          onLoadedMetadata={onBeforeLoaded}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <span
          className="absolute left-3 top-3 z-10 bg-black/70 px-2 py-1 text-xs font-mono text-white/70 backdrop-blur-sm"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          {beforeLabel}
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

      {/* Custom player controls */}
      <div className="flex items-center gap-3 px-1">
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text)] hover:text-[var(--accent)] transition-colors"
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Time */}
        <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Seek bar */}
        <div
          className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-[var(--surface-2)]"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * 100);
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
            style={{ width: `${progressPct}%` }}
          />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
