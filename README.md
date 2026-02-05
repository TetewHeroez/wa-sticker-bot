# WhatsApp Sticker Bot

Bot WhatsApp untuk mengkonversi gambar dan video menjadi sticker.

## Fitur

- 📸 Kirim **gambar** → Sticker statis
- 🎥 Kirim **video** (maks 6 detik) → Sticker animasi
- 📊 Ketik **stats** → Lihat statistik bot
- ✨ Auto-delete file setelah 60 detik
- 🔄 Processing indicator

## Requirements

- Node.js 18+
- FFmpeg (untuk konversi media)
- WhatsApp Business API access

## Instalasi

1. Clone repo:

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

4. Copy `.env.example` ke `.env` dan isi konfigurasi:

   ```bash
   cp .env.example .env
   ```

5. Jalankan bot:

   ```bash
   npm start
   ```

   Atau dengan auto-restart saat file berubah:

   ```bash
   npm run dev
   ```

## Konfigurasi

Edit file `.env`:

| Variable          | Deskripsi                                  |
| ----------------- | ------------------------------------------ |
| `PORT`            | Port server (default: 3000)                |
| `BASE_URL`        | URL publik server (untuk sticker delivery) |
| `TOKEN`           | WhatsApp Cloud API token                   |
| `PHONE_NUMBER_ID` | ID nomor WhatsApp Business                 |
| `VERIFY_TOKEN`    | Token verifikasi webhook (bebas)           |

## Webhook Setup

1. Buka [Meta Developer Console](https://developers.facebook.com)
2. Pilih App → WhatsApp → Configuration
3. Setup webhook:
   - URL: `https://your-domain.com/webhook`
   - Verify Token: sesuai `.env`
4. Subscribe ke field: `messages`

## Tunnel untuk Development

Jika hosting di PC lokal, gunakan Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:3000 --protocol http2
```

## License

MIT
