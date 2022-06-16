const fs = require("fs");
fs.writeFileSync(
  "./dist/default.tsconfig.json",
  fs.readFileSync("./src/default.tsconfig.json").toString()
);
fs.writeFileSync(
  "./node_modules/local-cypress.index.d.ts",
  fs
    .readFileSync("./node_modules/local-cypress.index.d.ts")
    .toString()
    .replace(/EventEmitter/, "CyEventEmitter")
);
