# GPU Upscaler

Upscaling de imágenes y video con WebGPU. 100% client-side, 100% gratis, cero costos de servidor.

La red neural corre en los Tensor Cores de la GPU del usuario via WebGPU. El contenido nunca se sube a un servidor.

## Stack

- **Next.js 16** — App Router, static export
- **WebSR SDK** (`@websr/websr`) — red neural Anime4K CNN, WebGPU compute shaders
- **WebCodecs + webcodecs-utils** — pipeline de video (demux → decode → upscale → encode → mux)
- **Tailwind CSS 4** — estilos

## Cómo funciona

### Imagen
1. El usuario sube una imagen (drag & drop o file input).
2. `createImageBitmap()` genera un bitmap desde el archivo.
3. WebSR.render() corre la red CNN en WebGPU, pinta el resultado en un canvas.
4. `canvas.toBlob()` genera el PNG descargable.
5. Para 4x, se aplican dos pasadas 2x consecutivas.

### Video
1. El usuario sube un video MP4/WebM.
2. Un pipeline de Streams procesa frame por frame:
   - **SimpleDemuxer** — lee los chunks codificados del File
   - **VideoDecodeStream** — decodifica a VideoFrame
   - **VideoProcessStream** — WebSR.render() upscaling el frame
   - **VideoEncodeStream** — codifica el frame escalado a H.264
   - **SimpleMuxer** — genera el MP4 final
3. El usuario descarga el MP4 resultante.

La Streams API aplica backpressure automáticamente: si el encoder va más lento que el decoder, el decoder se frena solo.

## Requisitos del navegador

- Chrome 113+, Edge 113+, o cualquier browser con WebGPU habilitado
- WebCodecs API (Chrome/Edge 94+)

## Desarrollo

```bash
npm install
npm run dev
```

## Deploy a Vercel (gratis)

```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy desde el directorio del proyecto
vercel --prod
```

El plan gratuito de Vercel incluye:
- 100GB bandwidth/mes
- Deployes ilimitados
- Edge network global
- HTTPS automático

Como todo el cómputo es client-side, no hay límite de serverless function execution ni costos de compute. El único costo es bandwidth estático, cubierto por el free tier.

## Modelo de negocio (opcional)

Esta app puede ser:
- **Lead gen gratuita** → upsell a un servicio pago server-side con modelos más potentes (como free.upscaler.video → aivideoupscaler.com)
- **Open source puro** → sin monetización, comunidad
- **Freemium** → gratis hasta N escalados/mes, luego paywall (requiere agregar auth + tracking)
