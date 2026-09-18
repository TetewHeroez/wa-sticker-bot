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
 * Calculate the position of every word in the full text layout.
 * Returns an array of { word, x, y } objects where x/y are in
 * the SCALED coordinate system (before 0.7x horizontal scale).
 */
function computeWordLayout(fullText, fontSize) {
  const tempCanvas = createCanvas(1, 1);
  const ctx = tempCanvas.getContext("2d");
  ctx.font = `${fontSize}px Arial`;

  const maxWidth = CANVAS_SIZE - PADDING * 2;
  const effectiveMaxWidth = maxWidth / 0.7;
  const lines = wrapText(ctx, fullText, effectiveMaxWidth);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const startY = (CANVAS_SIZE - totalHeight) / 2 + lineHeight / 2;

  // Now figure out which original words map to which position.
  // We need to split the original text into words (by space) to match
  // the user's "per word" expectation.
  const originalWords = fullText.split(/\s+/);
  const wordPositions = []; // { word, x, y }

  // Walk through lines, measuring each original word's position
  let wordIdx = 0;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineY = startY + lineIdx * lineHeight;
    const lineText = lines[lineIdx];

    // Figure out which original words are on this line
    let xCursor = PADDING / 0.7; // start x in scaled coords
    let remaining = lineText;

    while (remaining.length > 0 && wordIdx < originalWords.length) {
      const origWord = originalWords[wordIdx];

      // Check if the line starts with (or contains) this original word
      // Handle hyphen-split words: the wrapText function splits "antek-antek"
      // into "antek-" and "antek", but the original word is "antek-antek".
      // We need to match chunks of the line to original words.

      if (remaining.startsWith(origWord)) {
        const wordWidth = ctx.measureText(origWord).width;
        wordPositions.push({ word: origWord, x: xCursor, y: lineY });
        remaining = remaining.slice(origWord.length).replace(/^\s+/, "");
        xCursor += wordWidth + ctx.measureText(" ").width;
        wordIdx++;
      } else {
        // The line text doesn't directly match original words (due to hyphen splitting).
        // In this case, just render the entire remaining line content as one "word entry"
        // mapped to the current original word.
        wordPositions.push({ word: origWord, x: xCursor, y: lineY });
        const wordWidth = ctx.measureText(origWord).width;
        // Try to consume from remaining
        // Find how much of remaining corresponds to this original word
        let consumed = "";
        // Try matching: the original word might span a hyphen break
        if (remaining.indexOf(origWord) === 0) {
          consumed = origWord;
        } else {
          // Just consume what we can and move on
          consumed = remaining.split(/\s+/)[0] || remaining;
        }
        remaining = remaining.slice(consumed.length).replace(/^\s+/, "");
        xCursor += ctx.measureText(consumed).width + ctx.measureText(" ").width;
        wordIdx++;
      }
    }
  }

  // If we missed any words (shouldn't happen), add them
  while (wordIdx < originalWords.length) {
    wordPositions.push({
      word: originalWords[wordIdx],
      x: PADDING / 0.7,
      y: startY,
    });
    wordIdx++;
  }

  return { wordPositions, lineHeight, startY, lines };
}

/**
 * Draw a brat-style frame with specific words visible.
 * @param {Array} wordPositions - All word positions from computeWordLayout
 * @param {number} visibleCount - How many words (from the start) are visible
 * @param {number} fontSize - Font size
 * @returns {object} Canvas object
 */
function drawBratGifFrame(wordPositions, visibleCount, fontSize) {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Apply low-res blur effect
  ctx.filter = "blur(1.5px)";
  ctx.font = `${fontSize}px Arial`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Scale text horizontally
  ctx.save();
  ctx.scale(0.7, 1);

  for (let i = 0; i < wordPositions.length; i++) {
    if (i < visibleCount) {
      ctx.fillStyle = TEXT_COLOR; // Visible
    } else {
      ctx.fillStyle = "rgba(0,0,0,0)"; // Invisible (transparent)
    }
    ctx.fillText(wordPositions[i].word, wordPositions[i].x, wordPositions[i].y);
  }

  ctx.restore();
  return canvas;
}

/**
 * Generate animated brat sticker (word-by-word reveal, fixed positions)
 * @param {string} text - Text for the sticker
 * @param {string} outputPath - Path to save the animated WebP file
 */
async function generateBratGif(text, outputPath) {
  const originalWords = text.split(/\s+/);
  const maxWidth = CANVAS_SIZE - PADDING * 2;
  const maxHeight = CANVAS_SIZE - PADDING * 2;

  // Calculate font size based on FULL text
  const fontSize = getOptimalFontSize(text, maxWidth, maxHeight);

  // Pre-compute ALL word positions from the full text layout
  const { wordPositions } = computeWordLayout(text, fontSize);

  const tempDir = "media/input";
  const tempPrefix = `brat_${Date.now()}`;
  const framePaths = [];

  // Frame 0: just background (no words visible)
  const bgCanvas = drawBratGifFrame(wordPositions, 0, fontSize);
  const bgPath = path.join(tempDir, `${tempPrefix}_000.png`);
  fs.writeFileSync(bgPath, await bgCanvas.encode("png"));
  framePaths.push(bgPath);

  // Frame 1..N: reveal one more original word each frame
  for (let i = 0; i < originalWords.length; i++) {
    const canvas = drawBratGifFrame(wordPositions, i + 1, fontSize);
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
    const isBg = i === 0;
    const duration = isBg ? 0.3 : 0.5; // All word frames equal
    concatContent += `file '${path.resolve(framePaths[i]).replace(/\\/g, "/")}'\n`;
    concatContent += `duration ${duration}\n`;
  }
  // Hold on full text for 1.25s before looping
  const lastFrame = path.resolve(framePaths[framePaths.length - 1]).replace(/\\/g, "/");
  concatContent += `file '${lastFrame}'\n`;
  concatContent += `duration 1.25\n`;
  // Concat demuxer requires last file repeated without duration
  concatContent += `file '${lastFrame}'\n`;
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
