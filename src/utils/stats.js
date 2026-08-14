const fs = require("fs");
const { getConversationStats } = require("../services/ai");

const STATS_FILE = "data/stats.json";

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

module.exports = { stats, saveStats, getBotStatsStr };
