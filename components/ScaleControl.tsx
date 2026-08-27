"use client";

import { useMemo } from "react";
import { getScaleInfo, getQualityInfo } from "@/lib/websr";
import type { ScaleFactor, QualityInfo } from "@/types";

interface ScaleControlProps {
  scale: ScaleFactor;
  onScaleChange: (scale: ScaleFactor) => void;
  /** Dimensiones originales para mostrar advertencias de GPU memory */
  sourceDims?: { w: number; h: number } | null;
  /** Presets rápidos. Default: [2, 4, 8] */
  presets?: number[];
  /** Escala mínima del slider. Default: 1.5 */
  min?: number;
  /** Escala máxima del slider. Default: 8 */
  max?: number;
}

const DEFAULT_PRESETS = [2, 4, 8];
const DEFAULT_MIN = 1.5;
const DEFAULT_MAX = 8;

export function ScaleControl({
  scale,
  onScaleChange,
  sourceDims,
  presets = DEFAULT_PRESETS,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
}: ScaleControlProps) {
  const info = useMemo(() => getScaleInfo(scale), [scale]);
  const quality = getQualityInfo(info.tier);

  // Estimación de memoria GPU: 4 bytes por pixel × area × un factor de overhead
  // WebSR mantiene buffers de entrada y salida simultáneamente
  const gpuWarning = useMemo(() => {
    if (!sourceDims) return null;
    const outPixels = sourceDims.w * sourceDims.h * scale * scale;
    // ~16 bytes por pixel (RGBA float en GPU + buffers intermedios)
    const estMB = (outPixels * 16) / (1024 * 1024);
    if (estMB > 512) return "Puede saturar la GPU. Riesgo de crash en GPU integrada.";
    if (estMB > 256) return "Alto consumo de GPU memory. Monitoreá el rendimiento.";
    return null;
  }, [sourceDims, scale]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--text-muted)] shrink-0">Escala:</span>

        {/* Presets */}
        <div className="flex items-center gap-1.5">
          {presets.map((s) => (
            <button
              key={s}
              onClick={() => onScaleChange(s)}
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

        {/* Slider custom */}
        <div className="flex items-center gap-2 flex-1 min-w-[120px]">
          <input
            type="range"
            min={min}
            max={max}
            step={0.5}
            value={scale}
            onChange={(e) => onScaleChange(parseFloat(e.target.value))}
            className="flex-1"
            aria-label="Escala personalizada"
          />
          <input
            type="number"
            min={1}
            max={max}
            step={0.5}
            value={scale}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v) && v >= 1 && v <= max) onScaleChange(v);
            }}
            className="w-16 bg-[var(--surface-2)] border border-[var(--border)] px-2 py-1 text-sm font-mono text-center text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            aria-label="Valor de escala"
          />
        </div>
      </div>

      {/* Quality badge + info */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 font-mono"
          style={{ color: quality.color }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: quality.color }}
          />
          {quality.label}
        </span>
        <span className="text-[var(--text-muted)]">
          {info.passes} {info.passes === 1 ? "pasada" : "pasadas"} de 2x
          {info.needsResize ? ` + resize a ${scale}x` : ""}
        </span>
        {sourceDims && (
          <span className="font-mono text-[var(--text-muted)]">
            → {Math.round(sourceDims.w * scale)}×{Math.round(sourceDims.h * scale)}
          </span>
        )}
      </div>

      {/* Description de calidad */}
      <p className="text-xs text-[var(--text-muted)]">{quality.description}</p>

      {/* GPU memory warning */}
      {gpuWarning && (
        <p className="text-xs text-[var(--danger)] flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01" />
          </svg>
          {gpuWarning}
        </p>
      )}
    </div>
  );
}
