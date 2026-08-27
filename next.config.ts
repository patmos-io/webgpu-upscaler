import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WebSR y webcodecs-utils se importan dinámicamente en el cliente.
  // Los pesos del modelo se sirven desde /public/weights/.
  turbopack: {
    resolveAlias: {
      // webcodecs-utils solo expone "." en exports, pero necesitamos
      // importar subpaths internos (demux/mux/streams) sin arrastrar
      // los audio decoders del index. Mapeamos a archivos directos.
      "webcodecs-utils/dist/demux/simple-demuxer.js":
        "./node_modules/webcodecs-utils/dist/demux/simple-demuxer.js",
      "webcodecs-utils/dist/mux/simple-muxer.js":
        "./node_modules/webcodecs-utils/dist/mux/simple-muxer.js",
      "webcodecs-utils/dist/streams/video-decode-stream.js":
        "./node_modules/webcodecs-utils/dist/streams/video-decode-stream.js",
      "webcodecs-utils/dist/streams/video-encode-stream.js":
        "./node_modules/webcodecs-utils/dist/streams/video-encode-stream.js",
      "webcodecs-utils/dist/streams/video-process-stream.js":
        "./node_modules/webcodecs-utils/dist/streams/video-process-stream.js",
    },
  },
};

export default nextConfig;
