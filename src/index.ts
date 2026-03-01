#!/usr/bin/env node

import { Command } from "commander";
import { voiceCommand } from "./commands/voice.js";
import { chatCommand } from "./commands/chat.js";
import { lookCommand } from "./commands/look.js";
import { setupCommand } from "./commands/setup.js";

const program = new Command();

program
  .name("voltz")
  .description("Voice-first AI companion for electronics enthusiasts")
  .version("0.1.0")
  .action(async () => {
    await voiceCommand();
  });

program
  .command("chat")
  .description("Text-only chat mode")
  .action(async () => {
    await chatCommand();
  });

program
  .command("look [description]")
  .description("Capture webcam frame and analyze with vision")
  .action(async (description?: string) => {
    await lookCommand(description);
  });

program
  .command("setup")
  .description("Configure API key, test microphone and speaker")
  .action(async () => {
    await setupCommand();
  });

program.parse();
