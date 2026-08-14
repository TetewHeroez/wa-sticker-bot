const axios = require("axios");
const fs = require("fs");

async function sendTemplate(to) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "sticker_intro",
        language: { code: "id" },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

async function downloadMedia(mediaId, output) {
  const media = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`,
    },
  });

  const file = await axios.get(media.data.url, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`,
    },
  });

  fs.writeFileSync(output, file.data);
}

async function sendSticker(to, id) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "sticker",
      sticker: {
        link: `${process.env.BASE_URL}/stickers/${id}.webp`,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

async function sendText(to, text) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        "Content-Type": "application/json",
      },
    },
  );
}

module.exports = { sendTemplate, downloadMedia, sendSticker, sendText };
