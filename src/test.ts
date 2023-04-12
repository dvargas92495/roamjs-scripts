import args from "./common/args";
import labsTest from "@samepage/scripts/test";

const test = ({
  forward,
}: {
  forward?: string | string[];
}): Promise<number> => {
  return labsTest({
    ...args(),
    forward,
    path: "roam",
  });
};

export default test;
