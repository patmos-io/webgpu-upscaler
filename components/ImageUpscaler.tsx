"use client";

import { useCallback, useRef, useState } from "react";
import { useImageUpscaler } from "@/lib/use-image-upscaler";
import { formatBytes, formatMs, isWebGPUSupported } from "@/lib/websr";
import type { ScaleFactor } from "@/types";

export function ImageUpscaler() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState<ScaleFactor>(2);
  const [dragActive, setDragActive] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<number>(0);
  const [sourceDims, setSourceDims] = useState<{
    w: number;
    h: number;
  } | null>(null);

  const { status, error, result, processTime, upscale, reset, webgpuSupported } =
    useImageUpscaler({ canvasRef });

  const webgpu = typeof window !== "undefined" ? isWebGPUSupported() : false;

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      const url = URL.createObjectURL(file);
      setSourceUrl(url);
      setSourceSize(file.size);

      // Medir dimensiones
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
    await upscale(bitmap, scale);
  }, [sourceUrl, scale, upscale]);

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
    setSourceSize(0);
    reset();
  }, [sourceUrl, reset]);

  return (
    <div className="space-y-6 fade-in">
      {/* WebGPU warning */}
      {!webgpu && (
        <div className="border border-[var(--danger)] bg-[rgba(232,93,93,0.08)] px-4 py-3 text-sm text-[var(--danger)]">
          Tu navegador no soporta WebGPU. Usá Chrome 113+ o Edge 113+ para usar
          esta herramienta.
        </div>
      )}

      {/* Upload zone */}
      {!sourceUrl && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[var(--border)] py-20 px-6 text-center cursor-pointer transition-colors hover:border-[var(--accent-dim)] ${
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
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-[var(--text-muted)]"
          >
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
      )}

      {/* Source + Result */}
      {sourceUrl && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Original */}
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Original
                </span>
                {sourceDims && (
                  <span className="font-mono text-xs text-[var(--text-muted)]">
                    {sourceDims.w}×{sourceDims.h} · {formatBytes(sourceSize)}
                  </span>
                )}
              </div>
              <div className="border border-[var(--border)] bg-[var(--surface)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sourceUrl}
                  alt="Original"
                  className="max-h-[300px] w-full object-contain"
                />
              </div>
            </div>

            {/* Upscaled */}
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Escalado
                </span>
                {result && (
                  <span className="font-mono text-xs text-[var(--accent)]">
                    {result.width}×{result.height} ·{" "}
                    {formatBytes(result.blob.size)}
                  </span>
                )}
              </div>
              <div className="border border-[var(--border)] bg-[var(--surface)] p-2">
                <canvas
                  ref={canvasRef}
                  className="max-h-[300px] w-full object-contain canvas-wrapper"
                />
                {status === "processing" && (
                  <div className="flex items-center justify-center py-12 text-sm text-[var(--text-muted)]">
                    Procesando en tu GPU…
                  </div>
                )}
                {status === "idle" && (
                  <div className="flex items-center justify-center py-12 text-sm text-[var(--text-muted)]">
                    Listo para escalar
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-4 border-t border-[var(--border)] pt-4">
            <div className="flex items-center gap-6">
              {/* Scale selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-muted)]">Escala:</span>
                {[2, 4].map((s) => (
                  <button
                    key={s}
                    onClick={() => setScale(s as ScaleFactor)}
                    className={`px-3 py-1.5 text-sm font-mono transition-colors ${
                      scale === s
                        ? "bg-[var(--accent)] text-[var(--bg)]"
                        : "bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              {/* Process time */}
              {processTime !== null && status === "done" && (
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  Procesado en {formatMs(processTime)}
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {status !== "processing" && (
                <button
                  onClick={handleProcess}
                  disabled={!sourceUrl}
                  className="px-6 py-2.5 bg-[var(--accent)] text-[var(--bg)] text-sm font-medium transition-colors hover:bg-[var(--accent-dim)] disabled:opacity-40"
                >
                  Escalar {scale}x
                </button>
              )}
              {status === "processing" && (
                <button
                  disabled
                  className="px-6 py-2.5 bg-[var(--surface-2)] text-[var(--text-muted)] text-sm font-medium"
                >
                  Procesando…
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

            {/* Error */}
            {error && (
              <div className="border border-[var(--danger)] bg-[rgba(232,93,93,0.08)] px-4 py-2 text-sm text-[var(--danger)]">
                {error}
              </div>
            )}
          </div>
        </div>
      )}

      {/* How it works */}
      {!sourceUrl && webgpu && (
        <div className="grid grid-cols-1 gap-6 border-t border-[var(--border)] pt-6 md:grid-cols-3">
          <div>
            <span className="font-mono text-xs text-[var(--accent)]">01</span>
            <p className="mt-2 text-sm text-[var(--text)]">
              Subís una imagen o video. Nada se sube a un servidor — todo queda
              en tu navegador.
            </p>
          </div>
          <div>
            <span className="font-mono text-xs text-[var(--accent)]">02</span>
            <p className="mt-2 text-sm text-[var(--text)]">
              Una red neural corre en tu GPU local via WebGPU. Los Tensor Cores
              de tu placa hacen el trabajo pesado.
            </p>
          </div>
          <div>
            <span className="font-mono text-xs text-[var(--accent)]">03</span>
            <p className="mt-2 text-sm text-[var(--text)]">
              Descargás el resultado. Sin marca de agua, sin límites, sin
              registro. El costo de cómputo es cero para nosotros.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
