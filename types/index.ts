export type ScaleFactor = number;

/** Algoritmos de upscaling disponibles */
export type UpscaleAlgorithm = "ai" | "lanczos" | "bicubic" | "nearest";

export type AlgorithmInfo = {
  id: UpscaleAlgorithm;
  label: string;
  description: string;
  /** Cuán nítido vs suave es el resultado */
  sharpness: "pixel-perfect" | "sharp" | "natural" | "smooth";
  /** Si usa AI/ML */
  ai: boolean;
};

export const ALGORITHMS: Record<UpscaleAlgorithm, AlgorithmInfo> = {
  ai: {
    id: "ai",
    label: "AI (Anime4K)",
    description:
      "Red neural CNN que reconstruye detalles. Mejor para fotos y arte digital.",
    sharpness: "natural",
    ai: true,
  },
  lanczos: {
    id: "lanczos",
    label: "Lanczos-3",
    description:
      "Interpolación con ventana sinc de 6 taps. El más nítido sin AI. Ideal para preservar bordes.",
    sharpness: "sharp",
    ai: false,
  },
  bicubic: {
    id: "bicubic",
    label: "Bicúbico",
    description:
      "Interpolación Catmull-Rom de 4 taps. Balance entre nitidez y suavidad.",
    sharpness: "natural",
    ai: false,
  },
  nearest: {
    id: "nearest",
    label: "Nearest",
    description:
      "Sin interpolación. Píxeles exactos. Ideal para pixel art y pixel-perfect scaling.",
    sharpness: "pixel-perfect",
    ai: false,
  },
};

export type QualityTier = "optimal" | "good" | "acceptable" | "extreme";

export interface ScaleInfo {
  /** Número de pasadas de 2x en cascada */
  passes: number;
  /** Escala final de la AI (potencia de 2) */
  aiScale: number;
  /** Si requiere resize final (escala no es potencia de 2) */
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

// WebSR no exporta tipos oficiales — declaramos lo mínimo que usamos.
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
