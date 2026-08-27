import type { NetworkOption } from "@/types";

/**
 * Redes neuronales disponibles para upscaling.
 *
 * WebSR incluye arquitecturas Anime4K (CNN) optimizadas para WebGPU.
 * Los pesos se cargan desde el CDN de katana.video (el del case study de web.dev).
 * Si eso cae, se pueden hostear localmente en /public/weights/.
 */
export const NETWORKS: NetworkOption[] = [
  {
    name: "anime4k/cnn-2x-l",
    label: "Anime4K CNN-L (2x)",
    description: "Mejor calidad, más lento. Ideal para imágenes estáticas.",
    weightUrl: "https://katana.video/files/cnn-2x-lg-2d-animation.json",
  },
  {
    name: "anime4k/cnn-2x-s",
    label: "Anime4K CNN-S (2x)",
    description: "Rápido, buena calidad. Mejor para video en tiempo real.",
    weightUrl: "https://katana.video/files/cnn-2x-s-2d-animation.json",
  },
];

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
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
