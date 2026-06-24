const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '.env'),
  quiet: true,
  override: false,
});

module.exports = {
    PORT: process.env.PORT || 50900,
    SESSION_PREFIX: process.env.SESSION_PREFIX || "Dark~",
    GC_JID: process.env.GC_JID || "FGzzdtWGUsf9qI9XgcWpz5",
    DATABASE_URL: process.env.DATABASE_URL || "",
    BOT_REPO: process.env.BOT_REPO || "https://github.com/ryanjj-49/DARK-PRINCE-MD",
    WA_CHANNEL: process.env.WA_CHANNEL || "https://whatsapp.com/channel/0029VbD4QUr8kyyDXFRibW1p",
    MSG_FOOTER: process.env.MSG_FOOTER || "> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ DARK-PRINCE-MD*",
};
