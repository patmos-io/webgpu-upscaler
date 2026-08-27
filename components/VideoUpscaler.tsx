"use client";

import { useCallback, useRef, useState } from "react";
import { useVideoUpscaler } from "@/lib/use-video-upscaler";
import { formatBytes } from "@/lib/websr";
import type { ScaleFactor } from "@/types";

const phaseLabels: Record<string, string> = {
  demuxing: "Leyendo video",
  decoding: "Decodificando frames",
  upscaling: "Upscaling con AI",
  encoding: "Codificando resultado",
  muxing: "Generando MP4",
  done: "Listo",
};

export function VideoUpscaler() {
  const [scale, setScale] = useState<ScaleFactor>(2);
  const [dragActive, setDragActive] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  const { status, error, progress, resultUrl, upscale, reset } =
    useVideoUpscaler();

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/")) return;
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setSourceFile(file);
      setSourceUrl(URL.createObjectURL(file));
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

  const handleProcess = useCallback(() => {
    if (!sourceFile) return;
    upscale(sourceFile, scale);
  }, [sourceFile, scale, upscale]);

  const handleDownload = useCallback(() => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `upscaled-${scale}x.mp4`;
    a.click();
  }, [resultUrl, scale]);

  const handleReset = useCallback(() => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setSourceFile(null);
    setSourceUrl(null);
    reset();
  }, [sourceUrl, resultUrl, reset]);

  return (
    <div className="space-y-6 fade-in">
      {/* Upload zone */}
      {!sourceUrl && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[var(--border)] py-32 px-6 text-center cursor-pointer transition-colors hover:border-[var(--accent-dim)] ${
            dragActive ? "drag-active" : ""
          }`}
        >
          <input
            type="file"
            accept="video/*"
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
              Arrastrá un video o hacé clic para subir
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              MP4, WebM — se procesa 100% en tu navegador con WebCodecs + WebGPU
            </p>
          </div>
        </label>
      )}

      {/* Source preview + controls */}
      {sourceUrl && (
        <div className="space-y-6">
          {/* Source video */}
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Video original
              </span>
              {sourceFile && (
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {formatBytes(sourceFile.size)}
                </span>
              )}
            </div>
            <div className="border border-[var(--border)] bg-[var(--surface)] p-2">
              <video
                src={sourceUrl}
                controls
                className="max-h-[60vh] w-full object-contain"
              />
            </div>
          </div>

          {/* Progress */}
          {status === "processing" && progress && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-[var(--text)]">
                  {phaseLabels[progress.phase] || progress.phase}
                </span>
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {progress.framesProcessed} frames
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden bg-[var(--surface-2)]">
                <div
                  className="h-full bg-[var(--accent)] transition-all duration-300"
                  style={{
                    width: progress.percent
                      ? `${progress.percent}%`
                      : progress.phase === "done"
                        ? "100%"
                        : "45%",
                  }}
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Esto corre en tu GPU. Mientras más grande el video, más tarda.
                No cierres la pestaña.
              </p>
            </div>
          )}

          {/* Result */}
          {resultUrl && status === "done" && (
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--accent)]">
                Video escalado {scale}x
              </span>
              <div className="border border-[var(--border)] bg-[var(--surface)] p-2">
                <video
                  src={resultUrl}
                  controls
                  className="max-h-[60vh] w-full object-contain"
                />
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-col gap-4 border-t border-[var(--border)] pt-4">
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

            <div className="flex gap-3">
              {status !== "processing" && (
                <button
                  onClick={handleProcess}
                  disabled={!sourceFile}
                  className="px-6 py-2.5 bg-[var(--accent)] text-[var(--bg)] text-sm font-medium transition-colors hover:bg-[var(--accent-dim)] disabled:opacity-40"
                >
                  Escalar {scale}x
                </button>
              )}
              {status === "processing" && (
                <button
                  onClick={handleReset}
                  className="px-6 py-2.5 border border-[var(--danger)] text-[var(--danger)] text-sm font-medium transition-colors hover:bg-[rgba(232,93,93,0.1)]"
                >
                  Cancelar
                </button>
              )}
              {resultUrl && (
                <button
                  onClick={handleDownload}
                  className="px-6 py-2.5 border border-[var(--border)] text-[var(--text)] text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Descargar MP4
                </button>
              )}
              <button
                onClick={handleReset}
                className="px-4 py-2.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              >
                Limpiar
              </button>
            </div>

            {error && (
              <div className="border border-[var(--danger)] bg-[rgba(232,93,93,0.08)] px-4 py-2 text-sm text-[var(--danger)]">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
