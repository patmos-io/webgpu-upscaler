import type { UpscaleAlgorithm } from "@/types";

// ============================================================
// WGSL Shaders — traditional GPU upscaling algorithms
// ============================================================

const VERTEX = /* wgsl */ `
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(3.0, 1.0),
    vec2f(-1.0, 1.0)
  );
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  o.uv = vec2f(o.pos.x * 0.5 + 0.5, 1.0 - (o.pos.y * 0.5 + 0.5));
  return o;
}
`;

const BICUBIC_FS = /* wgsl */ `
${VERTEX}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

fn catmull_rom(x: f32) -> f32 {
  let a = -0.5;
  let ax = abs(x);
  let ax2 = ax * ax;
  let ax3 = ax2 * ax;
  if (ax < 1.0) {
    return (a + 2.0) * ax3 - (a + 3.0) * ax2 + 1.0;
  } else if (ax < 2.0) {
    return a * ax3 - 5.0 * a * ax2 + 8.0 * a * ax - 4.0 * a;
  }
  return 0.0;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let dim = textureDimensions(tex);
  let ts = 1.0 / vec2f(f32(dim.x), f32(dim.y));
  let px = in.uv * vec2f(dim) - 0.5;
  let b = floor(px);
  let f = px - b;
  var c = vec4f(0.0);
  var wt = 0.0;
  for (var j = -1; j <= 2; j = j + 1) {
    for (var i = -1; i <= 2; i = i + 1) {
      let uv = (b + vec2f(f32(i), f32(j)) + 0.5) * ts;
      let w = catmull_rom(f32(i) - f.x) * catmull_rom(f32(j) - f.y);
      c += textureSample(tex, samp, uv) * w;
      wt += w;
    }
  }
  return vec4f((c / wt).rgb, 1.0);
}
`;

const LANCZOS_FS = /* wgsl */ `
${VERTEX}

const PI = 3.14159265359;

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

fn sinc(x: f32) -> f32 {
  if (abs(x) < 0.0001) {
    return 1.0;
  }
  return sin(PI * x) / (PI * x);
}

fn lanczos3(x: f32) -> f32 {
  if (abs(x) >= 3.0) {
    return 0.0;
  }
  return sinc(x) * sinc(x / 3.0);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let dim = textureDimensions(tex);
  let ts = 1.0 / vec2f(f32(dim.x), f32(dim.y));
  let px = in.uv * vec2f(dim) - 0.5;
  let b = floor(px);
  let f = px - b;
  var c = vec4f(0.0);
  var wt = 0.0;
  for (var j = -2; j <= 3; j = j + 1) {
    for (var i = -2; i <= 3; i = i + 1) {
      let uv = (b + vec2f(f32(i), f32(j)) + 0.5) * ts;
      let w = lanczos3(f32(i) - f.x) * lanczos3(f32(j) - f.y);
      c += textureSample(tex, samp, uv) * w;
      wt += w;
    }
  }
  return vec4f((c / wt).rgb, 1.0);
}
`;

const NEAREST_FS = /* wgsl */ `
${VERTEX}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return vec4f(textureSample(tex, samp, in.uv).rgb, 1.0);
}
`;

const SHARPEN_FS = /* wgsl */ `
${VERTEX}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u_params: vec4f;

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let dim = textureDimensions(tex);
  let ts = 1.0 / vec2f(f32(dim.x), f32(dim.y));
  let c = textureSample(tex, samp, in.uv);
  let n = textureSample(tex, samp, in.uv + vec2f(0.0, ts.y));
  let s = textureSample(tex, samp, in.uv + vec2f(0.0, -ts.y));
  let e = textureSample(tex, samp, in.uv + vec2f(ts.x, 0.0));
  let w = textureSample(tex, samp, in.uv + vec2f(-ts.x, 0.0));
  let blur = (n + s + e + w) * 0.25;
  let sharp = c + (c - blur) * u_params.x;
  return vec4f(clamp(sharp.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

// ============================================================
// Device management — singleton GPUDevice
// ============================================================

let deviceCache: GPUDevice | null = null;

export async function getGPUDevice(): Promise<GPUDevice> {
  if (deviceCache) return deviceCache;
  if (!navigator.gpu) throw new Error("WebGPU is not available");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No GPU adapter found");
  deviceCache = await adapter.requestDevice();
  deviceCache.lost.then(() => {
    deviceCache = null;
    pipelineCache.clear();
    sharpenPipelineCache.clear();
  });
  return deviceCache;
}

// ============================================================
// Pipeline cache — avoid recreating pipelines
// ============================================================

// Cache keyed by "algorithm:format" so the same algorithm can have
// pipelines for different output formats (texture vs canvas).
const pipelineCache = new Map<string, GPURenderPipeline>();
const sharpenPipelineCache = new Map<string, GPURenderPipeline>();

function getShaderCode(algorithm: UpscaleAlgorithm): string {
  switch (algorithm) {
    case "lanczos":
      return LANCZOS_FS;
    case "bicubic":
      return BICUBIC_FS;
    case "nearest":
      return NEAREST_FS;
    default:
      return BICUBIC_FS;
  }
}

function getUpscalePipeline(
  device: GPUDevice,
  algorithm: UpscaleAlgorithm,
  format: GPUTextureFormat = "rgba8unorm",
): GPURenderPipeline {
  const key = `${algorithm}:${format}`;
  let pipeline = pipelineCache.get(key);
  if (pipeline) return pipeline;

  const module = device.createShaderModule({ code: getShaderCode(algorithm) });
  pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });

  pipelineCache.set(key, pipeline);
  return pipeline;
}

function getSharpenPipeline(
  device: GPUDevice,
  format: GPUTextureFormat = "rgba8unorm",
): GPURenderPipeline {
  const key = format;
  let pipeline = sharpenPipelineCache.get(key);
  if (pipeline) return pipeline;

  const module = device.createShaderModule({ code: SHARPEN_FS });
  pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });

  sharpenPipelineCache.set(key, pipeline);
  return pipeline;
}

// ============================================================
// Utility
// ============================================================

function getSourceDims(
  source: ImageBitmap | VideoFrame,
): { w: number; h: number } {
  if ("codedWidth" in source) {
    return {
      w: (source as VideoFrame).codedWidth,
      h: (source as VideoFrame).codedHeight,
    };
  }
  return {
    w: (source as ImageBitmap).width,
    h: (source as ImageBitmap).height,
  };
}

function createSampler(device: GPUDevice, algorithm: UpscaleAlgorithm): GPUSampler {
  return device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    magFilter: algorithm === "nearest" ? "nearest" : "linear",
    minFilter: algorithm === "nearest" ? "nearest" : "linear",
  });
}

/**
 * Reads a GPU texture back to an ImageBitmap via buffer mapping.
 * Handles 256-byte row alignment required by WebGPU.
 */
async function readTextureToBitmap(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow },
    [width, height],
  );
  device.queue.submit([encoder.finish()]);

  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());

  // Strip row padding
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcOff = y * bytesPerRow;
    const dstOff = y * width * 4;
    pixels.set(mapped.subarray(srcOff, srcOff + width * 4), dstOff);
  }

  buffer.unmap();
  buffer.destroy();

  const imageData = new ImageData(pixels, width, height);
  return createImageBitmap(imageData);
}

// ============================================================
// Public API — Image upscaling (texture → readback → ImageBitmap)
// ============================================================

/**
 * Upscales an image using a WebGPU shader.
 *
 * @param source - Input image as ImageBitmap
 * @param algorithm - "lanczos" | "bicubic" | "nearest"
 * @param scale - Target scale factor (any number, not just powers of 2)
 * @param sharpen - Sharpening amount 0–2 (0 = off, 2 = strong)
 * @returns Upscaled ImageBitmap
 */
export async function gpuUpscaleImage(
  source: ImageBitmap,
  algorithm: UpscaleAlgorithm,
  scale: number,
  sharpen: number,
): Promise<ImageBitmap> {
  try {
    return await gpuUpscaleImageImpl(source, algorithm, scale, sharpen);
  } catch (err) {
    console.warn("[GPU] Shader upscaling failed, falling back to canvas 2D:", err);
    return canvas2DUpscale(source, scale, sharpen);
  }
}

async function gpuUpscaleImageImpl(
  source: ImageBitmap,
  algorithm: UpscaleAlgorithm,
  scale: number,
  sharpen: number,
): Promise<ImageBitmap> {
  const device = await getGPUDevice();
  const { w: srcW, h: srcH } = getSourceDims(source);
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  // Capture any GPU validation errors
  device.pushErrorScope("validation");
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("internal");

  // Source texture
  const srcTex = device.createTexture({
    size: [srcW, srcH],
    format: "rgba8unorm",
    // copyExternalImageToTexture requires RENDER_ATTACHMENT on the destination
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source, flipY: false },
    { texture: srcTex, premultipliedAlpha: false },
    [srcW, srcH],
  );

  const needsSharpen = sharpen > 0;
  const upscaleTex = device.createTexture({
    size: [dstW, dstH],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      (needsSharpen ? GPUTextureUsage.TEXTURE_BINDING : 0) |
      (needsSharpen ? 0 : GPUTextureUsage.COPY_SRC),
  });

  const sampler = createSampler(device, algorithm);

  // --- Upscale pass ---
  const pipeline = getUpscalePipeline(device, algorithm);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const encoder = device.createCommandEncoder();
  const upscalePass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: upscaleTex.createView(),
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  upscalePass.setPipeline(pipeline);
  upscalePass.setBindGroup(0, bindGroup);
  upscalePass.draw(3);
  upscalePass.end();

  let finalTex = upscaleTex;
  let uniformBuffer: GPUBuffer | null = null;

  // --- Sharpening pass (optional) ---
  if (needsSharpen) {
    const sharpenTex = device.createTexture({
      size: [dstW, dstH],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const sharpPipeline = getSharpenPipeline(device);
    uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([sharpen, 0, 0, 0]),
    );

    const sharpBindGroup = device.createBindGroup({
      layout: sharpPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: upscaleTex.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const sharpPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: sharpenTex.createView(),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    sharpPass.setPipeline(sharpPipeline);
    sharpPass.setBindGroup(0, sharpBindGroup);
    sharpPass.draw(3);
    sharpPass.end();

    finalTex = sharpenTex;
  }

  // --- Submit render commands BEFORE readback ---
  device.queue.submit([encoder.finish()]);

  // --- Read back ---
  const bitmap = await readTextureToBitmap(device, finalTex, dstW, dstH);

  // Cleanup
  srcTex.destroy();
  if (needsSharpen) upscaleTex.destroy();
  finalTex.destroy();
  if (uniformBuffer) uniformBuffer.destroy();

  // Pop error scopes BEFORE the all-black check: a validation error must
  // surface with its real message, not as a generic "empty output" throw.
  for (let i = 0; i < 3; i++) {
    const gpuError = await device.popErrorScope();
    if (gpuError) {
      console.error("[GPU] Error scope:", gpuError.message);
      throw new Error(`GPU error: ${gpuError.message}`);
    }
  }

  // --- Verify result is not all-black (defense-in-depth for silent GPU issues) ---
  // Check RGB only — alpha is now always 1.0 (forced in shaders)
  const verifyCanvas = document.createElement("canvas");
  verifyCanvas.width = Math.min(dstW, 64);
  verifyCanvas.height = Math.min(dstH, 64);
  const vctx = verifyCanvas.getContext("2d");
  if (vctx) {
    vctx.drawImage(bitmap, 0, 0, verifyCanvas.width, verifyCanvas.height);
    const sample = vctx.getImageData(0, 0, verifyCanvas.width, verifyCanvas.height).data;
    let hasContent = false;
    for (let i = 0; i < sample.length; i += 4) {
      if (sample[i] > 0 || sample[i + 1] > 0 || sample[i + 2] > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      console.warn("[GPU] Shader produced all-black texture, falling back to canvas 2D");
      throw new Error("GPU shader produced empty output");
    }
  }

  return bitmap;
}

// ============================================================
// Canvas 2D fallback — always works, no WebGPU required
// ============================================================

async function canvas2DUpscale(
  source: ImageBitmap,
  scale: number,
  sharpen: number,
): Promise<ImageBitmap> {
  const srcW = source.width;
  const srcH = source.height;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Failed to get 2D context");

  // Fill white first — JPEGs should never produce transparent PNGs
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dstW, dstH);

  // Browser's built-in high-quality upscaling (uses bilinear/bicubic internally)
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, dstW, dstH);

  // Optional sharpening pass via convolution
  if (sharpen > 0) {
    const imageData = ctx.getImageData(0, 0, dstW, dstH);
    const data = imageData.data;
    const amount = sharpen;
    const weight = 1 + 4 * amount;
    const side = -amount;

    const original = new Uint8ClampedArray(data);

    for (let y = 1; y < dstH - 1; y++) {
      for (let x = 1; x < dstW - 1; x++) {
        const idx = (y * dstW + x) * 4;
        for (let c = 0; c < 3; c++) {
          const center = original[idx + c];
          const up = original[idx - dstW * 4 + c];
          const down = original[idx + dstW * 4 + c];
          const left = original[idx - 4 + c];
          const right = original[idx + 4 + c];
          const sharp = center * weight + (up + down + left + right) * side;
          data[idx + c] = Math.max(0, Math.min(255, sharp));
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  return createImageBitmap(canvas);
}

// ============================================================
// Public API — Video/canvas upscaling (render directly to canvas)
// ============================================================

// Canvases whose WebGPU context is already configured — reconfiguring or
// resizing every frame tears down the swapchain and destroys throughput.
const configuredCanvases = new WeakSet<HTMLCanvasElement>();

/**
 * Upscales a video frame or image to a WebGPU canvas.
 * Renders directly to the canvas — no buffer readback, faster for video.
 *
 * @param source - VideoFrame or ImageBitmap
 * @param algorithm - "lanczos" | "bicubic" | "nearest"
 * @param scale - Target scale factor
 * @param sharpen - Sharpening amount 0–2
 * @param canvas - Canvas to render to (must support getContext("webgpu"))
 */
export async function gpuUpscaleToCanvas(
  source: ImageBitmap | VideoFrame,
  algorithm: UpscaleAlgorithm,
  scale: number,
  sharpen: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const device = await getGPUDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx) throw new Error("Failed to get WebGPU context from canvas");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  const { w: srcW, h: srcH } = getSourceDims(source);
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);
  if (canvas.width !== dstW || canvas.height !== dstH) {
    canvas.width = dstW;
    canvas.height = dstH;
  }
  if (!configuredCanvases.has(canvas)) {
    ctx.configure({ device, format: canvasFormat, alphaMode: "opaque" });
    configuredCanvases.add(canvas);
  }

  // Source texture
  const srcTex = device.createTexture({
    size: [srcW, srcH],
    format: "rgba8unorm",
    // copyExternalImageToTexture requires RENDER_ATTACHMENT on the destination
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source, flipY: false },
    { texture: srcTex },
    [srcW, srcH],
  );

  const sampler = createSampler(device, algorithm);
  const encoder = device.createCommandEncoder();

  if (sharpen > 0) {
    // Upscale → intermediate (rgba8unorm) → sharpen → canvas (canvasFormat)
    const intermediate = device.createTexture({
      size: [dstW, dstH],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Upscale pass writes to intermediate texture (rgba8unorm)
    const upscalePipeline = getUpscalePipeline(device, algorithm, "rgba8unorm");
    const upscaleBindGroup = device.createBindGroup({
      layout: upscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: sampler },
      ],
    });

    const upscalePass = encoder.beginRenderPass({
      colorAttachments: [
        { view: intermediate.createView(), loadOp: "clear", storeOp: "store" },
      ],
    });
    upscalePass.setPipeline(upscalePipeline);
    upscalePass.setBindGroup(0, upscaleBindGroup);
    upscalePass.draw(3);
    upscalePass.end();

    // Sharpen pass writes to canvas (canvasFormat)
    const sharpPipeline = getSharpenPipeline(device, canvasFormat);
    const uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([sharpen, 0, 0, 0]),
    );

    const sharpBindGroup = device.createBindGroup({
      layout: sharpPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: intermediate.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    const canvasTexture = ctx.getCurrentTexture();
    const sharpPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasTexture.createView(),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    sharpPass.setPipeline(sharpPipeline);
    sharpPass.setBindGroup(0, sharpBindGroup);
    sharpPass.draw(3);
    sharpPass.end();

    device.queue.submit([encoder.finish()]);
    intermediate.destroy();
    uniformBuffer.destroy();
  } else {
    // Upscale → canvas directly (canvasFormat)
    const upscalePipeline = getUpscalePipeline(device, algorithm, canvasFormat);
    const bindGroup = device.createBindGroup({
      layout: upscalePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTex.createView() },
        { binding: 1, resource: sampler },
      ],
    });

    const canvasTexture = ctx.getCurrentTexture();
    const upscalePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasTexture.createView(),
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    upscalePass.setPipeline(upscalePipeline);
    upscalePass.setBindGroup(0, bindGroup);
    upscalePass.draw(3);
    upscalePass.end();

    device.queue.submit([encoder.finish()]);
  }

  srcTex.destroy();
}
