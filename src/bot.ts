import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { commands } from "./commands/index.js";

async function startBot() {
    const sessionDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/app/auth_info_baileys";
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
    });

    if (!sock.authState.creds.registered) {
        const rawPhone = process.env.BOT_PHONE_NUMBER || "919891478164";
        const cleanNumber = rawPhone.replace(/[^0-9]/g, "");

        if (!cleanNumber) {
            console.error("❌ ERROR: Please set BOT_PHONE_NUMBER in Railway Variables!");
        } else {
            const requestPairing = async (retryCount = 0) => {
                if (sock.authState.creds.registered) return;
                try {
                    console.log(`⏳ [Attempt ${retryCount + 1}] Requesting pairing code for +${cleanNumber}...`);
                    const code = await sock.requestPairingCode(cleanNumber);
                    console.log(`\n========================================`);
                    console.log(`🔑 FRESH PAIRING CODE: [ ${code} ]`);
                    console.log(`========================================\n`);
                    console.log("👉 WhatsApp > Linked Devices > Link with Phone Number > Enter code right away!\n");
                } catch (err: any) {
                    console.error(`⚠️ Attempt ${retryCount + 1} failed (${err?.message || err}). Retrying in 5s...`);
                    if (retryCount < 5) {
                        setTimeout(() => requestPairing(retryCount + 1), 5000);
                    }
                }
            };

            setTimeout(() => requestPairing(0), 6000);
        }
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("⚠️ Connection closed. Reconnecting:", shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000);
            }
        } else if (connection === "open") {
            console.log("\n========================================");
            console.log("✅ BOT CONNECTED TO WHATSAPP SUCCESSFULLY! 🎉");
            console.log("========================================\n");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        if (!msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith(".")) return;

        const remoteJid = msg.key.remoteJid || "";
        const sender = msg.key.participant || remoteJid;

        if (remoteJid.endsWith("@g.us")) return;

        const [cmdName, ...args] = text.slice(1).trim().split(/\s+/);
        const lowerCmd = cmdName.toLowerCase();

        const matched = commands.find(c => c.name === lowerCmd || c.aliases?.includes(lowerCmd));
        if (matched) {
            console.log(`⚡ Executing command: .${lowerCmd}`);
            await matched.execute({
                sock,
                msg,
                groupId: remoteJid,
                senderId: sender,
                command: lowerCmd,
                args,
                text: args.join(" "),
            });
        }
    });
}

startBot();
