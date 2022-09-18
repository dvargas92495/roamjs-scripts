import args from "./common/args";
import labsTest from "./labs/test";

const test = (): Promise<number> => {
  return labsTest(
    args({
      env: ["ROAM_PASSWORD", "ROAM_USERNAME"],
    })
  );
};

export default test;
