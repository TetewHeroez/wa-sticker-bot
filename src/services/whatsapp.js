const axios = require("axios");
const fs = require("fs");

const API_BASE = `https://graph.facebook.com/v19.0`;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000]; // Exponential-ish backoff

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.TOKEN}`,
    "Content-Type": "application/json",
  };
}

/**
 * Retry wrapper for API calls.
 * Retries on network errors, 429 (rate limit), and 5xx server errors.
 */
async function withRetry(label, fn) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const metaCode = err.response?.data?.error?.code;

      // Rate limit hit (#131056 or HTTP 429) — always retry
      const isRateLimit = status === 429 || metaCode === 131056;
      // Server error — worth retrying
      const isServerError = status >= 500;
      // Network error (no response at all)
      const isNetworkError = !err.response && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK' || err.code === 'EPIPE');

      const shouldRetry = isRateLimit || isServerError || isNetworkError;

      if (shouldRetry && attempt < MAX_RETRIES) {
        // For rate limits, use longer delay
        const delay = isRateLimit
          ? Math.max(RETRY_DELAYS[attempt] || 10000, 5000)
          : RETRY_DELAYS[attempt] || 2000;
        console.log(
          `[RETRY] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed (status=${status}, code=${metaCode || err.code}), retrying in ${delay}ms...`,
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable error or max retries reached
      break;
    }
  }
  throw lastError;
}

async function sendTemplate(to) {
  return withRetry(`sendTemplate(${to})`, () =>
    axios.post(
      `${API_BASE}/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: "sticker_intro",
          language: { code: "id" },
        },
      },
      { headers: getHeaders(), timeout: 30000 },
    ),
  );
}

async function downloadMedia(mediaId, output) {
  return withRetry(`downloadMedia(${mediaId})`, async () => {
    const media = await axios.get(`${API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.TOKEN}` },
      timeout: 15000,
    });

    const file = await axios.get(media.data.url, {
      responseType: "arraybuffer",
      headers: { Authorization: `Bearer ${process.env.TOKEN}` },
      timeout: 60000, // Media downloads can be large
    });

    fs.writeFileSync(output, file.data);
    console.log(`[DOWNLOAD] Media ${mediaId} saved (${Math.round(file.data.length / 1024)}KB)`);
  });
}

async function sendSticker(to, id) {
  return withRetry(`sendSticker(${to}, ${id})`, () =>
    axios.post(
      `${API_BASE}/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "sticker",
        sticker: {
          link: `${process.env.BASE_URL}/stickers/${id}.webp`,
        },
      },
      { headers: getHeaders(), timeout: 30000 },
    ),
  );
}

async function sendText(to, text) {
  return withRetry(`sendText(${to})`, () =>
    axios.post(
      `${API_BASE}/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      { headers: getHeaders(), timeout: 30000 },
    ),
  );
}

module.exports = { sendTemplate, downloadMedia, sendSticker, sendText };
