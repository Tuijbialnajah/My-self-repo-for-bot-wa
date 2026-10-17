import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import fsExtra from "fs";
import { commands } from "./commands/index.js";

async function startBot(forceClean = false) {
    const sessionDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/app/auth_info_baileys";

    if (forceClean) {
        console.log("🧹 Cleaning session directory...");
        try {
            if (fsExtra.existsSync(sessionDir)) {
                fsExtra.rmSync(sessionDir, { recursive: true, force: true });
            }
        } catch (e) {}
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    // Exact configuration matching AI Studio working applet
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
    });

    if (!sock.authState.creds.registered) {
        const rawPhone = process.env.BOT_PHONE_NUMBER || "919891478164";
        const sanitizedPhone = rawPhone.replace(/[^0-9]/g, "");

        setTimeout(async () => {
            try {
                let code: string | undefined;
                let attempts = 0;

                console.log(`Requesting pairing code for +${sanitizedPhone}...`);

                while (attempts < 6) {
                    try {
                        code = await sock.requestPairingCode(sanitizedPhone);
                        if (code) break;
                    } catch (e: any) {
                        attempts++;
                        console.log(`[PairingCode] Socket handshake in progress, retrying in 3s (Attempt ${attempts}/6)...`, e?.message || e);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }

                if (!code) throw new Error("Failed to get pairing code after multiple attempts.");

                const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n========================================`);
                console.log(`✅ PAIRING CODE: [ ${formattedCode} ]`);
                console.log(`========================================\n`);
                console.log("👉 WhatsApp > Linked Devices > Link with Phone Number > Enter code right away!\n");
            } catch (err: any) {
                console.error("Error requesting pairing code:", err);
            }
        }, 3000);
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            console.log(`⚠️ Connection closed (Status: ${statusCode}). Logged out: ${isLoggedOut}`);
            
            if (isLoggedOut || statusCode === 401) {
                console.log("🧹 Session unlinked. Restarting fresh...");
                setTimeout(() => startBot(true), 2000);
                return;
            }

            setTimeout(() => startBot(false), 3000);
        } else if (connection === "open") {
            console.log("\n========================================");
            console.log("✅ BOT CONNECTED TO WHATSAPP SUCCESSFULLY! 🎉");
            console.log("========================================\n");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg || !msg.message) return;

        const messageContent = msg.message.ephemeralMessage?.message || msg.message.viewOnceMessage?.message || msg.message;
        const text = (
            messageContent.conversation ||
            messageContent.extendedTextMessage?.text ||
            messageContent.imageMessage?.caption ||
            messageContent.videoMessage?.caption ||
            ""
        ).trim();

        if (!text.startsWith(".")) return;

        const remoteJid = msg.key.remoteJid || "";
        if (remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") return;

        const sender = msg.key.participant || remoteJid;

        console.log(`📩 [Self-Bot Received]: "${text}" from: ${sender}`);

        const [cmdName, ...args] = text.slice(1).trim().split(/\s+/);
        const lowerCmd = cmdName.toLowerCase();

        const matched = commands.find(c => c.name === lowerCmd || c.aliases?.includes(lowerCmd));
        if (matched) {
            console.log(`⚡ Executing .${lowerCmd} in ${remoteJid}...`);
            try {
                await matched.execute({
                    sock,
                    msg,
                    groupId: remoteJid,
                    senderId: sender,
                    command: lowerCmd,
                    args,
                    text: args.join(" "),
                });
                console.log(`✅ Successfully responded to .${lowerCmd}!`);
            } catch (cmdErr) {
                console.error(`❌ Error executing .${lowerCmd}:`, cmdErr);
            }
        }
    });
}

startBot();
