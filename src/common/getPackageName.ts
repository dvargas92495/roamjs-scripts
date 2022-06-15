import fs from "fs";
import path from "path";
import repoName from "git-repo-name";

const getPackageName = (): string =>
  (fs.existsSync("package.json")
    ? JSON.parse(fs.readFileSync("package.json").toString())?.name
    : repoName.sync({ cwd: path.resolve(".") })
  )?.replace(/^roamjs-/, "");

export default getPackageName;
