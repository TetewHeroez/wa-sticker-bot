const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");

const MAX_VIDEO_DURATION_SECONDS = 20;
const MAX_ANIMATED_STICKER_SIZE_BYTES = 500 * 1024;
const FALLBACK_VIDEO_FPS = 15;
const MAX_PRESERVED_VIDEO_FPS = 30;
const MAX_CONVERSION_ATTEMPTS = 28;

/**
 * Convert image to static WebP sticker (512x512)
 */
function convertToSticker(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-vcodec libwebp",
        "-vf scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-lossless 0",
        "-compression_level 4",
        "-q:v 60",
        "-preset picture",
        "-threads 2",
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

/**
 * Convert video to animated WebP sticker (max 20 seconds, 512x512)
 * WhatsApp animated sticker limit: 500KB
 */
function parseFrameRate(frameRate) {
  if (!frameRate || frameRate === "0/0") {
    return null;
  }

  const [numerator, denominator] = frameRate.split("/").map(Number);
  if (Number.isFinite(numerator) && Number.isFinite(denominator)) {
    return denominator === 0 ? null : numerator / denominator;
  }

  const fps = Number(frameRate);
  return Number.isFinite(fps) ? fps : null;
}

function getVideoInfo(input) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(input, (err, metadata) => {
      if (err) {
        console.log(`[CONVERT] ffprobe failed: ${err.message}`);
        resolve({ duration: null, fps: FALLBACK_VIDEO_FPS });
        return;
      }

      const videoStream = metadata.streams?.find(
        (stream) => stream.codec_type === "video",
      );
      const duration = Number(
        videoStream?.duration || metadata.format?.duration,
      );
      const fps =
        parseFrameRate(videoStream?.avg_frame_rate) ||
        parseFrameRate(videoStream?.r_frame_rate) ||
        FALLBACK_VIDEO_FPS;

      resolve({
        duration: Number.isFinite(duration) ? duration : null,
        fps,
      });
    });
  });
}

function clampFps(fps) {
  if (!Number.isFinite(fps)) {
    return FALLBACK_VIDEO_FPS;
  }

  return Math.max(3, Math.min(MAX_PRESERVED_VIDEO_FPS, Math.round(fps)));
}

function buildFpsSteps(sourceFps) {
  const fps = clampFps(sourceFps);
  const ratios = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.33, 0.25, 0.2, 0.16, 0.13, 0.1];
  const steps = [];

  for (const ratio of ratios) {
    const nextFps = Math.max(3, Math.round(fps * ratio));
    if (nextFps < fps && !steps.includes(nextFps)) {
      steps.push(nextFps);
    }
  }

  return steps;
}

function buildAnimatedStickerPlan(videoInfo) {
  const plan = [
    { quality: 75, fps: null },
    { quality: 65, fps: null },
    { quality: 55, fps: null },
    { quality: 45, fps: null },
    { quality: 35, fps: null },
  ];

  const fpsSteps = buildFpsSteps(videoInfo.fps);

  for (const [index, fps] of fpsSteps.entries()) {
    const qualitySteps =
      index < 4 ? [55, 35] : index < 8 ? [50, 30, 15] : [40, 25, 12, 5, 3];

    for (const quality of qualitySteps) {
      plan.push({ quality, fps });
      if (plan.length >= MAX_CONVERSION_ATTEMPTS) {
        return plan;
      }
    }
  }

  return plan;
}

function buildAnimatedStickerFilter(preset) {
  const filters = [];

  if (preset.fps) {
    filters.push(`fps=${preset.fps}`);
  }

  filters.push(
    "scale=512:512:force_original_aspect_ratio=decrease",
    "format=rgba",
    "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
  );

  return filters.join(",");
}

function renderAnimatedSticker(input, output, preset) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(output)) {
      fs.unlinkSync(output);
    }

    ffmpeg(input)
      .inputOptions([`-t ${MAX_VIDEO_DURATION_SECONDS}`])
      .outputOptions([
        "-vcodec libwebp",
        `-vf ${buildAnimatedStickerFilter(preset)}`,
        "-lossless 0",
        "-compression_level 6",
        `-q:v ${preset.quality}`,
        "-loop 0", // Infinite loop
        "-preset default",
        "-an", // No audio
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

async function convertVideoToSticker(input, output) {
  const videoInfo = await getVideoInfo(input);
  const conversionPlan = buildAnimatedStickerPlan(videoInfo);
  let lastSizeKB = 0;
  let lastPreset = null;

  console.log(
    `[CONVERT] Source video: duration=${videoInfo.duration ? `${videoInfo.duration.toFixed(2)}s` : "unknown"}, fps=${videoInfo.fps ? videoInfo.fps.toFixed(2) : "unknown"}`,
  );

  for (const preset of conversionPlan) {
    await renderAnimatedSticker(input, output, preset);

    const stat = fs.statSync(output);
    lastSizeKB = Math.round(stat.size / 1024);
    lastPreset = preset;

    console.log(
      `[CONVERT] Animated WebP: ${lastSizeKB}KB (quality=${preset.quality}, fps=${preset.fps || "source"})`,
    );

    if (stat.size <= MAX_ANIMATED_STICKER_SIZE_BYTES) {
      return;
    }

    console.log(
      `[CONVERT] Too large (${lastSizeKB}KB > 500KB), retrying with stronger compression...`,
    );
  }

  throw new Error(
    `Animated sticker too large: ${lastSizeKB}KB (max 500KB). Preset terakhir: quality=${lastPreset.quality}, fps=${lastPreset.fps || "source"}. Video terlalu besar/panjang.`,
  );
}

module.exports = {
  convertToSticker,
  convertVideoToSticker,
  MAX_VIDEO_DURATION_SECONDS,
};
