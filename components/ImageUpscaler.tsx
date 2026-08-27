"use client";

import { useCallback, useRef, useState } from "react";
import { useImageUpscaler } from "@/lib/use-image-upscaler";
import { formatMs, isWebGPUSupported } from "@/lib/websr";
import type { ContentMode, ScaleFactor, UpscaleAlgorithm } from "@/types";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { ScaleControl } from "@/components/ScaleControl";

export function ImageUpscaler() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState<ScaleFactor>(2);
  const [mode, setMode] = useState<ContentMode>("real");
  const [algorithm, setAlgorithm] = useState<UpscaleAlgorithm>("lanczos");
  const [sharpen, setSharpen] = useState(0.4);
  const [dragActive, setDragActive] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceDims, setSourceDims] = useState<{ w: number; h: number } | null>(null);

  const { status, error, result, processTime, upscale, reset } =
    useImageUpscaler({ canvasRef });

  const webgpu = typeof window !== "undefined" ? isWebGPUSupported() : false;

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      const url = URL.createObjectURL(file);
      setSourceUrl(url);

      const img = new Image();
      img.src = url;
      await img.decode();
      setSourceDims({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [sourceUrl],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleProcess = useCallback(async () => {
    if (!sourceUrl) return;
    const img = new Image();
    img.src = sourceUrl;
    await img.decode();
    const bitmap = await createImageBitmap(img);
    await upscale(bitmap, scale, mode, algorithm, sharpen);
  }, [sourceUrl, scale, mode, algorithm, sharpen, upscale]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `upscaled-${sourceDims?.w}x${sourceDims?.h}-to-${result.width}x${result.height}.png`;
    a.click();
  }, [result, sourceDims]);

  const handleReset = useCallback(() => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null);
    setSourceDims(null);
    reset();
  }, [sourceUrl, reset]);

  return (
    <div className="flex flex-col gap-4 fade-in h-full min-h-0">
      {/* Canvas oculto */}
      <canvas ref={canvasRef} className="hidden" />

      {/* WebGPU warning */}
      {!webgpu && (
        <div className="shrink-0 border border-[var(--danger)] bg-[rgba(232,93,93,0.08)] px-4 py-3 text-sm text-[var(--danger)]">
          Tu navegador no soporta WebGPU. Usá Chrome 113+ o Edge 113+ para usar
          esta herramienta.
        </div>
      )}

      {/* === EMPTY STATE: upload zone fills all available space === */}
      {!sourceUrl && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex flex-1 flex-col items-center justify-center gap-4 border-2 border-dashed border-[var(--border)] text-center cursor-pointer transition-colors hover:border-[var(--accent-dim)] min-h-0 ${
              dragActive ? "drag-active" : ""
            }`}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--text)]">
                Arrastrá una imagen o hacé clic para subir
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                PNG, JPG, WebP — se procesa 100% en tu navegador
              </p>
            </div>
          </label>

          {/* How it works — compact, below upload */}
          <div className="shrink-0 grid grid-cols-3 gap-4 text-xs">
            <div className="flex gap-2">
              <span className="font-mono text-[var(--accent)] shrink-0">01</span>
              <p className="text-[var(--text-muted)]">Subís una imagen. Nada sale de tu navegador.</p>
            </div>
            <div className="flex gap-2">
              <span className="font-mono text-[var(--accent)] shrink-0">02</span>
              <p className="text-[var(--text-muted)]">Una red neural corre en tu GPU via WebGPU.</p>
            </div>
            <div className="flex gap-2">
              <span className="font-mono text-[var(--accent)] shrink-0">03</span>
              <p className="text-[var(--text-muted)]">Descargás el resultado. Sin límites, sin registro.</p>
            </div>
          </div>
        </div>
      )}

      {/* === RESULT: slider fills space, controls below === */}
      {sourceUrl && result && (
        <>
          <div className="flex-1 min-h-0">
            <BeforeAfterSlider
              beforeUrl={sourceUrl}
              afterUrl={result.url}
              beforeLabel="Original"
              afterLabel="Escalado"
              beforeDims={sourceDims ?? undefined}
              afterDims={{ w: result.width, h: result.height }}
            />
          </div>
          <p className="shrink-0 text-center text-xs text-[var(--text-muted)]">
            Arrastrá el slider para comparar
          </p>
        </>
      )}

      {/* === PROCESSING === */}
      {sourceUrl && status === "processing" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]" />
            <span className="text-sm text-[var(--text-muted)]">Procesando en tu GPU…</span>
          </div>
          <div className="h-1 w-48 overflow-hidden bg-[var(--surface-2)]">
            <div className="h-full w-1/3 animate-pulse bg-[var(--accent)]" />
          </div>
        </div>
      )}

      {/* === IDLE: source loaded, preview === */}
      {sourceUrl && status === "idle" && (
        <div className="flex-1 flex items-center justify-center min-h-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceUrl}
            alt="Original"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}

      {/* === CONTROLS BAR === */}
      {sourceUrl && (
        <div className="shrink-0 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          {/* Row 1: mode + actions */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Left: mode (only for AI) */}
            {algorithm === "ai" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-muted)]">Tipo:</span>
                {(["real", "anime"] as ContentMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-sm transition-colors ${
                      mode === m
                        ? "bg-[var(--accent)] text-[var(--bg)]"
                        : "bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {m === "real" ? "Foto" : "Anime"}
                  </button>
                ))}
              </div>
            )}

            {/* Right: actions */}
            <div className="flex gap-3">
              {status !== "processing" && (
                <button
                  onClick={handleProcess}
                  className="px-6 py-2.5 bg-[var(--accent)] text-[var(--bg)] text-sm font-medium transition-colors hover:bg-[var(--accent-dim)]"
                >
                  Escalar {scale}x
                </button>
              )}
              {result && (
                <button
                  onClick={handleDownload}
                  className="px-6 py-2.5 border border-[var(--border)] text-[var(--text)] text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Descargar PNG
                </button>
              )}
              <button
                onClick={handleReset}
                className="px-4 py-2.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                Limpiar
              </button>
            </div>
          </div>

          {/* Row 2: Scale control with quality indicators */}
          <ScaleControl
            scale={scale}
            onScaleChange={setScale}
            sourceDims={sourceDims}
            algorithm={algorithm}
            onAlgorithmChange={setAlgorithm}
            sharpen={sharpen}
            onSharpenChange={setSharpen}
          />

          {/* Row 3: metadata */}
          <div className="flex flex-wrap items-center gap-4">
            {sourceDims && (
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {sourceDims.w}×{sourceDims.h}
                {result ? ` → ${result.width}×${result.height}` : ` → ${Math.round(sourceDims.w * scale)}×${Math.round(sourceDims.h * scale)}`}
              </span>
            )}
            {processTime !== null && status === "done" && (
              <span className="font-mono text-xs text-[var(--text-muted)]">
                {formatMs(processTime)}
              </span>
            )}
          </div>

          {error && (
            <div className="w-full border border-[var(--danger)] bg-[rgba(232,93,93,0.08)] px-4 py-2 text-sm text-[var(--danger)]">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
