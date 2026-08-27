import type { NetworkOption, ContentMode } from "@/types";

/**
 * Redes neuronales disponibles para upscaling.
 *
 * WebSR incluye arquitecturas Anime4K (CNN) optimizadas para WebGPU.
 * Los pesos se hostean localmente en /public/weights/ descargados del
 * repo oficial: https://github.com/sb2702/websr/tree/main/weights/anime4k
 *
 * Variantes:
 *   - an (anime) — optimizado para contenido 2D/animación
 *   - rl (real life) — optimizado para foto/video real
 *
 * Tamaños:
 *   - l (large) — mejor calidad, más lento. Ideal para imágenes estáticas.
 *   - s (small) — rápido, buena calidad. Mejor para video.
 */
export const NETWORKS: Record<ContentMode, NetworkOption[]> = {
  anime: [
    {
      name: "anime4k/cnn-2x-l",
      label: "Anime4K CNN-L (2x)",
      description: "Mejor calidad, más lento. Ideal para imágenes estáticas.",
      weightUrl: "/weights/cnn-2x-l-an.json",
    },
    {
      name: "anime4k/cnn-2x-s",
      label: "Anime4K CNN-S (2x)",
      description: "Rápido, buena calidad. Mejor para video en tiempo real.",
      weightUrl: "/weights/cnn-2x-s-an.json",
    },
  ],
  real: [
    {
      name: "anime4k/cnn-2x-l",
      label: "RealLife CNN-L (2x)",
      description: "Mejor calidad para fotos. Más lento.",
      weightUrl: "/weights/cnn-2x-l-rl.json",
    },
    {
      name: "anime4k/cnn-2x-s",
      label: "RealLife CNN-S (2x)",
      description: "Rápido para video real. Buena calidad.",
      weightUrl: "/weights/cnn-2x-s-rl.json",
    },
  ],
};

/**
 * Devuelve la red adecuada según el modo de contenido.
 */
export function getNetwork(mode: ContentMode, fast: boolean): NetworkOption {
  return NETWORKS[mode][fast ? 1 : 0];
}

/**
 * Verifica si el navegador soporta WebGPU.
 * No se puede llamar en SSR — solo desde useEffect.
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Formatea bytes a una unidad legible.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Formatea milisegundos a segundos legibles.
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
