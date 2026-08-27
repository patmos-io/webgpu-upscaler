import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContentMode,
  ImageResult,
  ProcessingStatus,
  ScaleFactor,
  WebSRModule,
  WebSRInstance,
  NetworkOption,
} from "@/types";
import { getNetwork } from "@/lib/websr";

interface UseImageUpscalerOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

interface UseImageUpscalerResult {
  status: ProcessingStatus;
  error: string | null;
  webgpuSupported: boolean;
  result: ImageResult | null;
  processTime: number | null;
  upscale: (
    source: HTMLImageElement | ImageBitmap,
    scale: ScaleFactor,
    mode: ContentMode,
  ) => Promise<void>;
  reset: () => void;
}

export function useImageUpscaler({
  canvasRef,
}: UseImageUpscalerOptions): UseImageUpscalerResult {
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [webgpuSupported, setWebgpuSupported] = useState(false);
  const [result, setResult] = useState<ImageResult | null>(null);
  const [processTime, setProcessTime] = useState<number | null>(null);

  const moduleRef = useRef<WebSRModule | null>(null);
  const websrRef = useRef<WebSRInstance | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenWebsrRef = useRef<WebSRInstance | null>(null);
  // Cache de pesos para no re-fetchear la misma red
  const weightsCacheRef = useRef<Map<string, unknown>>(new Map());

  useEffect(() => {
    const supported = typeof navigator !== "undefined" && "gpu" in navigator;
    setWebgpuSupported(supported);
  }, []);

  const loadModule = useCallback(async (): Promise<WebSRModule> => {
    if (moduleRef.current) return moduleRef.current;
    const mod = (await import("@websr/websr")) as unknown as WebSRModule;
    moduleRef.current = mod;
    return mod;
  }, []);

  const ensureWebSR = useCallback(
    async (
      network: NetworkOption,
      canvas: HTMLCanvasElement,
    ): Promise<WebSRInstance> => {
      const mod = await loadModule();
      const gpu = await mod.initWebGPU();
      if (!gpu) throw new Error("WebGPU no disponible en este navegador");

      // Cache de pesos
      let weights = weightsCacheRef.current.get(network.weightUrl);
      if (!weights) {
        const weightsRes = await fetch(network.weightUrl);
        if (!weightsRes.ok) {
          throw new Error(`No se pudieron cargar los pesos: ${network.weightUrl}`);
        }
        weights = await weightsRes.json();
        weightsCacheRef.current.set(network.weightUrl, weights);
      }

      const websr = new mod.default({
        network_name: network.name,
        weights,
        gpu,
        canvas,
      });

      return websr;
    },
    [loadModule],
  );

  const upscale = useCallback(
    async (
      source: HTMLImageElement | ImageBitmap,
      _scale: ScaleFactor,
      mode: ContentMode,
    ) => {
      setStatus("processing");
      setError(null);
      setResult(null);
      setProcessTime(null);

      try {
        // Usar la red large (calidad) para imágenes, según el modo
        const network = getNetwork(mode, false);
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        const srcWidth = source.width;
        const srcHeight = source.height;
        const startTime = performance.now();

        if (_scale === 2) {
          websrRef.current?.dispose?.();
          const websr = await ensureWebSR(network, canvas);
          websrRef.current = websr;
          canvas.width = srcWidth * 2;
          canvas.height = srcHeight * 2;
          await websr.render(source);
        } else {
          if (!hiddenCanvasRef.current) {
            hiddenCanvasRef.current = document.createElement("canvas");
          }
          const hidden = hiddenCanvasRef.current;

          hiddenWebsrRef.current?.dispose?.();
          const websrHidden = await ensureWebSR(network, hidden);
          hiddenWebsrRef.current = websrHidden;
          hidden.width = srcWidth * 2;
          hidden.height = srcHeight * 2;
          await websrHidden.render(source);

          const intermediate = await createImageBitmap(hidden);

          websrRef.current?.dispose?.();
          const websr = await ensureWebSR(network, canvas);
          websrRef.current = websr;
          canvas.width = srcWidth * 4;
          canvas.height = srcHeight * 4;
          await websr.render(intermediate);
        }

        const elapsed = performance.now() - startTime;

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error("No se pudo generar la imagen"));
            },
            "image/png",
          );
        });

        const url = URL.createObjectURL(blob);

        setResult({
          blob,
          url,
          width: canvas.width,
          height: canvas.height,
        });
        setProcessTime(elapsed);
        setStatus("done");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        setError(msg);
        setStatus("error");
      }
    },
    [canvasRef, ensureWebSR],
  );

  const reset = useCallback(() => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setProcessTime(null);
    setStatus("idle");
    setError(null);
  }, [result]);

  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
      websrRef.current?.dispose?.();
      hiddenWebsrRef.current?.dispose?.();
    };
  }, [result]);

  return {
    status,
    error,
    webgpuSupported,
    result,
    processTime,
    upscale,
    reset,
  };
}
