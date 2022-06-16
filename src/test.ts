import cypress from "cypress";
import dotenv from "dotenv";
import appPath from "./common/appPath";
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
    ROAM_USER_PASSWORD: process.env.ROAM_USER_PASSWORD,
    ROAM_USERNAME: process.env.ROAM_USERNAME,
  };
  const args: CypressCommandLine.CypressCommonOptions = {
    config: {
      env,
      e2e: {
        baseUrl: "https://roamresearch.com/",
      },
    },
    testingType: "e2e",
    env,
    configFile: "",
    project: appPath("."),
  };
  if (open) {
    return cypress.open(args).then(() => 0);
  } else {
    args.config.projectId = projectId;
    return cypress.run(args).then(() => 0);
  }
};

export default test;
