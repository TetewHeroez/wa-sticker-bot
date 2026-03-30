require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { convertToSticker, convertVideoToSticker } = require("./convert");
const templates = require("./templates");
const { getAIResponse, clearHistory, getConversationStats } = require("./ai");

// Use p-limit to prevent too many concurrent ffmpeg instances
const pLimit = require("p-limit").default || require("p-limit");
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

// Ensure directories exist
["media/input", "media/output", "public/stickers"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// === CLEANUP ON RESTART ===
const STARTUP_CLEANUP = true;
if (STARTUP_CLEANUP) {
  console.log("[INIT] Clearing old processing cache...");
  ["media/input", "public/stickers"].forEach((dir) => {
    try {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach((file) => {
          if (file !== ".gitkeep") {
            // preserve folder structure if needed
            fs.unlinkSync(path.join(dir, file));
          }
        });
      }
    } catch (e) {
      console.error(`[INIT] Hapus cache ${dir} gagal: ${e.message}`);
    }
  });
}

const app = express();

// === PERSISTENT STATS ===
const STATS_FILE = "stats.json";
const LOG_FILE = "activity.log";

let stats = {
  stickers: 0,
  firstStartTime: Date.now(), // Never changes after first run
  totalUptime: 0, // Accumulated uptime in ms
  lastStartTime: Date.now(), // Current session start
};

// Load stats from file
try {
  if (fs.existsSync(STATS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    stats.stickers = saved.stickers || 0;
    stats.firstStartTime = saved.firstStartTime || Date.now();
    stats.totalUptime = saved.totalUptime || 0;
    stats.lastStartTime = Date.now(); // New session starts now
    console.log(
      "[INIT] Loaded stats - Stickers:",
      stats.stickers,
      "Total uptime:",
      Math.floor(stats.totalUptime / 1000 / 60),
      "min",
    );
  }
} catch (e) {
  console.log("[INIT] Could not load stats:", e.message);
}

function getBotStatsStr() {
  const currentSessionUptime = Date.now() - stats.lastStartTime;
  const totalUptimeMs = stats.totalUptime + currentSessionUptime;
  const totalMinutes = Math.floor(totalUptimeMs / 1000 / 60);
  const days = Math.floor(totalMinutes / 60 / 24);
  const hours = Math.floor((totalMinutes / 60) % 24);
  const minutes = totalMinutes % 60;

  const uptimeStr =
    days > 0
      ? `${days} hari ${hours} jam ${minutes} menit`
      : hours > 0
        ? `${hours} jam ${minutes} menit`
        : `${minutes} menit`;

  const aiStats = getConversationStats();
  return `📊 *Statistik Bot*\n\nSticker dibuat: ${stats.stickers}\nTotal uptime: ${uptimeStr}\nPercakapan AI aktif: ${aiStats.activeConversations}\nTotal pesan AI: ${aiStats.totalMessages}`;
}

function saveStats() {
  try {
    // Calculate current session uptime and add to total
    const currentSessionUptime = Date.now() - stats.lastStartTime;
    const toSave = {
      stickers: stats.stickers,
      firstStartTime: stats.firstStartTime,
      totalUptime: stats.totalUptime + currentSessionUptime,
    };
    fs.writeFileSync(STATS_FILE, JSON.stringify(toSave, null, 2));
  } catch (e) {
    console.error("[SAVE] Could not save stats:", e.message);
  }
}

// Save stats periodically (every 5 minutes) and on exit
setInterval(saveStats, 5 * 60 * 1000);
process.on("SIGINT", () => {
  saveStats();
  process.exit();
});
process.on("SIGTERM", () => {
  saveStats();
  process.exit();
});

// === ACTIVITY LOGGING ===
function logActivity(type, from, details = {}) {
  const timestamp = new Date().toISOString();
  const phoneNumber = from.replace(/\d{4}$/, "****"); // Mask last 4 digits for privacy
  const logEntry = `[${timestamp}] ${type} | From: ${phoneNumber} | ${JSON.stringify(details)}\n`;

  try {
    fs.appendFileSync(LOG_FILE, logEntry);
  } catch (e) {
    console.error("[LOG] Could not write log:", e.message);
  }

  console.log(logEntry.trim());
}

// Persistent processed IDs - survives restarts
const PROCESSED_FILE = "processed_ids.json";
let processed = new Set();
try {
  if (fs.existsSync(PROCESSED_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROCESSED_FILE, "utf8"));
    processed = new Set(data.slice(-1000)); // Keep last 1000
    console.log("[INIT] Loaded", processed.size, "processed IDs from disk");
  }
} catch (e) {
  console.log("[INIT] Could not load processed IDs:", e.message);
}

function saveProcessedIds() {
  try {
    fs.writeFileSync(
      PROCESSED_FILE,
      JSON.stringify([...processed].slice(-1000)),
    );
  } catch (e) {
    console.error("[SAVE] Could not save processed IDs:", e.message);
  }
}

app.use(express.json());
app.use("/stickers", express.static("public/stickers"));

/* --- WEBHOOK VERIFY --- */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* --- WEBHOOK RECEIVE --- */
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Respond immediately to avoid timeout

  try {
    // Log raw webhook untuk debug
    console.log("[WEBHOOK]", JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    if (!entry) return;

    const change = entry.changes?.[0];
    if (!change || change.field !== "messages") return;

    const value = change.value;
    if (!value) return;

    // STRICT: Hanya proses jika ada messages array DAN tidak ada statuses
    if (
      !value.messages ||
      !Array.isArray(value.messages) ||
      value.messages.length === 0
    ) {
      console.log("[SKIP] No messages array or empty");
      return;
    }

    if (value.statuses) {
      console.log("[SKIP] Status update, not a message");
      return;
    }

    for (const msg of value.messages) {
      if (!msg || !msg.id || !msg.from || !msg.type) {
        console.log("[SKIP] Invalid message structure");
        continue;
      }

      // Ignore messages from bot itself (echo prevention)
      const metadata = value.metadata;
      if (msg.from === metadata?.display_phone_number?.replace(/\D/g, "")) {
        console.log("[SKIP] Message from bot itself");
        continue;
      }

      // Prevent duplicate processing
      if (processed.has(msg.id)) {
        console.log("[SKIP] Already processed:", msg.id);
        continue;
      }
      processed.add(msg.id);
      saveProcessedIds(); // Persist to disk

      console.log(
        "[PROCESS] Message from:",
        msg.from,
        "Type:",
        msg.type,
        "ID:",
        msg.id,
      );

      // Cleanup old processed IDs (keep last 1000)
      if (processed.size > 1000) {
        const arr = [...processed];
        arr.slice(0, arr.length - 1000).forEach((id) => processed.delete(id));
      }

      const from = msg.from;
      const isMaintenance = process.env.MAINTENANCE_MODE === "true";

      if (isMaintenance) {
        await sendText(
          from,
          "🚧 Bot sedang perbaikan.\n\nMohon tunggu ya, fitur akan aktif kembali sebentar lagi ✨",
        );
        continue;
      }

      // TEXT → AI AGENT / COMMANDS
      if (msg.type === "text") {
        const text = msg.text.body.toLowerCase().trim();

        if (text === "stats" || text === "statistik") {
          const statsStr = getBotStatsStr();
          await sendText(from, statsStr);
          logActivity("STATS", from, {
            stickers: stats.stickers,
            uptimeMinutes: Math.floor(
              (stats.totalUptime + Date.now() - stats.lastStartTime) /
                1000 /
                60,
            ),
          });
        } else if (text === "reset" || text === "reset chat") {
          // Reset conversation history
          clearHistory(from);
          await sendText(
            from,
            "🔄 Percakapan AI telah direset. Mulai dari awal!",
          );
          logActivity("RESET_AI", from);
        } else if (text === "help" || text === "bantuan" || text === "menu") {
          await sendText(from, templates.HELP_MESSAGE);
          logActivity("HELP", from);
        } else {
          // AI Agent responds to all other text messages
          try {
            const statsStr = getBotStatsStr();
            const aiReply = await getAIResponse(from, msg.text.body, statsStr);
            await sendText(from, aiReply);
            logActivity("AI_CHAT", from, {
              messageLength: msg.text.body.length,
            });
          } catch (err) {
            console.error("[AI] Failed:", err.response?.data || err.message);
            await sendText(
              from,
              "❌ Maaf, AI sedang bermasalah. Coba lagi nanti ya!\n\nKetik *help* untuk melihat fitur lainnya.",
            );
            logActivity("AI_ERROR", from, {
              error: err.response?.data || err.message,
            });
          }
        }
      }

      // IMAGE → STICKER (Static)
      if (msg.type === "image") {
        mediaQueue(async () => {
          const mediaId = msg.image.id;
          const inputPath = `media/input/${mediaId}`;
          const outputPath = `public/stickers/${mediaId}.webp`;
          const startTime = Date.now();

          try {
            await downloadMedia(mediaId, inputPath);
            await convertToSticker(inputPath, outputPath);

            // Antre pengiriman stiker agar tidak kena limit Meta #131056
            await rateLimitedSendSticker(from, mediaId, 0);

            stats.stickers++;
            saveStats(); // Persist immediately

            const processingTime = Date.now() - startTime;
            logActivity("STICKER_IMAGE", from, {
              processingTimeMs: processingTime,
              totalStickers: stats.stickers,
            });

            cleanup(inputPath);
            setTimeout(() => cleanup(outputPath), 60000);
          } catch (err) {
            console.error(
              "Image conversion error (details):",
              JSON.stringify(err.response?.data || err.message, null, 2),
            );
            logActivity("ERROR_IMAGE", from, {
              error: err.response?.data?.error?.message || err.message,
            });
            await sendText(
              from,
              "❌ Gagal mengkonversi gambar. Pastikan gambar tidak rusak!",
            ).catch(() => {});
          }
        });
      }

      // VIDEO → ANIMATED STICKER
      if (msg.type === "video") {
        mediaQueue(async () => {
          const mediaId = msg.video.id;
          const inputPath = `media/input/${mediaId}.mp4`;
          const outputPath = `public/stickers/${mediaId}.webp`;
          const startTime = Date.now();

          try {
            await downloadMedia(mediaId, inputPath);
            await convertVideoToSticker(inputPath, outputPath);

            // Antre pengiriman stiker agar tidak kena limit Meta #131056
            await rateLimitedSendSticker(from, mediaId, 500);

            stats.stickers++;
            saveStats(); // Persist immediately

            const processingTime = Date.now() - startTime;
            logActivity("STICKER_VIDEO", from, {
              processingTimeMs: processingTime,
              totalStickers: stats.stickers,
            });

            cleanup(inputPath);
            setTimeout(() => cleanup(outputPath), 60000);
          } catch (err) {
            console.error(
              "Video conversion error:",
              err.response?.data || err.message,
            );
            logActivity("ERROR_VIDEO", from, {
              error: err.response?.data || err.message,
            });
            await sendText(
              from,
              "❌ Gagal mengkonversi video. Pastikan durasi < 6 detik!",
            ).catch(() => {});
          }
        });
      }
    }
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
  }
});

app.listen(process.env.PORT, () => console.log("Bot running..."));

/* ================= FUNCTIONS ================= */

async function sendTemplate(to) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "sticker_intro",
        language: { code: "id" },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

async function downloadMedia(mediaId, output) {
  const media = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`,
    },
  });

  const file = await axios.get(media.data.url, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`,
    },
  });

  fs.writeFileSync(output, file.data);
}

async function sendSticker(to, id) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "sticker",
      sticker: {
        link: `${process.env.BASE_URL}/stickers/${id}.webp`,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

async function sendText(to, text) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}
