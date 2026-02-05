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
const processed = new Set(); // Track processed message IDs
const stats = { stickers: 0, startTime: Date.now() }; // Track stats

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
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;

    // Prevent duplicate processing
    if (processed.has(msg.id)) return;
    processed.add(msg.id);

    // Cleanup old processed IDs (keep last 1000)
    if (processed.size > 1000) {
      const arr = [...processed];
      arr.slice(0, arr.length - 1000).forEach((id) => processed.delete(id));
    }

    const from = msg.from;

    // TEXT → HELP / STATS
    if (msg.type === "text") {
      const text = msg.text.body.toLowerCase().trim();

      if (text === "stats" || text === "statistik") {
        const uptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60);
        await sendText(
          from,
          `📊 *Statistik Bot*\n\nSticker dibuat: ${stats.stickers}\nUptime: ${uptime} menit`,
        );
      } else {
        // Show help for any text message
        await sendText(from, templates.HELP_MESSAGE);
      }
    }

    // IMAGE → STICKER (Static)
    if (msg.type === "image") {
      const mediaId = msg.image.id;
      const inputPath = `media/input/${mediaId}`;
      const outputPath = `public/stickers/${mediaId}.webp`;

      try {
        await sendText(from, "⏳ _Sedang memproses gambar..._");
        await downloadMedia(mediaId, inputPath);
        await convertToSticker(inputPath, outputPath);
        await sendSticker(from, mediaId);
        stats.stickers++;
        cleanup(inputPath);
        // Delete sticker file after 60 seconds
        setTimeout(() => cleanup(outputPath), 60000);
      } catch (err) {
        console.error("Image conversion error:", err.message);
        await sendText(from, "❌ Gagal mengkonversi gambar. Coba lagi ya!");
      }
    }

    // VIDEO → ANIMATED STICKER
    if (msg.type === "video") {
      const mediaId = msg.video.id;
      const inputPath = `media/input/${mediaId}.mp4`;
      const outputPath = `public/stickers/${mediaId}.webp`;

      try {
        await sendText(from, "⏳ _Sedang memproses video..._");
        await downloadMedia(mediaId, inputPath);
        await convertVideoToSticker(inputPath, outputPath);
        await sendSticker(from, mediaId);
        stats.stickers++;
        cleanup(inputPath);
        // Delete sticker file after 60 seconds
        setTimeout(() => cleanup(outputPath), 60000);
      } catch (err) {
        console.error("Video conversion error:", err.message);
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
