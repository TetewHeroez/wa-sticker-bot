const express = require("express");
const fs = require("fs");
const path = require("path");
const { handleWebhook } = require("./handlers/message");

const app = express();

// Ensure directories exist
["media/input", "media/output", "data"].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// === CLEANUP ON RESTART ===
const STARTUP_CLEANUP = true;
if (STARTUP_CLEANUP) {
  console.log("[INIT] Clearing old processing cache...");
  ["media/input", "media/output"].forEach((dir) => {
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

app.use(express.json());
app.use("/stickers", express.static("media/output"));

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
  await handleWebhook(req.body);
});

module.exports = app;
