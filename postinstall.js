const fs = require("fs");
fs.writeFileSync(
  "./node_modules/local-cypress/index.d.ts",
  fs
    .readFileSync("./node_modules/local-cypress/index.d.ts")
    .toString()
    .replace(/EventEmitter/g, "CyEventEmitter")
);