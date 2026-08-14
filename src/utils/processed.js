const fs = require("fs");

const PROCESSED_FILE = "data/processed_ids.json";
let processed = new Set();

// Load from disk
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

/**
 * Check if a message ID has already been processed
 */
function hasProcessed(id) {
  return processed.has(id);
}

/**
 * Mark a message ID as processed and persist to disk
 */
function markProcessed(id) {
  processed.add(id);
  saveProcessedIds();

  // Cleanup old entries (keep last 1000)
  if (processed.size > 1000) {
    const arr = [...processed];
    arr.slice(0, arr.length - 1000).forEach((oldId) => processed.delete(oldId));
  }
}

module.exports = { hasProcessed, markProcessed };
