import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { streamQuery } from "../agent/session.js";
import { logger, setSession } from "../logger.js";

export async function chatCommand(): Promise<void> {
  const sessionId = `chat-${Date.now()}`;
  setSession(sessionId);
  logger.info("chat", "session-start");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.bold("Voltz") + chalk.dim(" — chat mode"));
  console.log(chalk.dim("Type your question. Ctrl+C to exit.\n"));

  const prompt = (): Promise<string> =>
    new Promise((resolve) => {
      rl.question(chalk.cyan("You: "), (answer) => {
        resolve(answer.trim());
      });
    });

  process.on("SIGINT", () => {
    logger.info("chat", "session-end");
    logger.flush();
    console.log(chalk.dim("\nGoodbye!"));
    rl.close();
    process.exit(0);
  });

  let turnCount = 0;

  while (true) {
    const input = await prompt();
    if (!input) continue;

    turnCount++;
    logger.info("chat", "query", { turn: turnCount, length: input.length });

    const spinner = ora({
      text: chalk.yellow("Thinking..."),
      spinner: "dots",
    }).start();

    try {
      let firstChunk = true;
      for await (const chunk of streamQuery(input)) {
        if (chunk.type === "text") {
          if (firstChunk) {
            spinner.stop();
            process.stdout.write(chalk.green("Voltz: "));
            firstChunk = false;
          }
          process.stdout.write(chalk.green(chunk.text));
        }
      }

      if (firstChunk) {
        spinner.info(chalk.dim("No response"));
        logger.warn("chat", "empty-response", { turn: turnCount });
      } else {
        process.stdout.write("\n\n");
        logger.info("chat", "response-done", { turn: turnCount });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Error: ${msg}`));
      logger.error("chat", "query-error", { turn: turnCount, error: msg });
    }
  }
}
