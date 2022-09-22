import args from "./common/args";
import labsTest from "@samepage/scripts/test";

const test = ({
  forward,
}: {
  forward?: string | string[];
}): Promise<number> => {
  return labsTest({
    ...args({
      env: ["ROAM_PASSWORD", "ROAM_USERNAME"],
    }),
    forward,
    path: "roam",
  });
};

export default test;
