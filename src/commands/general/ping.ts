import { Command } from "../types.js";

const pingCommand: Command = {
    name: "ping",
    aliases: ["speed", "p"],
    description: "Check bot response speed and latency",
    category: "general",
    usage: ".ping",

    execute: async ({ sock, msg, groupId }) => {
        const start = Date.now();

        // 1. Pehle testing message bhejo
        const sentMsg = await sock.sendMessage(
            groupId, 
            { text: "⚡ *Testing ping...*" }, 
            { quoted: msg }
        );

        // 2. Kitna time laga (milliseconds) calculate karo
        const latency = Date.now() - start;

        // 3. Message ko edit karke speed dikhao!
        if (sentMsg && sentMsg.key) {
            await sock.sendMessage(groupId, {
                text: `🏓 *Pong!*\n> ⚡ *Speed:* \`${latency}ms\``,
                edit: sentMsg.key
            });
        }
    }
};

export default pingCommand;
