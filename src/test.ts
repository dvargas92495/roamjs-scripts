import args from "./common/args";
import labsTest from "@samepage/scripts/test";

const test = ({
  forward,
  env = [],
}: {
  forward?: string | string[];
  env?: string | string[];
}): Promise<number> => {
  return labsTest({
    ...args({
      env: ["ROAM_PASSWORD", "ROAM_USERNAME"].concat(env),
    }),
    forward,
    path: "roam",
  });
};

export default test;
