import { Command } from "./types.js";
import hello from "./general/hello.js";
import ping from "./general/ping.js";

export const commands: Command[] = [
    hello,
    ping
];
