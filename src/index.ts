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
    case "test":
      return test(opts);

    // the bottom three commands are @deprecated
    case "init": // to move to roamjs-backend
      return init(opts);
    case "lambdas": // to be removed outright
      return lambdas(opts);
    case "publish": // to be redundant with the `build` command
      return publish(opts);
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
