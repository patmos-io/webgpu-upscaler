import type { NetworkOption, ContentMode, ScaleInfo, QualityTier, QualityInfo } from "@/types";

/**
 * Neural networks available for upscaling.
 *
 * WebSR includes Anime4K (CNN) architectures optimized for WebGPU.
 * Weights are hosted locally in /public/weights/ downloaded from the
 * official repo: https://github.com/sb2702/websr/tree/main/weights/anime4k
 *
 * Variants:
 *   - an (anime) — optimized for 2D/animation content
 *   - rl (real life) — optimized for real photos/video
 *
 * Sizes:
 *   - l (large) — best quality, slower. Ideal for static images.
 *   - s (small) — fast, good quality. Better for video.
 */
export const NETWORKS: Record<ContentMode, NetworkOption[]> = {
  anime: [
    {
      name: "anime4k/cnn-2x-l",
      label: "Anime4K CNN-L (2x)",
      description: "Best quality, slower. Ideal for static images.",
      weightUrl: "/weights/cnn-2x-l-an.json",
    },
    {
      name: "anime4k/cnn-2x-s",
      label: "Anime4K CNN-S (2x)",
      description: "Fast, good quality. Better for real-time video.",
      weightUrl: "/weights/cnn-2x-s-an.json",
    },
  ],
  real: [
    {
      name: "anime4k/cnn-2x-l",
      label: "RealLife CNN-L (2x)",
      description: "Best quality for photos. Slower.",
      weightUrl: "/weights/cnn-2x-l-rl.json",
    },
    {
      name: "anime4k/cnn-2x-s",
      label: "RealLife CNN-S (2x)",
      description: "Fast for real video. Good quality.",
      weightUrl: "/weights/cnn-2x-s-rl.json",
    },
  ],
};

/**
 * Returns the appropriate network for the given content mode.
 */
export function getNetwork(mode: ContentMode, fast: boolean): NetworkOption {
  return NETWORKS[mode][fast ? 1 : 0];
}

/**
 * Checks whether the browser supports WebGPU.
 * Cannot be called during SSR — only from useEffect.
 */
export function isWebGPUSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Calculates the pass structure for an arbitrary scale.
 *
 * The neural network can only do 2x. For larger scales it's applied in cascade:
 *   - 2x → 1 pass (2x)
 *   - 4x → 2 passes (2x → 2x)
 *   - 8x → 3 passes (2x → 2x → 2x)
 *   - 3x → 2 passes (2x → 2x = 4x) + resize to 3x
 *   - 6x → 3 passes (2x → 2x → 2x = 8x) + resize to 6x
 *
 * Each pass doubles GPU memory consumption and adds time.
 */
export function getScaleInfo(scale: number): ScaleInfo {
  if (scale <= 1) {
    return { passes: 0, aiScale: 1, needsResize: false, tier: "optimal" };
  }

  // Round up to the nearest power of 2
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
    label: "Optimal",
    color: "var(--success)",
    description: "1 neural network pass. Native quality, no artifacts.",
  },
  good: {
    label: "Good",
    color: "var(--accent)",
    description: "2 cascaded passes. Minimal artifacts. Recommended for 4x.",
  },
  acceptable: {
    label: "Acceptable",
    color: "#e89d3d",
    description: "3 passes. The network invents detail. May produce artifacts on complex textures.",
  },
  extreme: {
    label: "Extreme",
    color: "var(--danger)",
    description: "4+ passes. High risk of artifacts and GPU saturation. Experimental.",
  },
};

export function getQualityInfo(tier: QualityTier): QualityInfo {
  return qualityInfo[tier];
}

/**
 * Formats bytes to a human-readable unit.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Formats milliseconds to a human-readable time.
 */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
