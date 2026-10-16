import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import readline from "readline";
import pino from "pino";
import { commands } from "./commands/index.js";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const question = (query: string): Promise<string> => 
    new Promise(resolve => rl.question(query, resolve));

async function startBot() {
    const sessionDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/app/auth_info_baileys";
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    // Fix: Explicit Browser Identity prevents WhatsApp from dropping cloud WebSocket handshakes
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu("Chrome"),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
    });

    let isPairingRequested = false;

    // 1. Connection Update: Pairing Code & Reconnection Handlers
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Request pairing code safely when socket is connecting or ready for QR
        if (!sock.authState.creds.registered && !isPairingRequested && (connection === "connecting" || qr)) {
            isPairingRequested = true;
            try {
                // Wait 4 seconds for complete TLS / noise protocol handshake
                await new Promise(res => setTimeout(res, 4000));
                
                const phoneNumber = process.env.BOT_PHONE_NUMBER || "917217660457";
                const cleanNumber = phoneNumber.replace(/[^0-9]/g, "");
                
                console.log(`⏳ Requesting pairing code for +${cleanNumber}...`);
                const code = await sock.requestPairingCode(cleanNumber);
                
                console.log(`\n========================================`);
                console.log(`🔑 YOUR PAIRING CODE: [ ${code} ]`);
                console.log(`========================================\n`);
                console.log("👉 WhatsApp > Linked Devices > Link with Phone Number > Enter code!\n");
            } catch (err: any) {
                console.error("❌ Failed to get pairing code:", err?.message || err);
                isPairingRequested = false;
            }
        }

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

    // 2. Save credentials whenever refreshed
    sock.ev.on("creds.update", saveCreds);

    // 3. Incoming Message Dispatcher - DM & Self-Bot Only
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        if (!msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith(".")) return;

        const remoteJid = msg.key.remoteJid || "";
        const sender = msg.key.participant || remoteJid;

        // Block all Groups (Only allow personal DMs)
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
