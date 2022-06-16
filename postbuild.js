const fs = require("fs");
fs.writeFileSync(
  "./dist/default.tsconfig.json",
  fs.readFileSync("./src/default.tsconfig.json").toString()
);
