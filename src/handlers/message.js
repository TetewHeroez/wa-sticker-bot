const fs = require("fs");
const {
  convertToSticker,
  convertVideoToSticker,
  MAX_VIDEO_DURATION_SECONDS,
} = require("../services/converter");
const { sendText, downloadMedia } = require("../services/whatsapp");
const { getAIResponse, clearHistory } = require("../services/ai");
const { mediaQueue, rateLimitedSendSticker } = require("../utils/queue");
const { logActivity } = require("../utils/logger");
const { stats, saveStats, getBotStatsStr } = require("../utils/stats");
const { hasProcessed, markProcessed } = require("../utils/processed");
const { generateBratSticker, generateBratGif } = require("../services/brat");
const templates = require("../templates");

const MAX_INCOMING_MESSAGE_AGE_SECONDS = Number.parseInt(
  process.env.MAX_INCOMING_MESSAGE_AGE_SECONDS || "600",
  10,
);

function isStaleMessage(message) {
  const timestamp = Number(message.timestamp);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const ageSeconds = Date.now() / 1000 - timestamp;
  return ageSeconds > MAX_INCOMING_MESSAGE_AGE_SECONDS;
}

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
    // Log raw webhook untuk debug (compact — only type/id/from)
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
      return;
    }

    if (value.statuses) {
      return;
    }

    // Collect all media processing promises so we can track them
    const processingPromises = [];

    for (const msg of value.messages) {
      if (!msg || !msg.id || !msg.from || !msg.type) {
        console.log("[SKIP] Invalid message structure");
        continue;
      }

      // Ignore messages from bot itself (echo prevention)
      const metadata = value.metadata;
      if (msg.from === metadata?.display_phone_number?.replace(/\D/g, "")) {
        continue;
      }

      if (isStaleMessage(msg)) {
        const ageSeconds = Math.floor(Date.now() / 1000 - Number(msg.timestamp));
        console.log(
          `[SKIP] Stale message: ${msg.id} (${ageSeconds}s old, limit=${MAX_INCOMING_MESSAGE_AGE_SECONDS}s)`,
        );
        continue;
      }

      // Prevent duplicate processing
      if (hasProcessed(msg.id)) {
        console.log("[SKIP] Already processed:", msg.id);
        continue;
      }
      markProcessed(msg.id);

      console.log(
        `[PROCESS] from=${msg.from} type=${msg.type} id=${msg.id}`,
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
            const p = mediaQueue(async () => {
              const stickerName = `brat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const outputPath = `media/output/${stickerName}.webp`;
              try {
                await generateBratGif(bratText, outputPath);
                await rateLimitedSendSticker(from, stickerName, 500);
                stats.stickers++;
                saveStats();
                logActivity("BRAT_GIF", from, { text: bratText });
                setTimeout(() => cleanup(outputPath), 120000);
              } catch (err) {
                console.error("Brat GIF error:", err.message);
                await sendText(
                  from,
                  "❌ Gagal membuat brat stiker animasi. Coba lagi!",
                ).catch(() => {});
                logActivity("ERROR_BRAT_GIF", from, { error: err.message });
              }
            });
            processingPromises.push(p);
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
            const p = mediaQueue(async () => {
              const stickerName = `brat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
              const outputPath = `media/output/${stickerName}.webp`;
              try {
                await generateBratSticker(bratText, outputPath);
                await rateLimitedSendSticker(from, stickerName, 0);
                stats.stickers++;
                saveStats();
                logActivity("BRAT_STICKER", from, { text: bratText });
                setTimeout(() => cleanup(outputPath), 120000);
              } catch (err) {
                console.error("Brat sticker error:", err.message);
                await sendText(
                  from,
                  "❌ Gagal membuat brat stiker. Coba lagi!",
                ).catch(() => {});
                logActivity("ERROR_BRAT", from, { error: err.message });
              }
            });
            processingPromises.push(p);
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
        const p = mediaQueue(async () => {
          const mediaId = msg.image.id;
          const inputPath = `media/input/${mediaId}`;
          const outputPath = `media/output/${mediaId}.webp`;
          const startTime = Date.now();

          try {
            console.log(`[IMAGE] Downloading media ${mediaId}...`);
            await downloadMedia(mediaId, inputPath);

            console.log(`[IMAGE] Converting to sticker...`);
            await convertToSticker(inputPath, outputPath);

            console.log(`[IMAGE] Sending sticker...`);
            await rateLimitedSendSticker(from, mediaId, 0);
            console.log(`[IMAGE] Sticker sent successfully!`);

            stats.stickers++;
            saveStats();

            const processingTime = Date.now() - startTime;
            logActivity("STICKER_IMAGE", from, {
              processingTimeMs: processingTime,
              totalStickers: stats.stickers,
              messageId: msg.id,
              mediaId,
              messageTimestamp: msg.timestamp,
              mediaSha256: msg.image.sha256,
            });

            cleanup(inputPath);
            setTimeout(() => cleanup(outputPath), 120000);
          } catch (err) {
            console.error(
              `[IMAGE] Error for mediaId=${mediaId}:`,
              JSON.stringify(err.response?.data || err.message, null, 2),
            );
            logActivity("ERROR_IMAGE", from, {
              error: err.response?.data?.error?.message || err.message,
              mediaId,
              messageId: msg.id,
            });
            await sendText(
              from,
              "❌ Gagal mengkonversi gambar. Pastikan gambar tidak rusak!",
            ).catch(() => {});
            // Clean up partial files
            cleanup(inputPath);
            cleanup(outputPath);
          }
        });
        processingPromises.push(p);
      }

      // VIDEO → ANIMATED STICKER
      if (msg.type === "video") {
        console.log(`[VIDEO] Received video from ${from}, mediaId: ${msg.video.id}`);
        const p = mediaQueue(async () => {
          const mediaId = msg.video.id;
          const inputPath = `media/input/${mediaId}.mp4`;
          const outputPath = `media/output/${mediaId}.webp`;
          const startTime = Date.now();

          try {
            console.log(`[VIDEO] Downloading media ${mediaId}...`);
            await downloadMedia(mediaId, inputPath);
            console.log(`[VIDEO] Converting to animated sticker...`);
            await convertVideoToSticker(inputPath, outputPath);
            console.log(`[VIDEO] Sending sticker...`);

            await rateLimitedSendSticker(from, mediaId, 500);
            console.log(`[VIDEO] Sticker sent successfully!`);

            stats.stickers++;
            saveStats();

            const processingTime = Date.now() - startTime;
            logActivity("STICKER_VIDEO", from, {
              processingTimeMs: processingTime,
              totalStickers: stats.stickers,
            });

            cleanup(inputPath);
            setTimeout(() => cleanup(outputPath), 120000);
          } catch (err) {
            console.error(
              "[VIDEO] Conversion/send error:",
              JSON.stringify(err.response?.data || err.message, null, 2),
            );
            logActivity("ERROR_VIDEO", from, {
              error: err.response?.data || err.message,
            });
            await sendText(
              from,
              `❌ Gagal mengkonversi video. Durasi boleh maksimal ${MAX_VIDEO_DURATION_SECONDS} detik, tapi output stiker animasi WhatsApp tetap harus di bawah 500KB. Coba video yang gerakannya lebih sedikit atau durasinya lebih pendek.`,
            ).catch(() => {});
            cleanup(inputPath);
            cleanup(outputPath);
          }
        });
        processingPromises.push(p);
      }

      // DOCUMENT (image/video/gif) → STICKER
      if (msg.type === "document") {
        const doc = msg.document;
        const mime = (doc.mime_type || "").toLowerCase();
        const filename = (doc.filename || "").toLowerCase();

        // GIF → Animated Sticker
        const isGifDoc =
          mime === "image/gif" || filename.endsWith(".gif");

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

        if (isGifDoc) {
          const p = mediaQueue(async () => {
            const mediaId = doc.id;
            const inputPath = `media/input/${mediaId}.gif`;
            const outputPath = `media/output/${mediaId}.webp`;
            const startTime = Date.now();

            try {
              await downloadMedia(mediaId, inputPath);
              await convertVideoToSticker(inputPath, outputPath);

              await rateLimitedSendSticker(from, mediaId, 500);

              stats.stickers++;
              saveStats();

              const processingTime = Date.now() - startTime;
              logActivity("STICKER_DOCUMENT_GIF", from, {
                processingTimeMs: processingTime,
                totalStickers: stats.stickers,
                mimeType: mime,
                filename: doc.filename,
              });

              cleanup(inputPath);
              setTimeout(() => cleanup(outputPath), 120000);
            } catch (err) {
              console.error(
                "Document GIF conversion error:",
                JSON.stringify(err.response?.data || err.message, null, 2),
              );
              logActivity("ERROR_DOCUMENT_GIF", from, {
                error: err.response?.data?.error?.message || err.message,
                mimeType: mime,
              });
              await sendText(
                from,
                "❌ Gagal mengkonversi GIF ke stiker animasi. Pastikan ukuran GIF tidak terlalu besar!",
              ).catch(() => {});
              cleanup(inputPath);
              cleanup(outputPath);
            }
          });
          processingPromises.push(p);
        } else if (isImageDoc) {
          const p = mediaQueue(async () => {
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
              setTimeout(() => cleanup(outputPath), 120000);
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
              cleanup(inputPath);
              cleanup(outputPath);
            }
          });
          processingPromises.push(p);
        } else if (isVideoDoc) {
          const p = mediaQueue(async () => {
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
              setTimeout(() => cleanup(outputPath), 120000);
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
                `❌ Gagal mengkonversi dokumen video. Durasi boleh maksimal ${MAX_VIDEO_DURATION_SECONDS} detik, tapi output stiker animasi WhatsApp tetap harus di bawah 500KB.`,
              ).catch(() => {});
              cleanup(inputPath);
              cleanup(outputPath);
            }
          });
          processingPromises.push(p);
        } else {
          console.log(
            `[SKIP] Document bukan gambar/video/gif: mime=${mime}, filename=${doc.filename}`,
          );
        }
      }
    }

    // Wait for ALL media processing in this webhook to finish.
    // This ensures we don't lose track of any in-flight work.
    if (processingPromises.length > 0) {
      console.log(`[WEBHOOK] Waiting for ${processingPromises.length} media task(s) to complete...`);
      await Promise.allSettled(processingPromises);
      console.log(`[WEBHOOK] All ${processingPromises.length} media task(s) done.`);
    }
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err.message);
  }
}

module.exports = { handleWebhook };
