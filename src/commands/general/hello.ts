import { Command } from "../types.js";

const helloCommand: Command = {
    name: "hello",
    aliases: ["hi", "hey"],
    description: "Bot will greet the user",
    category: "general",
    usage: ".hello",
    
    execute: async ({ sock, msg, groupId, senderId }) => {
        const userNumber = senderId.split('@')[0];

        await sock.sendMessage(
            groupId, 
            { 
                text: `👋 Hello @${userNumber}! My first bot command is working!`,
                mentions: [senderId] 
            }, 
            { quoted: msg }
        );
    }
};

export default helloCommand;
