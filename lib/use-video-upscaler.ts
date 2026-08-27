import { useCallback, useRef, useState } from "react";
import type {
  ProcessingStatus,
  ScaleFactor,
  VideoProgress,
  WebSRModule,
  WebSRInstance,
  NetworkOption,
} from "@/types";
import { getNetwork, getScaleInfo } from "@/lib/websr";

interface UseVideoUpscalerResult {
  status: ProcessingStatus;
  error: string | null;
  webgpuSupported: boolean;
  progress: VideoProgress | null;
  resultUrl: string | null;
  upscale: (file: File, scale: ScaleFactor) => Promise<void>;
  reset: () => void;
}

// --- webcodecs-utils: tipos mínimos para los subpaths internos ---
// El paquete no exporta tipos para subpaths internos.
interface SimpleDemuxer {
  load(): Promise<void>;
  getVideoDecoderConfig(): Promise<VideoDecoderConfig>;
  videoStream(): ReadableStream<EncodedVideoChunk>;
}

interface SimpleMuxer {
  videoSink(): WritableStream<EncodedVideoChunk>;
  finalize(): Promise<Blob>;
}

interface VideoDecodeStream extends TransformStream {}
interface VideoEncodeStream extends TransformStream {}
interface VideoProcessStream extends TransformStream {}

export function useVideoUpscaler(): UseVideoUpscalerResult {
  const [status, setStatus] = useState<ProcessingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [webgpuSupported, setWebgpuSupported] = useState(false);

  const websrRef = useRef<WebSRInstance | null>(null);
  const moduleRef = useRef<WebSRModule | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cancelledRef = useRef(false);

  // Detectar WebGPU al montar — se setea en el primer upscale
  const checkWebGPU = useCallback(() => {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      setWebgpuSupported(true);
      return true;
    }
    setWebgpuSupported(false);
    return false;
  }, []);

  const loadWebSR = useCallback(async (): Promise<{
    mod: WebSRModule;
    websr: WebSRInstance;
  }> => {
    if (moduleRef.current) return { mod: moduleRef.current, websr: websrRef.current! };
    const mod = (await import("@websr/websr")) as unknown as WebSRModule;
    moduleRef.current = mod;

    const gpu = await mod.initWebGPU();
    if (!gpu) throw new Error("WebGPU no disponible");

    // Canvas oculto para render del upscaling
    if (!hiddenCanvasRef.current) {
      hiddenCanvasRef.current = document.createElement("canvas");
    }
    const canvas = hiddenCanvasRef.current;

    const network = getNetwork("real", true); // cnn-2x-s real-life (rápido para video)
    const weightsRes = await fetch(network.weightUrl);
    if (!weightsRes.ok) throw new Error("No se pudieron cargar los pesos del modelo");
    const weights = await weightsRes.json();

    const websr = new mod.default({
      network_name: network.name,
      weights,
      gpu,
      canvas,
    });

    websrRef.current = websr;
    return { mod, websr };
  }, []);

  /**
   * Hace N pasadas de 2x en cascada sobre un VideoFrame.
   * Usa canvas intermedios para cada pasada.
   * Retorna un VideoFrame con la resolución final escalada.
   */
  const upscaleFrame = useCallback(
    async (
      frame: VideoFrame,
      websr: WebSRInstance,
      scale: ScaleFactor,
      finalCanvas: HTMLCanvasElement,
    ): Promise<VideoFrame> => {
      const info = getScaleInfo(scale);
      if (info.passes === 0) {
        // sin escala, devolver tal cual
        return frame;
      }

      const srcW = frame.codedWidth;
      const srcH = frame.codedHeight;
      const ts = frame.timestamp;
      const dur = frame.duration;

      let currentSource: VideoFrame | ImageBitmap = frame;
      let currentW = srcW;
      let currentH = srcH;

      // Canvas intermedio para pasadas no finales
      const tempCanvas = document.createElement("canvas");

      for (let i = 0; i < info.passes; i++) {
        const isLastPass = i === info.passes - 1 && !info.needsResize;
        const target = isLastPass ? finalCanvas : tempCanvas;
        target.width = currentW * 2;
        target.height = currentH * 2;

        await websr.render(currentSource);
        if (currentSource !== frame) {
          (currentSource as ImageBitmap).close?.();
        }

        currentW *= 2;
        currentH *= 2;

        if (!isLastPass) {
          currentSource = await createImageBitmap(target);
        }
      }

      frame.close();

      // Resize final si la escala no es potencia de 2
      if (info.needsResize) {
        const finalW = Math.round(srcW * scale);
        const finalH = Math.round(srcH * scale);
        finalCanvas.width = finalW;
        finalCanvas.height = finalH;
        const ctx = finalCanvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo obtener contexto 2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(tempCanvas, 0, 0, finalW, finalH);
      }

      return new VideoFrame(finalCanvas, {
        timestamp: ts,
        duration: dur ?? undefined,
      });
    },
    [],
  );

  const upscale = useCallback(
    async (file: File, scale: ScaleFactor) => {
      if (!checkWebGPU()) {
        setError("Tu navegador no soporta WebGPU. Probá con Chrome o Edge.");
        setStatus("error");
        return;
      }

      setStatus("processing");
      setError(null);
      setProgress(null);
      setResultUrl(null);
      cancelledRef.current = false;

      try {
        // Cargar WebSR
        const { websr } = await loadWebSR();
        const canvas = hiddenCanvasRef.current!;

        // Importar webcodecs-utils — solo los módulos de video, saltando
        // el index que arrastra audio decoders (mpg123-decoder) que rompen SSR.
        // @ts-expect-error — subpaths internos sin tipos exportados
        const { SimpleDemuxer } = await import("webcodecs-utils/dist/demux/simple-demuxer.js");
        // @ts-expect-error
        const { SimpleMuxer } = await import("webcodecs-utils/dist/mux/simple-muxer.js");
        // @ts-expect-error
        const { VideoDecodeStream } = await import("webcodecs-utils/dist/streams/video-decode-stream.js");
        // @ts-expect-error
        const { VideoEncodeStream } = await import("webcodecs-utils/dist/streams/video-encode-stream.js");
        // @ts-expect-error
        const { VideoProcessStream } = await import("webcodecs-utils/dist/streams/video-process-stream.js");

        // Demuxer: leer el video de entrada
        setProgress({
          phase: "demuxing",
          framesProcessed: 0,
          totalFrames: 0,
          percent: 0,
        });

        const demuxer = new SimpleDemuxer(file);
        await demuxer.load();
        const decoderConfig = await demuxer.getVideoDecoderConfig();

        // Estimar total de frames (aproximación basada en duración + fps)
        const srcWidth = decoderConfig.codedWidth ?? 640;
        const srcHeight = decoderConfig.codedHeight ?? 360;

        // Output resolution
        const outWidth = Math.round(srcWidth * scale);
        const outHeight = Math.round(srcHeight * scale);

        // Canvas para el resultado final de cada frame
        const finalCanvas = hiddenCanvasRef.current!;
        finalCanvas.width = outWidth;
        finalCanvas.height = outHeight;

        // Encoder config — AVC (H.264) que es lo más compatible
        const encoderConfig: VideoEncoderConfig = {
          codec: "avc1.4d0034",
          width: outWidth,
          height: outHeight,
          bitrate: 5_000_000,
          framerate: 30,
        };

        const muxer = new SimpleMuxer({ video: "avc" });

        let framesProcessed = 0;

        // Build pipeline: demux → decode → upscale (WebSR cascade) → encode → mux
        await demuxer
          .videoStream()
          .pipeThrough(new VideoDecodeStream(decoderConfig))
          .pipeThrough(
            new VideoProcessStream(async (frame: VideoFrame) => {
              if (cancelledRef.current) {
                frame.close();
                throw new Error("cancelled");
              }

              // AI upscale con cascada N×2x
              const upscaledFrame = await upscaleFrame(frame, websr, scale, finalCanvas);

              framesProcessed++;
              setProgress({
                phase: "upscaling",
                framesProcessed,
                totalFrames: 0, // no sabemos el total con SimpleDemuxer
                percent: 0,
              });

              return upscaledFrame;
            }),
          )
          .pipeThrough(new VideoEncodeStream(encoderConfig))
          .pipeTo(muxer.videoSink());

        const blob = await muxer.finalize();

        if (cancelledRef.current) return;

        const url = URL.createObjectURL(blob);
        setResultUrl(url);
        setProgress({
          phase: "done",
          framesProcessed,
          totalFrames: framesProcessed,
          percent: 100,
        });
        setStatus("done");
      } catch (err) {
        if (cancelledRef.current) return;
        const msg = err instanceof Error ? err.message : "Error desconocido";
        setError(msg);
        setStatus("error");
      }
    },
    [checkWebGPU, loadWebSR],
  );

  const reset = useCallback(() => {
    cancelledRef.current = true;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setProgress(null);
    setStatus("idle");
    setError(null);
  }, [resultUrl]);

  return {
    status,
    error,
    webgpuSupported,
    progress,
    resultUrl,
    upscale,
    reset,
  };
}
