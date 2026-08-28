# WebGPU Upscaler

Image upscaling with WebGPU. 100% client-side, 100% free, zero server costs.

The neural network runs on the user's GPU via WebGPU. Content never leaves the browser.

**Live:** https://webgpu-upscaler.vercel.app

---

## Why WebGPU

There are three ways to scale video/images from 720p to 4K with a GPU in real time. This app implements the third:

| Architecture | Where it runs | Requires | Server cost | Real-world example |
|---|---|---|---|---|
| **RTX VSR** | Viewer's dedicated GPU (RTX 30/40) | NVIDIA hardware + Chrome/Edge | $0 | YouTube, Netflix |
| **NVIDIA Maxine** | Cloud GPU (Kubernetes) | GPU infra in backend | $$ | Video conferencing at scale |
| **WebGPU + WebSR** | User's browser (any GPU) | Modern browser | $0 | Twitch, this app |

WebGPU is the piece that democratizes AI upscaling: it runs on any GPU in the browser (no RTX required), needs no install, and has zero server cost. Twitch already uses it in production at 60fps.

### The bandwidth insight

Transmitting a lower resolution and upscaling locally saves real bandwidth:
- 720p→1080p AI upscale: **45–55% bandwidth savings**
- 540p→1080p AI upscale: **60–70% bandwidth savings**
- SimaBit in production: **22% bitrate ↓ + 4.2 VMAF points**

For an image upscaling app, 100% client-side compute means the only cost is static bandwidth (HTML/JS/weights) — covered by Vercel's free tier.

---

## Stack

- **Next.js 16** — App Router, static export
- **WebSR SDK** (`@websr/websr@0.0.15`) — Anime4K CNN neural network, WebGPU compute shaders
- **Custom WGSL shaders** — Lanczos-3, Bicubic (Catmull-Rom), Nearest
- **Tailwind CSS 4** — styling
- **Vercel free tier** — static deploy, zero serverless functions

## Algorithms

| Algorithm | Type | Quality | Speed |
|---|---|---|---|
| **AI (Anime4K)** | CNN super-resolution (WebSR SDK) | Best — hallucinates detail | Slower |
| **Lanczos-3** | Interpolation with 6-tap sinc window | Very good | Fast |
| **Bicubic** | Catmull-Rom | Balanced | Very fast |
| **Nearest** | Pixel replication | Low | Instant |

Available scales: 2x, 4x, 8x (cascade of 2x passes).

## How it works

1. The user uploads an image (drag & drop or file input).
2. `createImageBitmap()` creates a bitmap from the file.
3. The image is converted to a GPU texture (`rgba8unorm`).
4. The selected algorithm runs as a WebGPU compute/render shader (or WebSR CNN for AI).
5. The result is read back from the GPU → `ImageBitmap` → 2D canvas → downloadable PNG.
6. For 4x/8x, consecutive 2x passes are applied (cascading).

```
[Upload] → ImageBitmap → GPU texture (rgba8unorm)
  → [WGSL shader OR WebSR CNN] → GPU texture (upscaled)
  → copyTextureToBuffer → ImageBitmap → 2D canvas → PNG blob
  → BeforeAfterSlider (clip-path comparison)
```

## Browser requirements

- Chrome 113+, Edge 113+, or any browser with WebGPU enabled
- The app detects WebGPU and shows a fallback if unavailable

## Development

```bash
npm install
npm run dev
```

## Deploy to Vercel (free)

```bash
npm i -g vercel
vercel --prod
```

Since all compute is client-side, there are no serverless function execution limits or compute costs. The only cost is static bandwidth, covered by the free tier.

---

## Technical lessons (hard rules)

This section documents bugs we hit while building this app. Each one took hours to debug. If you're building something with WebGPU, read this first.

### 1. A canvas can only have one context type

An HTML `<canvas>` can only have **one context type** — once you call `getContext('webgpu')`, `getContext('2d')` returns `null` (and vice versa).

**The bug:** The WebSR SDK calls `canvas.getContext('webgpu')` internally. But the same canvas already had `getContext('2d')` for PNG output generation. AI mode crashed with "Unable to load WebGPU context".

**Fix:** Use separate canvases. One exclusively for WebGPU (WebSR), another (`document.createElement('canvas')`) for 2D (PNG generation).

### 2. Force alpha=1.0 in WGSL shaders

JPEGs have no alpha channel. When converted to `rgba8unorm` GPU textures, the alpha channel is 0. If the shader preserves the original alpha, the output PNG is transparent (invisible).

**Fix:** All fragment shaders must force alpha=1.0:

```wgsl
// WRONG — preserves alpha=0 from JPEGs
return c / wt;

// RIGHT — force opaque
return vec4f((c / wt).rgb, 1.0);
```

Additionally, the 2D canvas must use `{ alpha: false }` and be filled with white before drawImage.

### 3. All-black detection must check RGB, not alpha

After forcing alpha=1.0, the "is the output all black?" check was reading `alpha > 0`. Since alpha is now always 255, the check always passed — the canvas 2D fallback never triggered, and the user saw black.

**Fix:** Check RGB only:

```typescript
// WRONG — alpha is always 255 now
if (sample[i] > 0 || sample[i+1] > 0 || sample[i+2] > 0 || sample[i+3] > 0)

// RIGHT — check RGB only
if (sample[i] > 0 || sample[i+1] > 0 || sample[i+2] > 0)
```

### 4. WebGPU errors are silent

GPU validation errors don't throw JavaScript exceptions. The shader silently produces a black texture.

**Fix:** Use error scopes:

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

### 5. Always implement a canvas 2D fallback

Custom WGSL shaders can produce black output on some GPUs (root cause undiagnosed — possibly `textureSample` or `copyExternalImageToTexture` with JPEGs). A canvas 2D fallback (browser bilinear upscaling) always works:

```typescript
try {
  return await gpuUpscaleImageImpl(source, algorithm, scale, sharpen);
} catch (err) {
  console.warn('[GPU] Shader failed, falling back to canvas 2D:', err);
  return canvas2DUpscale(source, scale, sharpen);
}
```

### 6. Host model weights locally

The WebSR SDK tries to fetch weights from `katana.video` (external CDN). Those URLs returned 404 → AI mode crashed.

**Fix:** Download weights to `/public/weights/` and reference them as local paths:

```typescript
weightUrl: '/weights/cnn-2x-l-rl.json'  // local, not https://katana.video/...
```

### 7. Submit the encoder before readback

The render encoder must be submitted to the queue **before** copying the texture to a buffer for readback:

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

### 8. 256-byte row alignment in texture readback

WebGPU requires buffer rows to be aligned to 256 bytes. Without padding, the image becomes corrupted (skewed/garbled):

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

## Project structure

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

## Sources & research

This project is based on research into real-time GPU upscaling. Reference technologies:

- [NVIDIA RTX Video Super Resolution](https://blogs.nvidia.com/blog/rtx-video-super-resolution/) — client-side AI upscaling for RTX 30/40
- [NVIDIA Maxine](https://docs.nvidia.com/maxine/vfx/latest/Filters/Upscale.html) — server-side upscaling on cloud GPU
- [Twitch WebGPU talk](https://www.youtube.com/watch?v=CozLYpZ5i1c) — CNN in WebGPU at 60fps in production
- [Free AI Video Upscaler case study](https://web.dev/case-studies/ai-video-upscaler-case-study) — 30,000 hrs/month processed at $0 server cost
- [WebSR SDK](https://esm.sh/@websr/websr@0.0.15) — Anime4K CNN models for WebGPU
- [RT4KSR](https://briancohn.com/2025/11/01/image-upscaling-sota/) — first real-time 4K super-res, 60–120fps consumer GPU
- [VPEG (2025)](https://briancohn.com/2025/11/01/image-upscaling-sota/) — Real-ESRGAN quality with 17.6% of the compute budget
- [AMD REAPPEAR](https://www.amd.com/en/developer/resources/technical-articles/2025/real-time-edge-optimized-ai-powered-parallel-pixel-upscaling-eng.html) — real-time on NPU+iGPU of Ryzen AI

## License

MIT
