import { useCallback, useRef, useState } from "react";
import type {
  ProcessingStatus,
  ScaleFactor,
  VideoProgress,
  WebSRModule,
  WebSRInstance,
} from "@/types";
import { getNetwork } from "@/lib/websr";

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
        const outWidth = srcWidth * scale;
        const outHeight = srcHeight * scale;

        canvas.width = outWidth;
        canvas.height = outHeight;

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

        // Build pipeline: demux → decode → upscale (WebSR) → encode → mux
        await demuxer
          .videoStream()
          .pipeThrough(new VideoDecodeStream(decoderConfig))
          .pipeThrough(
            new VideoProcessStream(async (frame: VideoFrame) => {
              if (cancelledRef.current) {
                frame.close();
                throw new Error("cancelled");
              }

              // AI upscale con WebSR
              // Capturar metadata antes de close()
              const ts = frame.timestamp;
              const dur = frame.duration;

              await websr.render(frame);
              frame.close();

              const upscaledFrame = new VideoFrame(canvas, {
                timestamp: ts,
                duration: dur ?? undefined,
              });

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
