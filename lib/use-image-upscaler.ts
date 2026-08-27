import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ContentMode,
  ImageResult,
  ProcessingStatus,
  ScaleFactor,
  UpscaleAlgorithm,
  WebSRModule,
  WebSRInstance,
  NetworkOption,
} from "@/types";
import { getNetwork, getScaleInfo } from "@/lib/websr";
import { gpuUpscaleImage } from "@/lib/gpu-upscaler";

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
    algorithm: UpscaleAlgorithm,
    sharpen: number,
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
  const websrCacheRef = useRef<Map<string, WebSRInstance>>(new Map());
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
    async (network: NetworkOption, canvas: HTMLCanvasElement): Promise<WebSRInstance> => {
      const mod = await loadModule();
      const gpu = await mod.initWebGPU();
      if (!gpu) throw new Error("WebGPU no disponible en este navegador");

      let weights = weightsCacheRef.current.get(network.weightUrl);
      if (!weights) {
        const weightsRes = await fetch(network.weightUrl);
        if (!weightsRes.ok) throw new Error(`No se pudieron cargar los pesos: ${network.weightUrl}`);
        weights = await weightsRes.json();
        weightsCacheRef.current.set(network.weightUrl, weights);
      }

      const key = `${network.name}:${network.weightUrl}`;
      const websr = new mod.default({
        network_name: network.name,
        weights,
        gpu,
        canvas,
      });
      websrCacheRef.current.set(key, websr);
      return websr;
    },
    [loadModule],
  );

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

  const bilinearResize = useCallback(
    (srcCanvas: HTMLCanvasElement, dstCanvas: HTMLCanvasElement, dstW: number, dstH: number): void => {
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

  // ============================================================
  // GPU shader path — traditional algorithms (lanczos, bicubic, nearest)
  // ============================================================
  const upscaleWithShader = useCallback(
    async (
      source: ImageBitmap,
      algorithm: Exclude<UpscaleAlgorithm, "ai">,
      scale: ScaleFactor,
      sharpen: number,
    ): Promise<ImageBitmap> => {
      return gpuUpscaleImage(source, algorithm, scale, sharpen);
    },
    [],
  );

  // ============================================================
  // AI path — WebSR cascade
  // ============================================================
  const upscaleWithAI = useCallback(
    async (
      source: ImageBitmap | HTMLImageElement,
      scale: ScaleFactor,
      mode: ContentMode,
    ): Promise<{ bitmap: ImageBitmap; width: number; height: number }> => {
      const info = getScaleInfo(scale);
      if (info.passes === 0) throw new Error("La escala debe ser mayor a 1x");

      const network = getNetwork(mode, false);
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Canvas no disponible");

      const srcWidth = source.width;
      const srcHeight = source.height;

      // Hidden canvas for intermediate passes (also WebGPU — separate from output canvas)
      if (!hiddenCanvasRef.current) hiddenCanvasRef.current = document.createElement("canvas");
      const hidden = hiddenCanvasRef.current;

      let currentSource: ImageBitmap | HTMLImageElement = source;
      let lastCanvas: HTMLCanvasElement = canvas;

      for (let i = 0; i < info.passes; i++) {
        const isLastPass = i === info.passes - 1;
        // Use the main canvas only for the last pass; hidden canvas for intermediate
        const targetCanvas = isLastPass ? canvas : hidden;

        await renderPass2x(currentSource, network, targetCanvas);

        lastCanvas = targetCanvas;
        if (isLastPass) break;
        currentSource = await createImageBitmap(targetCanvas);
      }

      let finalW = lastCanvas.width;
      let finalH = lastCanvas.height;

      // Resize final si la escala no es potencia de 2
      // Use a SEPARATE 2D canvas — never getContext('2d') on the WebGPU canvas
      if (info.needsResize) {
        finalW = Math.round(srcWidth * scale);
        finalH = Math.round(srcHeight * scale);
        if (!outputCanvasRef.current) outputCanvasRef.current = document.createElement("canvas");
        const resizeCanvas = outputCanvasRef.current;
        resizeCanvas.width = finalW;
        resizeCanvas.height = finalH;
        const rctx = resizeCanvas.getContext("2d", { alpha: false });
        if (!rctx) throw new Error("No se pudo obtener contexto 2d para resize");
        rctx.imageSmoothingEnabled = true;
        rctx.imageSmoothingQuality = "high";
        rctx.drawImage(lastCanvas, 0, 0, finalW, finalH);
        const bitmap = await createImageBitmap(resizeCanvas);
        return { bitmap, width: finalW, height: finalH };
      }

      const bitmap = await createImageBitmap(lastCanvas);
      return { bitmap, width: finalW, height: finalH };
    },
    [canvasRef, ensureWebSR, renderPass2x],
  );

  // ============================================================
  // Main upscale dispatcher
  // ============================================================
  const upscale = useCallback(
    async (
      source: HTMLImageElement | ImageBitmap,
      scale: ScaleFactor,
      mode: ContentMode,
      algorithm: UpscaleAlgorithm,
      sharpen: number,
    ) => {
      setStatus("processing");
      setError(null);
      setResult(null);
      setProcessTime(null);

      try {
        if (scale <= 1) throw new Error("La escala debe ser mayor a 1x");

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas no disponible");

        const startTime = performance.now();
        let finalBitmap: ImageBitmap;
        let finalW: number;
        let finalH: number;

        // Convertir source a ImageBitmap si no lo es
        const bitmap =
          source instanceof ImageBitmap
            ? source
            : await createImageBitmap(source);

        if (algorithm === "ai") {
          const { bitmap: result, width, height } = await upscaleWithAI(bitmap, scale, mode);
          finalBitmap = result;
          finalW = width;
          finalH = height;
        } else {
          const result = await upscaleWithShader(bitmap, algorithm, scale, sharpen);
          finalBitmap = result;
          finalW = result.width;
          finalH = result.height;
        }

        const elapsed = performance.now() - startTime;

        // Convertir a blob via a SEPARATE 2D canvas — never reuse the WebGPU canvas
        // because once a canvas has getContext('webgpu'), getContext('2d') returns null.
        if (!outputCanvasRef.current) outputCanvasRef.current = document.createElement("canvas");
        const outputCanvas = outputCanvasRef.current;
        outputCanvas.width = finalW;
        outputCanvas.height = finalH;
        const ctx = outputCanvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("No se pudo obtener contexto 2d");
        // Fill with white first — JPEGs should never produce transparent PNGs
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, finalW, finalH);
        ctx.drawImage(finalBitmap, 0, 0);

        const blob = await new Promise<Blob>((resolve, reject) => {
          outputCanvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen"))),
            "image/png",
          );
        });

        const url = URL.createObjectURL(blob);

        setResult({ blob, url, width: finalW, height: finalH });
        setProcessTime(elapsed);
        setStatus("done");

        // Cleanup
        if (finalBitmap !== bitmap) finalBitmap.close();
        bitmap.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        setError(msg);
        setStatus("error");
      }
    },
    [canvasRef, upscaleWithAI, upscaleWithShader],
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

  return { status, error, webgpuSupported, result, processTime, upscale, reset };
}
