import cypress from "cypress";
import dotenv from "dotenv";
dotenv.config();

const test = ({
  open,
  projectId,
}: {
  open?: boolean;
  projectId?: string;
}): Promise<number> => {
  process.env.CYPRESS_VERIFY_TIMEOUT = "100000";
  const env = {
    ROAM_PASSWORD: process.env.ROAM_PASSWORD,
    ROAM_USERNAME: process.env.ROAM_USERNAME,
    ROAMJS_EXTENSION_ID: process.env.ROAMJS_EXTENSION_ID,
  };
  const args:
    | CypressCommandLine.CypressRunOptions
    | CypressCommandLine.CypressOpenOptions = {
    config: {
      env,
      e2e: {
        baseUrl: "https://roamresearch.com/",
        specPattern: "tests/**/*.{ts,tsx}",
        // we cant use a real support file bc cypress ignores globs that have node_modules in them :(
        supportFile: false,
        videosFolder: "./node_modules/roamjs-scripts/dist/cypress/videos",
        chromeWebSecurity: false,
      },
    },
    testingType: "e2e",
    env,
    configFile: "./node_modules/roamjs-scripts/dist/common/cypress.config.js",
    project: process.cwd(),
    browser: "chrome",
    detached: false,
    global: false,
    port: 8080,
  };
  if (open) {
    return cypress.open(args).then(() => 0);
  } else {
    args.config.projectId = projectId;
    return cypress.run(args).then(() => 0);
  }
};

export default test;
