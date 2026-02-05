const ffmpeg = require("fluent-ffmpeg");

/**
 * Convert image to static WebP sticker (512x512)
 */
function convertToSticker(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions([
        "-vcodec libwebp",
        "-vf scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-lossless 0",
        "-compression_level 6",
        "-q:v 80",
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

/**
 * Convert video to animated WebP sticker (max 6 seconds, 512x512)
 */
function convertVideoToSticker(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .inputOptions(["-t 6"]) // Limit to 6 seconds
      .outputOptions([
        "-vcodec libwebp",
        "-vf fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
        "-lossless 0",
        "-compression_level 4",
        "-q:v 60",
        "-loop 0", // Infinite loop
        "-preset default",
        "-an", // No audio
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject);
  });
}

module.exports = { convertToSticker, convertVideoToSticker };
