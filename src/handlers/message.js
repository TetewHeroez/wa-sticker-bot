const fs = require("fs");
const {
  convertToSticker,
  convertVideoToSticker,
} = require("../services/converter");
const { sendText, downloadMedia } = require("../services/whatsapp");
const { getAIResponse, clearHistory } = require("../services/ai");
const { mediaQueue, rateLimitedSendSticker } = require("../utils/queue");
const { logActivity } = require("../utils/logger");
const { stats, saveStats, getBotStatsStr } = require("../utils/stats");
const { hasProcessed, markProcessed } = require("../utils/processed");
const { generateBratSticker, generateBratGif } = require("../services/brat");
const templates = require("../templates");

/**
 * Clean up temporary files
 */
function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}

/**
 * Handle incoming webhook payload from WhatsApp
 */
async function handleWebhook(body) {
  try {
    // Log raw webhook untuk debug
    console.log("[WEBHOOK]", JSON.stringify(body, null, 2));

    const entry = body.entry?.[0];
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
      if (hasProcessed(msg.id)) {
        console.log("[SKIP] Already processed:", msg.id);
        continue;
      }
      markProcessed(msg.id);

      console.log(
        "[PROCESS] Message from:",
        msg.from,
        "Type:",
        msg.type,
        "ID:",
        msg.id,
      );

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
        } else if (text.startsWith(".bratgif ")) {
          // BRAT ANIMATED STICKER (word-by-word reveal)
          const bratText = text.slice(9).trim();
          if (!bratText) {
            await sendText(
              from,
              "❌ Tulis teks setelah .bratgif\n\nContoh: *.bratgif halo dunia*",
            );
          } else {
            mediaQueue(async () => {
              const stickerName = `brat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const outputPath = `media/output/${stickerName}.webp`;
              try {
                await generateBratGif(bratText, outputPath);
                await rateLimitedSendSticker(from, stickerName, 500);
                stats.stickers++;
                saveStats();
                logActivity("BRAT_GIF", from, { text: bratText });
                setTimeout(() => cleanup(outputPath), 60000);
              } catch (err) {
                console.error("Brat GIF error:", err.message);
                await sendText(
                  from,
                  "❌ Gagal membuat brat stiker animasi. Coba lagi!",
                ).catch(() => {});
                logActivity("ERROR_BRAT_GIF", from, { error: err.message });
              }
            });
          }
        } else if (text.startsWith(".brat ")) {
          // BRAT STATIC STICKER
          const bratText = text.slice(6).trim();
          if (!bratText) {
            await sendText(
              from,
              "❌ Tulis teks setelah .brat\n\nContoh: *.brat halo dunia*",
            );
          } else {
            mediaQueue(async () => {
              const stickerName = `brat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const outputPath = `media/output/${stickerName}.webp`;
              try {
                await generateBratSticker(bratText, outputPath);
                await rateLimitedSendSticker(from, stickerName, 0);
                stats.stickers++;
                saveStats();
                logActivity("BRAT_STICKER", from, { text: bratText });
                setTimeout(() => cleanup(outputPath), 60000);
              } catch (err) {
                console.error("Brat sticker error:", err.message);
                await sendText(
                  from,
                  "❌ Gagal membuat brat stiker. Coba lagi!",
                ).catch(() => {});
                logActivity("ERROR_BRAT", from, { error: err.message });
              }
            });
          }
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
          const outputPath = `media/output/${mediaId}.webp`;
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
          const outputPath = `media/output/${mediaId}.webp`;
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

      // DOCUMENT (image) → STICKER
      // Ketika user mengirim gambar sebagai dokumen (bukan lewat galeri/kamera),
      // WhatsApp mengirimnya sebagai tipe "document" bukan "image".
      if (msg.type === "document") {
        const doc = msg.document;
        const mime = (doc.mime_type || "").toLowerCase();
        const filename = (doc.filename || "").toLowerCase();
        const imageMimes = [
          "image/png",
          "image/jpeg",
          "image/jpg",
          "image/webp",
          "image/bmp",
          "image/tiff",
        ];
        const imageExtensions = [
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".bmp",
          ".tiff",
        ];
        const isImageDoc =
          imageMimes.includes(mime) ||
          imageExtensions.some((ext) => filename.endsWith(ext));

        const videoMimes = ["video/mp4", "video/3gpp", "video/quicktime"];
        const videoExtensions = [".mp4", ".3gp", ".mov"];
        const isVideoDoc =
          videoMimes.includes(mime) ||
          videoExtensions.some((ext) => filename.endsWith(ext));

        if (isImageDoc) {
          mediaQueue(async () => {
            const mediaId = doc.id;
            const ext = mime.includes("png")
              ? ".png"
              : mime.includes("webp")
                ? ".webp"
                : ".jpg";
            const inputPath = `media/input/${mediaId}${ext}`;
            const outputPath = `media/output/${mediaId}.webp`;
            const startTime = Date.now();

            try {
              await downloadMedia(mediaId, inputPath);
              await convertToSticker(inputPath, outputPath);

              await rateLimitedSendSticker(from, mediaId, 0);

              stats.stickers++;
              saveStats();

              const processingTime = Date.now() - startTime;
              logActivity("STICKER_DOCUMENT_IMAGE", from, {
                processingTimeMs: processingTime,
                totalStickers: stats.stickers,
                mimeType: mime,
                filename: doc.filename,
              });

              cleanup(inputPath);
              setTimeout(() => cleanup(outputPath), 60000);
            } catch (err) {
              console.error(
                "Document image conversion error:",
                JSON.stringify(err.response?.data || err.message, null, 2),
              );
              logActivity("ERROR_DOCUMENT_IMAGE", from, {
                error: err.response?.data?.error?.message || err.message,
                mimeType: mime,
              });
              await sendText(
                from,
                "❌ Gagal mengkonversi dokumen gambar ke stiker. Pastikan file tidak rusak!",
              ).catch(() => {});
            }
          });
        } else if (isVideoDoc) {
          mediaQueue(async () => {
            const mediaId = doc.id;
            const inputPath = `media/input/${mediaId}.mp4`;
            const outputPath = `media/output/${mediaId}.webp`;
            const startTime = Date.now();

            try {
              await downloadMedia(mediaId, inputPath);
              await convertVideoToSticker(inputPath, outputPath);

              await rateLimitedSendSticker(from, mediaId, 500);

              stats.stickers++;
              saveStats();

              const processingTime = Date.now() - startTime;
              logActivity("STICKER_DOCUMENT_VIDEO", from, {
                processingTimeMs: processingTime,
                totalStickers: stats.stickers,
                mimeType: mime,
                filename: doc.filename,
              });

              cleanup(inputPath);
              setTimeout(() => cleanup(outputPath), 60000);
            } catch (err) {
              console.error(
                "Document video conversion error:",
                err.response?.data || err.message,
              );
              logActivity("ERROR_DOCUMENT_VIDEO", from, {
                error: err.response?.data || err.message,
                mimeType: mime,
              });
              await sendText(
                from,
                "❌ Gagal mengkonversi dokumen video. Pastikan durasi < 6 detik!",
              ).catch(() => {});
            }
          });
        } else {
          console.log(
            `[SKIP] Document bukan gambar/video: mime=${mime}, filename=${doc.filename}`,
          );
        }
      }
    }
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
  }
}

module.exports = { handleWebhook };
