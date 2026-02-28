require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { convertToSticker, convertVideoToSticker } = require("./convert");
const templates = require("./templates");

// Ensure directories exist
["media/input", "media/output", "public/stickers"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

    const msg = value.messages[0];
    if (!msg || !msg.id || !msg.from || !msg.type) {
      console.log("[SKIP] Invalid message structure");
      return;
    }

    // CRITICAL: Ignore old messages (older than 60 seconds)
    // WhatsApp sometimes replays old messages on reconnect
    const msgTimestamp = parseInt(msg.timestamp, 10) * 1000; // Convert to ms
    const now = Date.now();
    const ageSeconds = (now - msgTimestamp) / 1000;

    if (ageSeconds > 60) {
      console.log(
        "[SKIP] Old message, age:",
        Math.floor(ageSeconds),
        "seconds, ID:",
        msg.id,
      );
      return;
    }

    // Ignore messages from bot itself (echo prevention)
    const metadata = value.metadata;
    if (msg.from === metadata?.display_phone_number?.replace(/\D/g, "")) {
      console.log("[SKIP] Message from bot itself");
      return;
    }

    // Prevent duplicate processing
    if (processed.has(msg.id)) {
      console.log("[SKIP] Already processed:", msg.id);
      return;
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
      "Age:",
      Math.floor(ageSeconds),
      "sec",
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
      return;
    }

    // TEXT → HELP / STATS
    if (msg.type === "text") {
      const text = msg.text.body.toLowerCase().trim();

      if (text === "stats" || text === "statistik") {
        // Calculate total uptime (accumulated + current session)
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

        await sendText(
          from,
          `📊 *Statistik Bot*\n\nSticker dibuat: ${stats.stickers}\nTotal uptime: ${uptimeStr}`,
        );
        logActivity("STATS", from, {
          stickers: stats.stickers,
          uptimeMinutes: totalMinutes,
        });
      } else {
        // Show help for any text message
        await sendText(from, templates.HELP_MESSAGE);
        logActivity("HELP", from);
      }
    }

    // IMAGE → STICKER (Static)
    if (msg.type === "image") {
      const mediaId = msg.image.id;
      const inputPath = `media/input/${mediaId}`;
      const outputPath = `public/stickers/${mediaId}.webp`;
      const startTime = Date.now();

      try {
        await sendText(from, "⏳ _Sedang memproses gambar..._");
        await downloadMedia(mediaId, inputPath);
        await convertToSticker(inputPath, outputPath);
        await sendSticker(from, mediaId);
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
        console.error("Image conversion error:", err.message);
        logActivity("ERROR_IMAGE", from, { error: err.message });
        await sendText(from, "❌ Gagal mengkonversi gambar. Coba lagi ya!");
      }
    }

    // VIDEO → ANIMATED STICKER
    if (msg.type === "video") {
      const mediaId = msg.video.id;
      const inputPath = `media/input/${mediaId}.mp4`;
      const outputPath = `public/stickers/${mediaId}.webp`;
      const startTime = Date.now();

      try {
        await sendText(from, "⏳ _Sedang memproses video..._");
        await downloadMedia(mediaId, inputPath);
        await convertVideoToSticker(inputPath, outputPath);
        await sendSticker(from, mediaId);
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
        console.error("Video conversion error:", err.message);
        logActivity("ERROR_VIDEO", from, { error: err.message });
        await sendText(
          from,
          "❌ Gagal mengkonversi video. Pastikan durasi < 6 detik!",
        );
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
