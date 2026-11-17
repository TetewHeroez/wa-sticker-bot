require("dotenv").config();
const app = require("./src/app");

const port = process.env.PORT;
const server = app.listen(port, () => console.log(`Bot running on port ${port}...`));

// Jangan diam-diam "running" kalau port gagal di-bind (mis. EADDRINUSE).
server.on("error", (err) => {
  console.error(`[FATAL] Gagal listen di port ${port}: ${err.code || err.message}`);
  process.exit(1);
});
