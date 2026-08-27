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
  return c / wt;
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
  return c / wt;
}
`;

const NEAREST_FS = /* wgsl */ `
${VERTEX}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
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
  return vec4f(clamp(sharp.rgb, vec3f(0.0), vec3f(1.0)), c.a);
}
`;

// ============================================================
// Device management — singleton GPUDevice
// ============================================================

let deviceCache: GPUDevice | null = null;

export async function getGPUDevice(): Promise<GPUDevice> {
  if (deviceCache) return deviceCache;
  if (!navigator.gpu) throw new Error("WebGPU no disponible");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No se encontró GPU adapter");
  deviceCache = await adapter.requestDevice();
  deviceCache.lost.then(() => {
    deviceCache = null;
    pipelineCache.clear();
    sharpenPipeline = null;
  });
  return deviceCache;
}

// ============================================================
// Pipeline cache — avoid recreating pipelines
// ============================================================

const pipelineCache = new Map<UpscaleAlgorithm, GPURenderPipeline>();
let sharpenPipeline: GPURenderPipeline | null = null;

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
): GPURenderPipeline {
  let pipeline = pipelineCache.get(algorithm);
  if (pipeline) return pipeline;

  const module = device.createShaderModule({ code: getShaderCode(algorithm) });
  pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });

  pipelineCache.set(algorithm, pipeline);
  return pipeline;
}

function getSharpenPipeline(device: GPUDevice): GPURenderPipeline {
  if (sharpenPipeline) return sharpenPipeline;
  const module = device.createShaderModule({ code: SHARPEN_FS });
  sharpenPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  return sharpenPipeline;
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
  const device = await getGPUDevice();
  const { w: srcW, h: srcH } = getSourceDims(source);
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  // Source texture
  const srcTex = device.createTexture({
    size: [srcW, srcH],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.copyExternalImageToTexture(
    { source, flipY: false },
    { texture: srcTex },
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

  // --- Sharpening pass (optional) ---
  if (needsSharpen) {
    const sharpenTex = device.createTexture({
      size: [dstW, dstH],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const sharpPipeline = getSharpenPipeline(device);
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
  // Without this, the render passes never execute and the texture is empty (black).
  device.queue.submit([encoder.finish()]);

  // --- Read back ---
  const bitmap = await readTextureToBitmap(device, finalTex, dstW, dstH);

  // Cleanup
  srcTex.destroy();
  if (needsSharpen) upscaleTex.destroy();
  finalTex.destroy();

  return bitmap;
}

// ============================================================
// Public API — Video/canvas upscaling (render directly to canvas)
// ============================================================

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
  if (!ctx) throw new Error("No se pudo obtener contexto WebGPU del canvas");
  ctx.configure({ device, format: "rgba8unorm", alphaMode: "opaque" });

  const { w: srcW, h: srcH } = getSourceDims(source);
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);
  canvas.width = dstW;
  canvas.height = dstH;

  // Source texture
  const srcTex = device.createTexture({
    size: [srcW, srcH],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.copyExternalImageToTexture(
    { source, flipY: false },
    { texture: srcTex },
    [srcW, srcH],
  );

  const sampler = createSampler(device, algorithm);
  const pipeline = getUpscalePipeline(device, algorithm);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: srcTex.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  const encoder = device.createCommandEncoder();

  if (sharpen > 0) {
    // Upscale → intermediate → sharpen → canvas
    const intermediate = device.createTexture({
      size: [dstW, dstH],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const upscalePass = encoder.beginRenderPass({
      colorAttachments: [
        { view: intermediate.createView(), loadOp: "clear", storeOp: "store" },
      ],
    });
    upscalePass.setPipeline(pipeline);
    upscalePass.setBindGroup(0, bindGroup);
    upscalePass.draw(3);
    upscalePass.end();

    const sharpPipeline = getSharpenPipeline(device);
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
    // Upscale → canvas directly
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
    upscalePass.setPipeline(pipeline);
    upscalePass.setBindGroup(0, bindGroup);
    upscalePass.draw(3);
    upscalePass.end();

    device.queue.submit([encoder.finish()]);
  }

  srcTex.destroy();
}
