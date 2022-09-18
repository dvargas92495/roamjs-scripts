import fs from "fs";

const globalTeardown = async (): Promise<void> => {
  if (fs.existsSync(`${process.cwd()}/tests/config.ts`)) {
    await import(`${process.cwd()}/tests/config.ts`).then(
      (mod) => typeof mod.teardown === "function" && mod.teardown()
    );
  }
};

export default globalTeardown;
