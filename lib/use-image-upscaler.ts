import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ImageResult,
  ProcessingStatus,
  ScaleFactor,
  WebSRModule,
  WebSRInstance,
} from "@/types";
import { NETWORKS } from "@/lib/websr";

interface UseImageUpscalerOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

interface UseImageUpscalerResult {
  status: ProcessingStatus;
  error: string | null;
  webgpuSupported: boolean;
  result: ImageResult | null;
  processTime: number | null;
  upscale: (source: HTMLImageElement | ImageBitmap, scale: ScaleFactor) => Promise<void>;
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

  const websrRef = useRef<WebSRInstance | null>(null);
  const moduleRef = useRef<WebSRModule | null>(null);
  const currentNetworkRef = useRef<string | null>(null);

  // Detectar WebGPU al montar
  useEffect(() => {
    const supported = typeof navigator !== "undefined" && "gpu" in navigator;
    setWebgpuSupported(supported);
  }, []);

  const loadModule = useCallback(async (): Promise<WebSRModule> => {
    if (moduleRef.current) return moduleRef.current;
    // Import dinámico — solo en cliente
    const mod = (await import("@websr/websr")) as unknown as WebSRModule;
    moduleRef.current = mod;
    return mod;
  }, []);

  const ensureWebSR = useCallback(
    async (networkName: string): Promise<WebSRInstance> => {
      const mod = await loadModule();
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas no disponible");
      const gpu = await mod.initWebGPU();
      if (!gpu) throw new Error("WebGPU no disponible en este navegador");

      // Si ya tenemos una instancia con la misma red, reusar
      if (websrRef.current && currentNetworkRef.current === networkName) {
        return websrRef.current;
      }

      // Limpiar instancia anterior si cambió la red
      if (websrRef.current) {
        websrRef.current.dispose?.();
        websrRef.current = null;
      }

      const network = NETWORKS.find((n) => n.name === networkName);
      if (!network) throw new Error(`Red desconocida: ${networkName}`);

      const weightsRes = await fetch(network.weightUrl);
      if (!weightsRes.ok) {
        throw new Error(`No se pudieron cargar los pesos: ${network.weightUrl}`);
      }
      const weights = await weightsRes.json();

      const websr = new mod.default({
        network_name: networkName,
        weights,
        gpu,
        canvas,
      });

      websrRef.current = websr;
      currentNetworkRef.current = networkName;
      return websr;
    },
    [canvasRef, loadModule],
  );

  const upscale = useCallback(
    async (source: HTMLImageElement | ImageBitmap, _scale: ScaleFactor) => {
      setStatus("processing");
      setError(null);
      setResult(null);
      setProcessTime(null);

      try {
        // CNN-2x siempre escala 2x. Para 4x, aplicamos 2x dos veces.
        const networkName = "anime4k/cnn-2x-l";
        const websr = await ensureWebSR(networkName);
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        // Medir la imagen de entrada
        const srcWidth = source.width;
        const srcHeight = source.height;

        const startTime = performance.now();

        if (_scale === 2) {
          // Una pasada 2x
          canvas.width = srcWidth * 2;
          canvas.height = srcHeight * 2;
          await websr.render(source);
        } else {
          // Dos pasadas 2x = 4x
          // Primera pasada: resultado intermedio en el canvas
          canvas.width = srcWidth * 2;
          canvas.height = srcHeight * 2;
          await websr.render(source);

          // Tomar el resultado intermedio como entrada de la segunda pasada
          const intermediate = await createImageBitmap(canvas);
          canvas.width = srcWidth * 4;
          canvas.height = srcHeight * 4;
          await websr.render(intermediate);
        }

        const elapsed = performance.now() - startTime;

        // Convertir el canvas a blob
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

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
      websrRef.current?.dispose?.();
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
