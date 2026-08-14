const fs = require("fs");

const LOG_FILE = "data/activity.log";

/**
 * Log activity to file and console
 * @param {string} type - Activity type (e.g. STICKER_IMAGE, AI_CHAT)
 * @param {string} from - Phone number of the sender
 * @param {object} details - Additional details to log
 */
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

module.exports = { logActivity };
