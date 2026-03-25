const axios = require("axios");

// ============================================
// OpenRouter AI Agent Module
// ============================================

// In-memory conversation history per user (keyed by phone number)
// Each entry: { role: "user"|"assistant"|"system", content: string }
const conversations = new Map();

// Config
const MAX_HISTORY = 20; // Max messages per user to keep in context
const HISTORY_TTL = 30 * 60 * 1000; // 30 minutes - clear history after inactivity
const lastActivity = new Map();

// Cleanup inactive conversations periodically
setInterval(
  () => {
    const now = Date.now();
    for (const [userId, lastTime] of lastActivity.entries()) {
      if (now - lastTime > HISTORY_TTL) {
        conversations.delete(userId);
        lastActivity.delete(userId);
      }
    }
  },
  5 * 60 * 1000,
);

/**
 * Build system prompt for the AI
 * This defines the bot's personality and capabilities
 */
function getSystemPrompt(statsContext = "") {
  const customPrompt = process.env.AI_SYSTEM_PROMPT || "";

  let basePrompt = `Kamu adalah asisten WhatsApp bernama "${process.env.AI_BOT_NAME || "Touya Bot"}".
Kamu cerdas, ramah, dan bisa membantu berbagai hal.

Kemampuan khusus bot ini:
- Mengubah gambar menjadi sticker WhatsApp (user kirim gambar → otomatis jadi sticker)
- Mengubah video pendek (maks 6 detik) menjadi sticker animasi (user kirim video → otomatis jadi sticker)
- Menjawab pertanyaan dan chat menggunakan AI

Perintah khusus:
- "stats" atau "statistik" → tampilkan statistik bot
- "reset" → reset percakapan AI

Panduan menjawab:
- Jawab dalam bahasa yang sama dengan yang digunakan user
- Jangan terlalu panjang, ringkas tapi informatif
- Gunakan emoji secukupnya biar terasa friendly
- Jika user bertanya cara pakai sticker, jelaskan: kirim gambar/video langsung ke chat ini
- Kamu boleh membahas topik apa saja selama sopan dan bermanfaat
- Gunakan formatting WhatsApp: *bold*, _italic_, ~strikethrough~, \`\`\`code\`\`\``;

  if (statsContext) {
    basePrompt += `\n\nJika user bertanya info stat/statistikmu, gunakan data ini (sampaikan dengan gaya bahasamu sendiri tanpa mengarang angka palsu):\n${statsContext}`;
  }

  if (customPrompt) {
    return `${basePrompt}\n\nInstruksi tambahan dari admin:\n${customPrompt}`;
  }

  return basePrompt;
}

/**
 * Get AI response from OpenRouter
 * @param {string} userId - User phone number
 * @param {string} message - User's message text
 * @param {string} statsStr - Current bot statistics to inform AI
 * @returns {Promise<string>} AI response text
 */
async function getAIResponse(userId, message, statsStr = "") {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  // Update activity timestamp
  lastActivity.set(userId, Date.now());

  // Initialize conversation if new
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }

  const history = conversations.get(userId);

  // Add user message to history
  history.push({ role: "user", content: message });

  // Trim history if too long (keep system + last N messages)
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  // Build messages array with system prompt
  const messages = [
    { role: "system", content: getSystemPrompt(statsStr) },
    ...history,
  ];

  try {
    const model = process.env.AI_MODEL || "google/gemini-2.0-flash-001";

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages,
        max_tokens: parseInt(process.env.AI_MAX_TOKENS || "1024", 10),
        temperature: parseFloat(process.env.AI_TEMPERATURE || "0.7"),
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

    const aiMessage =
      response.data.choices?.[0]?.message?.content ||
      "Maaf, aku tidak bisa menjawab saat ini.";

    // Add assistant response to history
    history.push({ role: "assistant", content: aiMessage });

    // Log usage if available
    const usage = response.data.usage;
    if (usage) {
      console.log(
        `[AI] Model: ${model} | Tokens: ${usage.prompt_tokens}+${usage.completion_tokens}=${usage.total_tokens}`,
      );
    }

    return aiMessage;
  } catch (err) {
    // Don't save failed interaction in history
    history.pop(); // Remove the user message we just added

    if (err.response) {
      console.error(
        "[AI] API Error:",
        err.response.status,
        JSON.stringify(err.response.data),
      );

      if (err.response.status === 429) {
        return "⏳ AI sedang sibuk, coba lagi dalam beberapa detik ya!";
      }
      if (err.response.status === 402) {
        return "⚠️ Kredit AI sudah habis. Hubungi admin.";
      }
    }

    console.error("[AI] Error:", err.message);
    throw err;
  }
}

/**
 * Clear conversation history for a user
 */
function clearHistory(userId) {
  conversations.delete(userId);
  lastActivity.delete(userId);
}

/**
 * Get conversation stats
 */
function getConversationStats() {
  return {
    activeConversations: conversations.size,
    totalMessages: [...conversations.values()].reduce(
      (sum, h) => sum + h.length,
      0,
    ),
  };
}

module.exports = {
  getAIResponse,
  clearHistory,
  getConversationStats,
};
