export type ScaleFactor = number;

/** Available upscaling algorithms */
export type UpscaleAlgorithm = "ai" | "lanczos" | "bicubic" | "nearest";

export type AlgorithmInfo = {
  id: UpscaleAlgorithm;
  label: string;
  description: string;
  /** How sharp vs smooth the result is */
  sharpness: "pixel-perfect" | "sharp" | "natural" | "smooth";
  /** Whether it uses AI/ML */
  ai: boolean;
};

export const ALGORITHMS: Record<UpscaleAlgorithm, AlgorithmInfo> = {
  ai: {
    id: "ai",
    label: "AI (Anime4K)",
    description:
      "CNN neural network that reconstructs detail. Best for photos and digital art.",
    sharpness: "natural",
    ai: true,
  },
  lanczos: {
    id: "lanczos",
    label: "Lanczos-3",
    description:
      "Interpolation with a 6-tap sinc window. Sharpest non-AI option. Ideal for preserving edges.",
    sharpness: "sharp",
    ai: false,
  },
  bicubic: {
    id: "bicubic",
    label: "Bicubic",
    description:
      "4-tap Catmull-Rom interpolation. Balanced between sharpness and smoothness.",
    sharpness: "natural",
    ai: false,
  },
  nearest: {
    id: "nearest",
    label: "Nearest",
    description:
      "No interpolation. Exact pixel replication. Ideal for pixel art and pixel-perfect scaling.",
    sharpness: "pixel-perfect",
    ai: false,
  },
};

export type QualityTier = "optimal" | "good" | "acceptable" | "extreme";

export interface ScaleInfo {
  /** Number of cascaded 2x passes */
  passes: number;
  /** Final AI scale (power of 2) */
  aiScale: number;
  /** Whether a final resize is needed (scale isn't a power of 2) */
  needsResize: boolean;
  tier: QualityTier;
}

export interface QualityInfo {
  label: string;
  color: string;
  description: string;
}

export type ProcessingStatus =
  | "idle"
  | "loading-model"
  | "ready"
  | "processing"
  | "done"
  | "error";

export type ContentMode = "anime" | "real";

export interface NetworkOption {
  name: string;
  label: string;
  description: string;
  weightUrl: string;
}

export interface ImageResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

export interface VideoProgress {
  phase: "demuxing" | "decoding" | "upscaling" | "encoding" | "muxing" | "done";
  framesProcessed: number;
  totalFrames: number;
  percent: number;
}

// WebSR doesn't export official types — we declare the minimum we use.
export interface WebSRInstance {
  render(
    source: ImageBitmap | HTMLVideoElement | HTMLImageElement | VideoFrame,
  ): Promise<void>;
  start(): Promise<void>;
  dispose?(): void;
}

export interface WebSRConstructor {
  new (config: {
    network_name: string;
    weights: unknown;
    gpu: GPUDevice;
    canvas: HTMLCanvasElement;
    source?: HTMLVideoElement;
    resolution?: { width: number; height: number };
  }): WebSRInstance;
}

export interface WebSRModule {
  initWebGPU(): Promise<GPUDevice | null>;
  default: WebSRConstructor;
}
