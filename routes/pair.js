const { 
    giftedId,
    removeFile
} = require('../gift');
const { SESSION_PREFIX, GC_JID, BOT_REPO, WA_CHANNEL, MSG_FOOTER } = require('../config');
const { isConfigured, saveSession } = require('../gift/sessionStore');
const zlib = require('zlib');
const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router();
const pino = require("pino");
const { sendButtons } = require('gifted-btns');
const {
    default: giftedConnect,
    useMultiFileAuthState,
    delay,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const sessionDir = path.join(__dirname, "session");

// Cleanup stale session dirs older than 10 minutes on startup
try {
    if (fs.existsSync(sessionDir)) {
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const entry of fs.readdirSync(sessionDir)) {
            try {
                const p = path.join(sessionDir, entry);
                if (fs.statSync(p).isDirectory() && fs.statSync(p).mtimeMs < cutoff) {
                    fs.rmSync(p, { recursive: true, force: true });
                }
            } catch (_) {}
        }
    }
} catch (_) {}

router.get('/', async (req, res) => {
    const id = giftedId();
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    const sessionType = (req.query.type || 'short').toLowerCase();
    let responseSent = false;
    let sessionCleanedUp = false;
    let pairingDone = false;
    let reconnectCount = 0;
    const MAX_RECONNECTS = 10;

    async function cleanUpSession() {
        if (!sessionCleanedUp) {
            sessionCleanedUp = true;
            try { await removeFile(path.join(sessionDir, id)); } catch (_) {}
        }
    }

    async function GIFTED_PAIR_CODE() {
        const { version } = await fetchLatestBaileysVersion();
       // console.log(`[pair:${id}] version:`, version, '| registered:', false);
        const { state, saveCreds } = await useMultiFileAuthState(path.join(sessionDir, id));

        let Gifted;
        try {
            const pinoLogger = pino({ level: "fatal" }).child({ level: "fatal" });
            Gifted = giftedConnect({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
                },
                printQRInTerminal: false,
                logger: pinoLogger,
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                generateHighQualityLinkPreview: true,
                shouldIgnoreJid: jid => !!jid?.endsWith('@g.us'),
                getMessage: async () => undefined,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000
            });
        } catch (err) {
            console.error(`[pair:${id}] giftedConnect failed:`, err.message);
            if (!responseSent && !res.headersSent) {
                res.status(500).json({ code: "Service is Currently Unavailable" });
                responseSent = true;
            }
            await cleanUpSession();
            return;
        }

        // Attach ALL event listeners FIRST before any async work
        Gifted.ev.on('creds.update', saveCreds);

        Gifted.ev.on("connection.update", async (s) => {
            const { connection, lastDisconnect } = s;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
           // console.log("[pair:"+id+"] event: "+JSON.stringify(Object.keys(s))+" conn="+connection+" status="+statusCode);

            if (connection === "open") {
                pairingDone = true;
               // console.log(`[pair:${id}] Pairing complete — connection open, saving session`);
                try {
                    try { await Gifted.groupAcceptInvite(GC_JID); } catch (_) {}

                    await delay(50000);

                    let sessionData = null;
                    let attempts = 0;
                    while (attempts < 15 && !sessionData) {
                        try {
                            const credsPath = path.join(sessionDir, id, "creds.json");
                            if (fs.existsSync(credsPath)) {
                                const data = fs.readFileSync(credsPath);
                                if (data && data.length > 100) { sessionData = data; break; }
                            }
                            await delay(8000);
                        } catch (_) { await delay(2000); }
                        attempts++;
                    }

                    if (!sessionData) { await cleanUpSession(); return; }

                    const compressedData = zlib.gzipSync(sessionData);
                    const b64data = compressedData.toString('base64');
                    const fullSession = SESSION_PREFIX + b64data;

                    let msgText, msgButtons;
                    if (isConfigured() && sessionType === 'short') {
                        const shortId = await saveSession(fullSession);
                        const shortSession = `${SESSION_PREFIX}${shortId}`;
                        msgText = `*SESSION ID ✅*\n\n${shortSession}`;
                        msgButtons = [
                            { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Session', copy_code: shortSession }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Bot Repo', url: BOT_REPO }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Join WaChannel', url: WA_CHANNEL }) }
                        ];
                    } else {
                        msgText = `*SESSION ID ✅*\n\n${fullSession}`;
                        msgButtons = [
                            { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Session', copy_code: fullSession }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Bot Repo', url: BOT_REPO }) },
                            { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Join WaChannel', url: WA_CHANNEL }) }
                        ];
                    }

                    await delay(5000);
                    let sessionSent = false, sendAttempts = 0;
                    while (sendAttempts < 5 && !sessionSent) {
                        try {
                            await sendButtons(Gifted, Gifted.user.id, {
                                title: '', text: msgText, footer: MSG_FOOTER, buttons: msgButtons
                            });
                            sessionSent = true;
                            console.log(`[pair:${id}] Session sent successfully`);
                        } catch (sendError) {
                            console.error(`[pair:${id}] Send attempt ${sendAttempts + 1} failed:`, sendError.message);
                            sendAttempts++;
                            if (sendAttempts < 5) await delay(3000);
                        }
                    }

                    await delay(3000);
                    try { await Gifted.ws.close(); } catch (_) {}
                } catch (sessionError) {
                    console.error(`[pair:${id}] Session processing error:`, sessionError.message);
                } finally {
                    await cleanUpSession();
                }

            } else if (connection === "close") {
                if (pairingDone || statusCode === 401 || reconnectCount >= MAX_RECONNECTS) {
                   // console.log(`[pair:${id}] Not reconnecting (done=${pairingDone}, status=${statusCode}, attempts=${reconnectCount})`);
                    await cleanUpSession();
                    return;
                }
                // WhatsApp sends 515 (restart required) after pairing code entry — must reconnect
                reconnectCount++;
               // console.log(`[pair:${id}] Reconnect #${reconnectCount} in 5s (status ${statusCode})`);
                await delay(5000);
                GIFTED_PAIR_CODE();
            }
        });

        // Request pairing code AFTER listeners are attached (avoids missing close events)
        if (!Gifted.authState.creds.registered) {
            await delay(2000); // brief wait for WS to establish
          //  console.log(`[pair:${id}] Requesting pairing code for ${num}`);
            try {
                const code = await Gifted.requestPairingCode(num);
                console.log(`[pair:${id}] Got code: ${code}`);
                if (!responseSent && !res.headersSent) {
                    res.json({ code: code, fallback: sessionType === 'short' && !isConfigured() });
                    responseSent = true;
                }
            } catch (codeErr) {
                console.error(`[pair:${id}] requestPairingCode error:`, codeErr.message);
                if (!responseSent && !res.headersSent) {
                    res.status(500).json({ code: "Failed to generate pairing code" });
                    responseSent = true;
                }
                await cleanUpSession();
            }
        } else {
            console.log(`[pair:${id}] Creds already registered — awaiting reconnect/open`);
        }
    }

    try {
        await GIFTED_PAIR_CODE();
    } catch (finalError) {
        console.error(`[pair:${id}] Final error:`, finalError.message);
        await cleanUpSession();
        if (!responseSent && !res.headersSent) {
            res.status(500).json({ code: "Service Error" });
        }
    }
});

module.exports = router;
