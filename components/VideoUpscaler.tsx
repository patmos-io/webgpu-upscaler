"use client";

import { useCallback, useState } from "react";
import { useVideoUpscaler } from "@/lib/use-video-upscaler";
import { formatBytes } from "@/lib/websr";
import type { ScaleFactor } from "@/types";
import { VideoCompareSlider } from "@/components/VideoCompareSlider";
import { ScaleControl } from "@/components/ScaleControl";

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
    <div className="flex flex-col gap-4 fade-in h-full min-h-0">
      {/* === EMPTY STATE: upload fills space === */}
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
              accept="video/*"
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
                Arrastrá un video o hacé clic para subir
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                MP4, WebM — se procesa con WebCodecs + WebGPU
              </p>
            </div>
          </label>

          <div className="shrink-0 grid grid-cols-3 gap-4 text-xs">
            <div className="flex gap-2">
              <span className="font-mono text-[var(--accent)] shrink-0">01</span>
              <p className="text-[var(--text-muted)]">Subís un video. Se procesa 100% en tu navegador.</p>
            </div>
            <div className="flex gap-2">
              <span className="font-mono text-[var(--accent)] shrink-0">02</span>
              <p className="text-[var(--text-muted)]">Frame por frame se escala en tu GPU via WebGPU.</p>
            </div>
            <div className="flex gap-2">
              <span className="font-mono text-[var(--accent)] shrink-0">03</span>
              <p className="text-[var(--text-muted)]">Descargás el MP4 escalado. Sin upload, sin servidor.</p>
            </div>
          </div>
        </div>
      )}

      {/* === RESULT: compare slider fills space === */}
      {sourceUrl && resultUrl && status === "done" && (
        <>
          <div className="flex-1 min-h-0">
            <VideoCompareSlider
              beforeUrl={sourceUrl}
              afterUrl={resultUrl}
              beforeLabel="Original"
              afterLabel={`Escalado ${scale}x`}
            />
          </div>
          <p className="shrink-0 text-center text-xs text-[var(--text-muted)]">
            Arrastrá el slider para comparar
          </p>
        </>
      )}

      {/* === IDLE: preview original in compare slider === */}
      {sourceUrl && !resultUrl && status !== "processing" && (
        <>
          <div className="flex-1 min-h-0">
            <VideoCompareSlider
              beforeUrl={sourceUrl}
              afterUrl={sourceUrl}
              beforeLabel="Original"
              afterLabel="Original"
            />
          </div>
        </>
      )}

      {/* === PROCESSING: progress bar === */}
      {sourceUrl && status === "processing" && progress && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0">
          <div className="w-full max-w-md space-y-3">
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
            <p className="text-xs text-[var(--text-muted)] text-center">
              Esto corre en tu GPU. No cierres la pestaña.
            </p>
          </div>
        </div>
      )}

      {/* === CONTROLS BAR === */}
      {sourceUrl && (
        <div className="shrink-0 flex flex-col gap-3 border-t border-[var(--border)] pt-4">
          {/* Row 1: info + actions */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {sourceFile && (
                <span className="font-mono text-xs text-[var(--text-muted)]">
                  {formatBytes(sourceFile.size)}
                </span>
              )}
            </div>
            <div className="flex gap-3">
              {status !== "processing" && (
                <button
                  onClick={handleProcess}
                  className="px-6 py-2.5 bg-[var(--accent)] text-[var(--bg)] text-sm font-medium transition-colors hover:bg-[var(--accent-dim)]"
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
          </div>

          {/* Row 2: Scale control with quality indicators */}
          <ScaleControl
            scale={scale}
            onScaleChange={setScale}
            sourceDims={null}
          />

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
