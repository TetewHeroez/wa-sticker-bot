const pLimit = require("p-limit").default || require("p-limit");
const { sendSticker, sendText } = require("../services/whatsapp");

const mediaQueue = pLimit(10); // Max 10 conversions at the same time
const sendQueue = pLimit(1); // Force sequential sending to prevent WhatsApp API rate limit (#131056)

let consecutiveSends = 0;
let lastSendGapTime = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rateLimitedSendSticker(from, mediaId, additionalSleep = 0) {
  await sendQueue(async () => {
    const now = Date.now();
    // Reset counter if it's been more than 1.5 minutes since last send
    if (now - lastSendGapTime > 90000) {
      consecutiveSends = 0;
    }

    if (consecutiveSends >= 10) {
      console.log(
        "[RATE LIMIT] 10 stiker terkirim berturut-turut, jeda 90 detik...",
      );
      await sendText(
        from,
        "⏳ *Sistem jeda otomatis*...\nSaya istirahat 1.5 menit (90 detik) dulu agar tidak diblokir oleh WhatsApp, sisa stiker akan langsung dikirim setelah ini!",
      ).catch(() => {});
      await sleep(90000);
      consecutiveSends = 0;
    }

    consecutiveSends++;
    lastSendGapTime = Date.now();

    await sendSticker(from, mediaId);
    await sleep(1000 + additionalSleep);
  });
}

module.exports = { mediaQueue, sendQueue, rateLimitedSendSticker, sleep };
