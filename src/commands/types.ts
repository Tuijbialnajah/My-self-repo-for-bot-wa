import { WASocket } from "@whiskeysockets/baileys";

export interface CommandContext {
    sock: WASocket;
    msg: any;
    groupId: string;
    senderId: string;
    command: string;
    args: string[];
    text: string;
}

export interface Command {
    name: string;
    aliases?: string[];
    description: string;
    category: string;
    usage?: string;
    execute: (ctx: CommandContext) => Promise<void>;
}
