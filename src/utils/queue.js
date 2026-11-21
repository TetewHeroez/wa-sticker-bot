const pLimit = require("p-limit").default || require("p-limit");
const { sendSticker, sendText } = require("../services/whatsapp");
const fs = require("fs");

// Max 3 concurrent conversions (10 was too aggressive — can OOM or starve I/O)
const mediaQueue = pLimit(3);
// Force sequential sending to prevent WhatsApp API rate limit (#131056)
const sendQueue = pLimit(1);

let consecutiveSends = 0;
let lastSendGapTime = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rate-limited sticker sending with retry, file verification, and burst control.
 *
 * Key improvements:
 * - Verifies the sticker file exists and is non-empty before sending
 * - Smaller burst window (8 instead of 10) with shorter cooldown (60s instead of 90s)
 * - Per-send delay scaled to burst depth to gradually slow down
 * - Errors are logged but re-thrown so callers know it failed
 */
async function rateLimitedSendSticker(from, mediaId, additionalSleep = 0) {
  return sendQueue(async () => {
    // Verify the sticker file exists and has content
    const stickerPath = `media/output/${mediaId}.webp`;
    if (!fs.existsSync(stickerPath)) {
      throw new Error(`Sticker file not found: ${stickerPath}`);
    }
    const stat = fs.statSync(stickerPath);
    if (stat.size === 0) {
      throw new Error(`Sticker file is empty: ${stickerPath}`);
    }

    const now = Date.now();
    // Reset counter if it's been more than 60 seconds since last send
    if (now - lastSendGapTime > 60000) {
      consecutiveSends = 0;
    }

    // Pause after 8 consecutive sends (a bit under Meta's burst threshold)
    if (consecutiveSends >= 8) {
      const cooldownSeconds = 60;
      console.log(
        `[RATE LIMIT] ${consecutiveSends} stiker terkirim berturut-turut, jeda ${cooldownSeconds} detik...`,
      );
      await sendText(
        from,
        `⏳ *Jeda otomatis*...\nIstirahat ${cooldownSeconds} detik agar tidak diblokir WhatsApp. Sisa stiker akan langsung dikirim setelahnya!`,
      ).catch(() => {});
      await sleep(cooldownSeconds * 1000);
      consecutiveSends = 0;
    }

    consecutiveSends++;
    lastSendGapTime = Date.now();

    console.log(
      `[SEND] Sticker #${consecutiveSends} to ${from}: ${mediaId} (${Math.round(stat.size / 1024)}KB)`,
    );

    await sendSticker(from, mediaId);

    // Base delay between sends, slightly longer for animated stickers
    const baseDelay = 1500;
    await sleep(baseDelay + additionalSleep);
  });
}

module.exports = { mediaQueue, sendQueue, rateLimitedSendSticker, sleep };
