# WhatsApp Sticker & AI Bot

Bot WhatsApp canggih yang dirancang dengan arsitektur modular untuk mengkonversi gambar/video menjadi sticker, serta dilengkapi dengan Asisten AI interaktif dan generator Brat sticker.

## Fitur Utama

- 📸 **Sticker Statis**: Kirim gambar (atau dokumen gambar) otomatis jadi sticker.
- 🎥 **Sticker Animasi**: Kirim video/GIF (maks 6 detik, atau dokumen video) otomatis jadi sticker animasi.
- 🟢 **Brat Sticker**: Ketik `.brat [teks]` untuk stiker bergaya album *Brat* statis, atau `.bratgif [teks]` untuk versi animasi kata per kata!
- 💬 **AI Agent**: Ngobrol bebas dengan AI yang pintar! Cukup kirim pesan teks. AI juga bisa mengingat percakapan.
- 📊 **Statistik**: Ketik `stats` untuk melihat penggunaan bot dan uptime.
- 🧹 **Auto-Cleanup**: Menghapus file media temporary secara otomatis untuk menghemat ruang disk.
- ⏱️ **Rate Limiting**: Mencegah blokir API Meta WhatsApp dengan sistem antrean pengiriman.

## Struktur Project

Project ini sudah di-refactor ke arsitektur modular untuk kemudahan pengembangan:
- `src/handlers/` - Logika penanganan pesan masuk (webhook).
- `src/services/` - Integrasi eksternal (WhatsApp API, OpenRouter AI, FFmpeg converter, Brat generator).
- `src/utils/` - Utilitas tambahan (logger, antrean, penyimpanan status).
- `media/` - Folder penyimpanan sementara untuk input/output media.
- `data/` - Penyimpanan persisten untuk statistik dan log (tidak masuk ke Git).

## Requirements

- Node.js 18+
- FFmpeg (untuk konversi media dan GIF)
- WhatsApp Business API access
- OpenRouter API Key (untuk AI)

## Instalasi

1. Clone repo dan masuk ke direktori:
   ```bash
   git clone https://github.com/username/wa-sticker-bot.git
   cd wa-sticker-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Install FFmpeg:
   - **Windows**: `winget install FFmpeg`
   - **Mac**: `brew install ffmpeg`
   - **Linux**: `sudo apt install ffmpeg`

4. Copy konfigurasi environment:
   ```bash
   cp .env.example .env
   ```
   Isi file `.env` dengan token dari Meta WhatsApp dan OpenRouter.

5. Jalankan bot (via PM2 atau Node langsung):
   ```bash
   # Menjalankan langsung
   npm start
   
   # Atau menggunakan PM2 (via script batch)
   .\scripts\start-bot.bat
   ```

## Script Lainnya

- Cek status API AI: `npm run check:ai`
- Menjalankan mode dev: `npm run dev`

## License

MIT
