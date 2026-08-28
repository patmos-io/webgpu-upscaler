# WebGPU Upscaler

Upscaling de imágenes con WebGPU. 100% client-side, 100% gratis, cero costos de servidor.

La red neural corre en la GPU del usuario via WebGPU. El contenido nunca se sube a un servidor.

**Live:** https://webgpu-upscaler.vercel.app

---

## Por qué WebGPU

Existen tres formas de escalar video/imagen de 720p a 4K con GPU en tiempo real. Esta app implementa la tercera:

| Arquitectura | Dónde corre | Requiere | Costo server | Ejemplo real |
|---|---|---|---|---|
| **RTX VSR** | GPU dedicada del viewer (RTX 30/40) | Hardware NVIDIA + Chrome/Edge | $0 | YouTube, Netflix |
| **NVIDIA Maxine** | Cloud GPU (Kubernetes) | Infra GPU en backend | $$ | Videoconferencia a escala |
| **WebGPU + WebSR** | Browser del usuario (cualquier GPU) | Browser moderno | $0 | Twitch, esta app |

WebGPU es la pieza que democratiza el upscaling AI: corre en cualquier GPU del browser (no requiere RTX), no requiere install, y no tiene costo de servidor. Twitch ya lo usa en producción a 60fps.

### El insight de bandwidth

Transmitir menos resolución y hacer upscale local ahorra bandwidth real:
- 720p→1080p AI upscale: **45-55% bandwidth savings**
- 540p→1080p AI upscale: **60-70% bandwidth savings**
- SimaBit en producción: **22% bitrate ↓ + 4.2 VMAF points**

Para una app de upscaling de imágenes, el cómputo 100% client-side significa que el único costo es bandwidth estático (HTML/JS/weights) — cubierto por el free tier de Vercel.

---

## Stack

- **Next.js 16** — App Router, static export
- **WebSR SDK** (`@websr/websr@0.0.15`) — red neural Anime4K CNN, WebGPU compute shaders
- **WGSL shaders custom** — Lanczos-3, Bicubic (Catmull-Rom), Nearest
- **Tailwind CSS 4** — estilos
- **Vercel free tier** — deploy estático, cero serverless functions

## Algoritmos

| Algoritmo | Tipo | Calidad | Velocidad |
|---|---|---|---|
| **AI (Anime4K)** | CNN super-resolution (WebSR SDK) | Mejor — inventa detalle | Más lento |
| **Lanczos-3** | Interpolación con ventana sinc de 6 taps | Muy bueno | Rápido |
| **Bicubic** | Catmull-Rom | Balanceado | Muy rápido |
| **Nearest** | Replicación de píxeles | Bajo | Instantáneo |

Escalas disponibles: 2x, 4x, 8x (cascada de pasadas 2x).

## Cómo funciona

1. El usuario sube una imagen (drag & drop o file input).
2. `createImageBitmap()` genera un bitmap desde el archivo.
3. La imagen se convierte a GPU texture (`rgba8unorm`).
4. El algoritmo seleccionado corre como WebGPU compute/render shader (o WebSR CNN para AI).
5. El resultado se lee del GPU → `ImageBitmap` → canvas 2D → PNG descargable.
6. Para 4x/8x, se aplican pasadas 2x consecutivas (cascada).

```
[Upload] → ImageBitmap → GPU texture (rgba8unorm)
  → [WGSL shader OR WebSR CNN] → GPU texture (upscaled)
  → copyTextureToBuffer → ImageBitmap → 2D canvas → PNG blob
  → BeforeAfterSlider (clip-path comparison)
```

## Requisitos del navegador

- Chrome 113+, Edge 113+, o cualquier browser con WebGPU habilitado
- La app detecta WebGPU y muestra fallback si no está disponible

## Desarrollo

```bash
npm install
npm run dev
```

## Deploy a Vercel (gratis)

```bash
npm i -g vercel
vercel --prod
```

Como todo el cómputo es client-side, no hay límite de serverless function execution ni costos de compute. El único costo es bandwidth estático, cubierto por el free tier.

---

## Aprendizajes técnicos (hard rules)

Esta sección documenta los bugs que encontramos construyendo esta app. Cada uno tomó horas de debuggear. Si vas a construir algo con WebGPU, leé esto primero.

### 1. Un canvas solo puede tener un tipo de contexto

Un `<canvas>` HTML solo puede tener **un tipo de contexto** — una vez que llamas `getContext('webgpu')`, `getContext('2d')` devuelve `null` (y viceversa).

**El bug:** El WebSR SDK hace `canvas.getContext('webgpu')` internamente. Pero el mismo canvas ya tenía `getContext('2d')` para generar el PNG de output. El modo AI crasheaba con "Unable to load WebGPU context".

**Fix:** Canvas separado. Uno exclusivo para WebGPU (WebSR), otro (`document.createElement('canvas')`) para 2D (PNG generation).

### 2. Forzar alpha=1.0 en shaders WGSL

Los JPEGs no tienen alpha. Cuando se convierten a `rgba8unorm` GPU textures, el canal alpha queda en 0. Si el shader preserva el alpha original, el PNG de output es transparente (invisible).

**Fix:** Todos los fragment shaders deben forzar alpha=1.0:

```wgsl
// WRONG — preserves alpha=0 from JPEGs
return c / wt;

// RIGHT — force opaque
return vec4f((c / wt).rgb, 1.0);
```

Además, el canvas 2D debe usar `{ alpha: false }` y llenarse de blanco antes de drawImage.

### 3. Detección de all-black debe chequear RGB, no alpha

Después de forzar alpha=1.0, la verificación de "¿el output es todo negro?" chequeaba `alpha > 0`. Como alpha ahora siempre es 255, el check siempre pasaba — el fallback de canvas 2D nunca se activaba, y el usuario veía negro.

**Fix:** Chequear solo RGB:

```typescript
// WRONG — alpha is always 255 now
if (sample[i] > 0 || sample[i+1] > 0 || sample[i+2] > 0 || sample[i+3] > 0)

// RIGHT — check RGB only
if (sample[i] > 0 || sample[i+1] > 0 || sample[i+2] > 0)
```

### 4. Errores de WebGPU son silenciosos

Los errores de validación de GPU no throwean excepciones de JavaScript. El shader produce una textura negra silenciosamente.

**Fix:** Usar error scopes:

```typescript
device.pushErrorScope('validation');
device.pushErrorScope('out-of-memory');
device.pushErrorScope('internal');
// ... GPU operations ...
for (let i = 0; i < 3; i++) {
  const gpuError = await device.popErrorScope();
  if (gpuError) throw new Error(`GPU error: ${gpuError.message}`);
}
```

### 5. Siempre implementar fallback de canvas 2D

Los shaders WGSL custom pueden producir output negro en algunos GPUs (root cause no diagnosticado — posiblemente `textureSample` o `copyExternalImageToTexture` con JPEGs). Un fallback de canvas 2D (upscaling bilinear del browser) siempre funciona:

```typescript
try {
  return await gpuUpscaleImageImpl(source, algorithm, scale, sharpen);
} catch (err) {
  console.warn('[GPU] Shader failed, falling back to canvas 2D:', err);
  return canvas2DUpscale(source, scale, sharpen);
}
```

### 6. Hostear pesos de modelos localmente

WebSR SDK intenta fetchear pesos de `katana.video` (CDN externo). Esos URLs devolvían 404 → el modo AI crasheaba.

**Fix:** Descargar los pesos a `/public/weights/` y referenciarlos como paths locales:

```typescript
weightUrl: '/weights/cnn-2x-l-rl.json'  // local, not https://katana.video/...
```

### 7. Submit del encoder antes del readback

El render encoder debe submitearse al queue **antes** de copiar la textura a buffer para lectura:

```typescript
// WRONG — readback before submit
encoder.copyTextureToBuffer(...);
await buffer.mapAsync(GPUMapMode.READ);  // empty!

// RIGHT — submit first, then readback
device.queue.submit([encoder.finish()]);
const readEncoder = device.createCommandEncoder();
readEncoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [w, h]);
device.queue.submit([readEncoder.finish()]);
await buffer.mapAsync(GPUMapMode.READ);
```

### 8. 256-byte row alignment en texture readback

WebGPU requiere que las filas del buffer estén alineadas a 256 bytes. Sin padding, la imagen queda corrompida (sesgada/garbled):

```typescript
const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
// After mapping, strip padding:
for (let y = 0; y < height; y++) {
  const srcOff = y * bytesPerRow;
  const dstOff = y * width * 4;
  pixels.set(mapped.subarray(srcOff, srcOff + width * 4), dstOff);
}
```

---

## Estructura del proyecto

```
webgpu-upscaler/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page (image upscaler)
│   └── globals.css         # Tailwind
├── components/
│   └── BeforeAfterSlider.tsx  # Comparison slider (clip-path)
├── lib/
│   ├── gpu-upscaler.ts     # WGSL shaders, GPU pipeline, texture readback, canvas 2D fallback
│   ├── use-image-upscaler.ts  # React hook (AI + shader dispatcher)
│   └── websr.ts            # WebSR network config, scale calc, quality tiers
├── public/
│   └── weights/            # Anime4K CNN weights (hosted locally)
└── package.json
```

---

## Fuentes y research

Este proyecto se basó en investigación sobre GPU upscaling en tiempo real. Las tecnologías de referencia:

- [NVIDIA RTX Video Super Resolution](https://blogs.nvidia.com/blog/rtx-video-super-resolution/) — upscaling AI client-side para RTX 30/40
- [NVIDIA Maxine](https://docs.nvidia.com/maxine/vfx/latest/Filters/Upscale.html) — upscaling server-side en cloud GPU
- [Twitch WebGPU talk](https://www.youtube.com/watch?v=CozLYpZ5i1c) — CNN en WebGPU a 60fps en producción
- [Free AI Video Upscaler case study](https://web.dev/case-studies/ai-video-upscaler-case-study) — 30,000 hrs/mes procesadas a $0 server cost
- [WebSR SDK](https://esm.sh/@websr/websr@0.0.15) — Anime4K CNN models para WebGPU
- [RT4KSR](https://briancohn.com/2025/11/01/image-upscaling-sota/) — primer real-time 4K super-res, 60-120fps consumer GPU
- [VPEG (2025)](https://briancohn.com/2025/11/01/image-upscaling-sota/) — calidad Real-ESRGAN con 17.6% del budget computacional
- [AMD REAPPEAR](https://www.amd.com/en/developer/resources/technical-articles/2025/real-time-edge-optimized-ai-powered-parallel-pixel-upscaling-eng.html) — real-time en NPU+iGPU de Ryzen AI

## Licencia

MIT
