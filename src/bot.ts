import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
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

    // Official WhatsApp Web client signature
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "fatal" }),
        printQRInTerminal: false,
        browser: ["Chrome (Linux)", "", ""],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
    });

    if (!sock.authState.creds.registered) {
        const rawPhone = process.env.BOT_PHONE_NUMBER || "919891478164";
        const cleanNumber = rawPhone.replace(/[^0-9]/g, "");

        const requestPairing = async (retryCount = 0) => {
            if (sock.authState.creds.registered) return;
            try {
                console.log(`⏳ Requesting fresh pairing code for +${cleanNumber}...`);
                const code = await sock.requestPairingCode(cleanNumber);
                console.log(`\n========================================`);
                console.log(`🔑 PAIRING CODE: [ ${code} ]`);
                console.log(`========================================\n`);
                console.log("👉 WhatsApp > Linked Devices > Link with Phone Number > Enter code right away!\n");
            } catch (err: any) {
                console.error(`⚠️ Attempt ${retryCount + 1} failed (${err?.message || err}).`);
                if (retryCount >= 2) {
                    setTimeout(() => startBot(true), 2000);
                } else {
                    setTimeout(() => requestPairing(retryCount + 1), 4000);
                }
            }
        };

        setTimeout(() => requestPairing(0), 5000);
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
