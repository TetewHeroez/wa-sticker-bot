const { createCanvas } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");

const CANVAS_SIZE = 512;
const BG_COLOR = "#FFFFFF";
const TEXT_COLOR = "#000000";
const PADDING = 40;

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = text.split('\n');
  
  for (const p of paragraphs) {
    let currentLine = '';
    // Split by spaces, then split by hyphens (keeping the hyphen on the preceding part)
    const words = p.split(/\s+/).flatMap(w => {
      if (w.includes('-') && w !== '-') {
        const parts = w.split('-');
        const res = [];
        for (let i = 0; i < parts.length - 1; i++) res.push(parts[i] + '-');
        res.push(parts[parts.length - 1]);
        return res.filter(x => x);
      }
      return w;
    });

    for (const word of words) {
      const needsSpace = currentLine.length > 0 && !currentLine.endsWith('-');
      const testLine = currentLine ? (needsSpace ? currentLine + ' ' + word : currentLine + word) : word;
      
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
      
      // Force break if a single word is STILL too long
      while (ctx.measureText(currentLine).width > maxWidth) {
        let temp = '';
        let remainder = currentLine;
        let broken = false;
        for (let i = 0; i < remainder.length; i++) {
          if (ctx.measureText(temp + remainder[i]).width > maxWidth) {
            if (i === 0) {
              temp = remainder[0];
              currentLine = remainder.slice(1);
            } else {
              lines.push(temp);
              currentLine = remainder.slice(i);
            }
            broken = true;
            break;
          }
          temp += remainder[i];
        }
        if (!broken) break;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function getOptimalFontSize(text, maxWidth, maxHeight) {
  const tempCanvas = createCanvas(1, 1);
  const tempCtx = tempCanvas.getContext("2d");
  
  // Karena font akan di-scale horizontal 0.7x, maxWidth efektifnya lebih besar
  const effectiveMaxWidth = maxWidth / 0.7;

  for (let fontSize = 120; fontSize >= 20; fontSize -= 4) {
    tempCtx.font = `${fontSize}px Arial`;
    const lines = wrapText(tempCtx, text, effectiveMaxWidth);
    const lineHeight = fontSize * 1.2;
    if (lines.length * lineHeight <= maxHeight) {
      return fontSize;
    }
  }
  return 20;
}

/**
 * Draw a brat-style canvas with text
 * @param {string} text - Text to render (should be lowercase)
 * @param {number} fontSize - Font size to use
 * @returns {object} Canvas object
 */
function drawBratCanvas(text, fontSize) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (!text) return canvas;

  const maxWidth = CANVAS_SIZE - PADDING * 2;
  const effectiveMaxWidth = maxWidth / 0.7;

  ctx.font = `${fontSize}px Arial`;
  const lines = wrapText(ctx, text, effectiveMaxWidth);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const startY = (CANVAS_SIZE - totalHeight) / 2 + lineHeight / 2;

  // Apply low-res blur effect globally
  ctx.filter = "blur(1.5px)";
  
  ctx.fillStyle = TEXT_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  
  // Scale text horizontally to mimic Arial Narrow ("ditipisin widthnya")
  ctx.save();
  ctx.scale(0.7, 1);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], PADDING / 0.7, startY + i * lineHeight);
  }
  
  ctx.restore();

  return canvas;
}

/**
 * Generate static brat sticker (WebP)
 * @param {string} text - Text for the sticker
 * @param {string} outputPath - Path to save the WebP file
 */
async function generateBratSticker(text, outputPath) {
  const maxWidth = CANVAS_SIZE - PADDING * 2;
  const maxHeight = CANVAS_SIZE - PADDING * 2;
  const fontSize = getOptimalFontSize(text, maxWidth, maxHeight);

  const canvas = drawBratCanvas(text, fontSize);
  const buffer = await canvas.encode("webp");
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Generate animated brat sticker (word-by-word reveal)
 * @param {string} text - Text for the sticker
 * @param {string} outputPath - Path to save the animated WebP file
 */
async function generateBratGif(text, outputPath) {
  const words = text.split(/\s+/);
  const maxWidth = CANVAS_SIZE - PADDING * 2;
  const maxHeight = CANVAS_SIZE - PADDING * 2;

  // Calculate font size based on FULL text so layout doesn't jump between frames
  const fontSize = getOptimalFontSize(text, maxWidth, maxHeight);

  const tempDir = "media/input"; // Temp frames here (not served via HTTP)
  const tempPrefix = `brat_${Date.now()}`;
  const framePaths = [];

  // Frame 0: just background (no text)
  const bgCanvas = drawBratCanvas("", fontSize);
  const bgPath = path.join(tempDir, `${tempPrefix}_000.png`);
  fs.writeFileSync(bgPath, await bgCanvas.encode("png"));
  framePaths.push(bgPath);

  // Frame 1..N: accumulate words one by one
  for (let i = 0; i < words.length; i++) {
    const partialText = words.slice(0, i + 1).join(" ");
    const canvas = drawBratCanvas(partialText, fontSize);
    const framePath = path.join(
      tempDir,
      `${tempPrefix}_${String(i + 1).padStart(3, "0")}.png`,
    );
    fs.writeFileSync(framePath, await canvas.encode("png"));
    framePaths.push(framePath);
  }

  // Create concat file for ffmpeg with per-frame durations
  const concatFile = path.join(tempDir, `${tempPrefix}_concat.txt`);
  let concatContent = "";
  for (let i = 0; i < framePaths.length; i++) {
    const isLast = i === framePaths.length - 1;
    const isBg = i === 0;
    const duration = isLast ? 1.5 : isBg ? 0.3 : 0.5;
    concatContent += `file '${path.resolve(framePaths[i]).replace(/\\/g, "/")}'\n`;
    concatContent += `duration ${duration}\n`;
  }
  // Concat demuxer requires last file repeated without duration
  concatContent += `file '${path.resolve(framePaths[framePaths.length - 1]).replace(/\\/g, "/")}'\n`;
  fs.writeFileSync(concatFile, concatContent);

  // Combine frames into animated WebP
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatFile)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions([
        "-vcodec libwebp",
        "-lossless 0",
        "-compression_level 4",
        "-q:v 60",
        "-loop 0",
        "-preset default",
        "-an",
        "-vsync vfr",
      ])
      .save(outputPath)
      .on("end", () => {
        // Cleanup temp frames
        cleanupTempFiles(framePaths, concatFile);
        resolve(outputPath);
      })
      .on("error", (err) => {
        cleanupTempFiles(framePaths, concatFile);
        reject(err);
      });
  });
}

/**
 * Cleanup temporary frame files
 */
function cleanupTempFiles(framePaths, concatFile) {
  framePaths.forEach((f) => {
    try {
      fs.unlinkSync(f);
    } catch (e) {}
  });
  try {
    fs.unlinkSync(concatFile);
  } catch (e) {}
}

module.exports = { generateBratSticker, generateBratGif };
