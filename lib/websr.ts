import type { NetworkOption, ContentMode, ScaleInfo, QualityTier, QualityInfo } from "@/types";

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
 * Calcula la estructura de pasadas para una escala arbitraria.
 *
 * La red neural solo sabe hacer 2x. Para escalas mayores se aplica en cascada:
 *   - 2x → 1 pasada (2x)
 *   - 4x → 2 pasadas (2x → 2x)
 *   - 8x → 3 pasadas (2x → 2x → 2x)
 *   - 3x → 2 pasadas (2x → 2x = 4x) + resize a 3x
 *   - 6x → 3 pasadas (2x → 2x → 2x = 8x) + resize a 6x
 *
 * Cada pasada duplica el consumo de GPU memory y suma tiempo.
 */
export function getScaleInfo(scale: number): ScaleInfo {
  if (scale <= 1) {
    return { passes: 0, aiScale: 1, needsResize: false, tier: "optimal" };
  }

  // Redondear hacia arriba a la potencia de 2 más cercana
  const passes = Math.ceil(Math.log2(scale));
  const aiScale = Math.pow(2, passes);
  const needsResize = aiScale !== scale;

  let tier: QualityTier;
  if (passes <= 1) {
    tier = "optimal";
  } else if (passes === 2) {
    tier = "good";
  } else if (passes === 3) {
    tier = "acceptable";
  } else {
    tier = "extreme";
  }

  return { passes, aiScale, needsResize, tier };
}

const qualityInfo: Record<QualityTier, QualityInfo> = {
  optimal: {
    label: "Óptimo",
    color: "var(--success)",
    description: "1 pasada de la red neural. Calidad nativa, sin artefactos.",
  },
  good: {
    label: "Bueno",
    color: "var(--accent)",
    description: "2 pasadas en cascada. Artefactos mínimos. Recomendado para 4x.",
  },
  acceptable: {
    label: "Aceptable",
    color: "#e89d3d",
    description: "3 pasadas. La red inventa detalles. Puede haber artefactos en texturas complejas.",
  },
  extreme: {
    label: "Extremo",
    color: "var(--danger)",
    description: "4+ pasadas. Alto riesgo de artefactos y saturación de GPU. Experimental.",
  },
};

export function getQualityInfo(tier: QualityTier): QualityInfo {
  return qualityInfo[tier];
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
