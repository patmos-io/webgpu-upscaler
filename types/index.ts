export type ScaleFactor = 2 | 4;

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
