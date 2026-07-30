require("dotenv").config();
const axios = require("axios");

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.AI_MODEL || "google/gemini-3.5-flash-lite";

function explainStatus(status) {
  switch (status) {
    case 400:
      return "Request ditolak. Biasanya model/payload tidak cocok.";
    case 401:
      return "API key salah, expired, atau belum aktif.";
    case 402:
      return "Kredit OpenRouter habis atau billing belum siap.";
    case 403:
      return "Akses ditolak. Cek izin key atau model.";
    case 404:
      return "Model tidak ditemukan atau nama AI_MODEL salah.";
    case 408:
      return "Request timeout di sisi server.";
    case 429:
      return "Rate limit. Tunggu sebentar atau ganti model/provider.";
    default:
      if (status >= 500) {
        return "Gangguan di OpenRouter/provider model. Coba lagi atau ganti model sementara.";
      }
      return "Error API tidak dikenal. Lihat detail di bawah.";
  }
}

async function main() {
  if (!apiKey) {
    console.error("[FAIL] OPENROUTER_API_KEY belum diisi di .env");
    process.exitCode = 1;
    return;
  }

  console.log(`[INFO] Mengecek OpenRouter dengan model: ${model}`);

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages: [
          {
            role: "user",
            content: "Balas singkat: AI OK",
          },
        ],
        max_tokens: 20,
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.BASE_URL || "https://localhost",
          "X-Title": process.env.AI_BOT_NAME || "Touya Bot",
        },
        timeout: 30000,
      },
    );

    const message = response.data.choices?.[0]?.message?.content;

    if (!message || !message.trim()) {
      console.error("[FAIL] API HTTP 200, tapi balasan teks kosong.");
      console.error("[HINT] Coba ganti AI_MODEL ke model chat lain, misalnya google/gemini-3.5-flash-lite.");
      process.exitCode = 1;
      return;
    }

    console.log("[OK] API AI normal.");
    console.log(`[OK] Balasan: ${message}`);

    if (response.data.usage) {
      const usage = response.data.usage;
      console.log(
        `[INFO] Token: ${usage.prompt_tokens}+${usage.completion_tokens}=${usage.total_tokens}`,
      );
    }
  } catch (err) {
    process.exitCode = 1;

    if (err.response) {
      const status = err.response.status;
      console.error(`[FAIL] HTTP ${status}: ${explainStatus(status)}`);
      console.error("[DETAIL]", JSON.stringify(err.response.data, null, 2));
      return;
    }

    if (err.code === "ECONNABORTED") {
      console.error("[FAIL] Timeout. OpenRouter/provider lambat atau koneksi server bermasalah.");
      return;
    }

    console.error(`[FAIL] Network/error lokal: ${err.message}`);
  }
}

main();
