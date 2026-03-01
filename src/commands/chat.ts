import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { streamQuery } from "../agent/session.js";

export async function chatCommand(): Promise<void> {
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
    console.log(chalk.dim("\nGoodbye!"));
    rl.close();
    process.exit(0);
  });

  while (true) {
    const input = await prompt();
    if (!input) continue;

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
      } else {
        process.stdout.write("\n\n");
      }
    } catch (err) {
      spinner.fail(
        chalk.red(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }
}
