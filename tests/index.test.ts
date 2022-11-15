// import { spawn } from "child_process";
import build from "../src/build";
import { test, expect } from "@playwright/test";

test("Runs Build", async () => {
  // const exitCode = await new Promise((resolve) => {
  //   const proc = spawn("ts-node ../../src/index.ts build", {
  //     cwd: "tests/mock",
  //   });
  //   proc.on("exit", resolve);
  // });
  process.chdir("tests/mock");
  const exitCode = await build({ labs: true, analyze: true, dry: true });
  expect(exitCode).toBe(0);
});
