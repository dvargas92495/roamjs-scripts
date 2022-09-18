import { spawn } from "child_process";
import compile, { CliArgs } from "./internal/compile";

const test = ({
  forward,
  ...args
}: CliArgs & { forward?: string | string[] }): Promise<number> => {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  const debugEnv = process.env.DEBUG || process.env.PWDEBUG;
  if (debugEnv) process.env.DEBUG = debugEnv;
  return compile(args)
    .then(() => {
      const proc = spawn(
        "npx",
        [
          "playwright",
          "test",
          "--config=./node_modules/roamjs-scripts/labs/internal/playwright.config.js",
          ...(typeof forward === "string" ? [forward] : forward || []),
        ],
        { stdio: "inherit", env: process.env }
      );
      return new Promise((resolve, reject) => {
        proc.on("exit", resolve);
        proc.on("error", reject);
      });
    })
    .then(() => 0)
    .catch((e) => {
      console.error("Failed to run tests:", e);
      return 1;
    });
};

export default test;
