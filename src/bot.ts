import makeWASocket, { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
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
    const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.BOT_PHONE_NUMBER || 
            await question("📱 Enter WhatsApp Phone Number (with Country Code, e.g. 917217660457): ");
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, "");
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`\n========================================`);
        console.log(`🔑 YOUR PAIRING CODE: [ ${code} ]`);
        console.log(`========================================\n`);
        console.log("👉 WhatsApp > Linked Devices > Link with Phone Number > Enter code!\n");
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("⚠️ Connection closed. Reconnecting:", shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            console.log("✅ BOT CONNECTED TO WHATSAPP SUCCESSFULLY! 🎉");
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text.startsWith(".")) return;

        const [cmdName, ...args] = text.slice(1).trim().split(/\s+/);
        const lowerCmd = cmdName.toLowerCase();

        const matched = commands.find(c => c.name === lowerCmd || c.aliases?.includes(lowerCmd));
        if (matched) {
            console.log(`⚡ Executing command: .${lowerCmd}`);
            await matched.execute({
                sock,
                msg,
                groupId: msg.key.remoteJid!,
                senderId: msg.key.participant || msg.key.remoteJid!,
                command: lowerCmd,
                args,
                text: args.join(" "),
            });
        }
    });
}

startBot();
