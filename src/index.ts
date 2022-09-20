#!/usr/bin/env node
import build from "./build";
import dev from "./dev";
import init from "./init";
import lambdas from "./lambdas";
import publish from "./publish";
import test from "./test";

const run = async (command: string, args: string[]): Promise<number> => {
  const opts = Object.fromEntries(
    args
      .map(
        (a, i) =>
          [
            a,
            args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true,
          ] as const
      )
      .filter(([k]) => k.startsWith("--"))
      .map(([k, v]) => [k.replace(/^--/, ""), v])
  );
  switch (command) {
    case "build":
      return build(opts);
    case "dev":
      return dev(opts);
    case "init":
      return init(opts);
    case "lambdas":
      return lambdas(opts);
    case "publish":
      return publish(opts);
    case "test":
      return test(opts);
    default:
      console.error("Command", command, "is unsupported");
      return 1;
  }
};

if (process.env.NODE_ENV !== "test") {
  run(process.argv[2], process.argv.slice(3))
    .then((code) => code >= 0 && process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default run;
