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
import { getNetwork, getScaleInfo } from "@/lib/websr";

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
  // Cache de instancias WebSR por red para reutilizar entre pasadas
  const websrCacheRef = useRef<Map<string, WebSRInstance>>(new Map());
  // Canvas oculto para pasadas intermedias
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
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

  /**
   * Crea (o recupera del cache) una instancia de WebSR para una red dada.
   * El cache permite reutilizar instancias entre pasadas de cascada y entre
   * escaladas sucesivas con la misma red.
   */
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

      const key = `${network.name}:${network.weightUrl}`;
      let websr = websrCacheRef.current.get(key);
      if (websr) {
        // Reasignar canvas para esta pasada
        websr = new mod.default({
          network_name: network.name,
          weights,
          gpu,
          canvas,
        });
        websrCacheRef.current.set(key, websr);
      } else {
        websr = new mod.default({
          network_name: network.name,
          weights,
          gpu,
          canvas,
        });
        websrCacheRef.current.set(key, websr);
      }

      return websr;
    },
    [loadModule],
  );

  /**
   * Hace una sola pasada de 2x usando WebSR.
   * Renderiza source en canvas, redimensiona el canvas a w*2 × h*2.
   */
  const renderPass2x = useCallback(
    async (
      source: ImageBitmap | HTMLImageElement,
      network: NetworkOption,
      canvas: HTMLCanvasElement,
    ): Promise<void> => {
      const srcW = source.width;
      const srcH = source.height;
      canvas.width = srcW * 2;
      canvas.height = srcH * 2;
      const websr = await ensureWebSR(network, canvas);
      await websr.render(source);
    },
    [ensureWebSR],
  );

  /**
   * Resize bilineal desde un canvas de origen a un canvas destino.
   * Se usa cuando la escala final no es potencia de 2 (ej: 3x, 6x).
   */
  const bilinearResize = useCallback(
    (
      srcCanvas: HTMLCanvasElement,
      dstCanvas: HTMLCanvasElement,
      dstW: number,
      dstH: number,
    ): void => {
      dstCanvas.width = dstW;
      dstCanvas.height = dstH;
      const ctx = dstCanvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo obtener contexto 2d para resize");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(srcCanvas, 0, 0, dstW, dstH);
    },
    [],
  );

  const upscale = useCallback(
    async (
      source: HTMLImageElement | ImageBitmap,
      scale: ScaleFactor,
      mode: ContentMode,
    ) => {
      setStatus("processing");
      setError(null);
      setResult(null);
      setProcessTime(null);

      try {
        const info = getScaleInfo(scale);
        if (info.passes === 0) throw new Error("La escala debe ser mayor a 1x");

        const network = getNetwork(mode, false);
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        const srcWidth = source.width;
        const srcHeight = source.height;
        const startTime = performance.now();

        // Canvas oculto para pasadas intermedias
        if (!hiddenCanvasRef.current) {
          hiddenCanvasRef.current = document.createElement("canvas");
        }
        const hidden = hiddenCanvasRef.current;

        let currentSource: ImageBitmap | HTMLImageElement = source;
        let currentCanvas: HTMLCanvasElement = hidden;
        let currentW = srcWidth;
        let currentH = srcHeight;

        // Pasadas en cascada: cada una duplica las dimensiones
        for (let i = 0; i < info.passes; i++) {
          // Alternar entre hidden y canvas para que la última pasada
          // caiga en el canvas principal (visible)
          const isLastPass = i === info.passes - 1;
          const targetCanvas = isLastPass ? canvas : hidden;
          const altCanvas = isLastPass ? hidden : canvas;

          // Disponer instancia anterior si apuntaba al canvas que vamos a usar
          // (No es necesario porque ensureWebSR crea nueva instancia cada vez)

          await renderPass2x(currentSource, network, targetCanvas);

          currentW *= 2;
          currentH *= 2;

          // Preparar la fuente para la siguiente pasada
          if (isLastPass) {
            // Última pasada: el resultado está en canvas (visible)
            break;
          }
          // Convertir el canvas intermedio a ImageBitmap para la siguiente pasada
          currentSource = await createImageBitmap(targetCanvas);
          currentCanvas = targetCanvas;
        }

        // Resize final si la escala no es potencia de 2
        if (info.needsResize) {
          const finalW = Math.round(srcWidth * scale);
          const finalH = Math.round(srcHeight * scale);
          bilinearResize(canvas, hidden, finalW, finalH);
          // Copiar de hidden al canvas final
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("No se pudo obtener contexto 2d");
          canvas.width = finalW;
          canvas.height = finalH;
          ctx.drawImage(hidden, 0, 0);
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
    [canvasRef, ensureWebSR, renderPass2x, bilinearResize],
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
      websrCacheRef.current.forEach((w) => w.dispose?.());
      websrCacheRef.current.clear();
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
