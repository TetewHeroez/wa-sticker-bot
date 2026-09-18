const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");

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
 * Convert video to animated WebP sticker (max 6 seconds, 512x512)
 * WhatsApp animated sticker limit: 500KB
 */
function convertVideoToSticker(input, output, quality = 30) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .inputOptions(["-t 6"]) // Limit to 6 seconds
      .outputOptions([
        "-vcodec libwebp",
        `-vf fps=10,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
        "-lossless 0",
        "-compression_level 6",
        `-q:v ${quality}`,
        "-loop 0", // Infinite loop
        "-preset default",
        "-an", // No audio
      ])
      .save(output)
      .on("end", async () => {
        try {
          const stat = fs.statSync(output);
          const sizeKB = Math.round(stat.size / 1024);
          console.log(`[CONVERT] Animated WebP: ${sizeKB}KB (quality=${quality})`);

          // WhatsApp animated sticker limit = 500KB
          if (stat.size > 500 * 1024 && quality > 10) {
            console.log(`[CONVERT] Too large (${sizeKB}KB > 500KB), retrying with lower quality...`);
            // Retry with lower quality
            try {
              await convertVideoToSticker(input, output, Math.max(10, quality - 10));
              resolve();
            } catch (retryErr) {
              reject(retryErr);
            }
          } else if (stat.size > 500 * 1024) {
            reject(new Error(`Animated sticker too large: ${sizeKB}KB (max 500KB). Video terlalu besar/panjang.`));
          } else {
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      })
      .on("error", reject);
  });
}

module.exports = { convertToSticker, convertVideoToSticker };
