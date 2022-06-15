import appPath from "./common/appPath";
import getPackageName from "./common/getPackageName";
import fs from "fs";
import path from "path";
import axios from "axios";
import mime from "mime-types";
import { S3 } from "@aws-sdk/client-s3";
import { CloudFront } from "@aws-sdk/client-cloudfront";
import toVersion from "./common/toVersion";

type Credentials = {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
};

const EXCLUSIONS = new Set([
  ".git",
  ".github",
  ".replit",
  "LICENSE",
  "README.md",
]);

const readDir = (s: string): string[] =>
  fs
    .readdirSync(s, { withFileTypes: true })
    .filter((f) => !EXCLUSIONS.has(f.name.split("/").slice(-1)[0]))
    .flatMap((f) =>
      f.isDirectory() ? readDir(path.join(s, f.name)) : [path.join(s, f.name)]
    );

const publish = async ({
  token,
  source,
  path: destPathInput = getPackageName(),
  logger: { info, warning } = { info: console.log, warning: console.warn },
}: {
  token?: string;
  source?: string;
  path?: string;
  logger?: {
    info: (s: string) => void;
    warning: (s: string) => void;
  };
}): Promise<number> => {
  const Authorization = token || process.env.ROAMJS_DEVELOPER_TOKEN;
  const sourcePath = appPath(source || "build");
  info(`Source Path: ${sourcePath}`);
  const fileNames = readDir(sourcePath);

  if (fileNames.length > 100) {
    return Promise.reject(
      new Error(
        `Attempting to upload too many files from ${sourcePath}. Max: 100, Actual: ${fileNames.length}`
      )
    );
  }
  if (!destPathInput) {
    return Promise.reject(new Error("`path` argument is required."));
  }
  if (destPathInput.endsWith("/")) {
    warning("No need to put an ending slash on the `path` input");
  }
  const destPath = destPathInput.replace(/\/$/, "");
  info(
    `Preparing to publish ${fileNames.length} files to RoamJS destination ${destPath}`
  );
  return axios
    .post<{ credentials: Credentials; distributionId: string }>(
      "https://api.roamjs.com/publish",
      { path: destPath },
      { headers: { Authorization } }
    )
    .then((r) => {
      const credentials = {
        accessKeyId: r.data.credentials.AccessKeyId,
        secretAccessKey: r.data.credentials.SecretAccessKey,
        sessionToken: r.data.credentials.SessionToken,
      };
      const s3 = new S3({
        apiVersion: "2006-03-01",
        credentials,
      });
      const cloudfront = new CloudFront({
        apiVersion: "2020-05-31",
        credentials,
      });
      const waitForCloudfront = (props: {
        Id: string;
        DistributionId: string;
        trial?: number;
      }) =>
        new Promise<string>((resolve) => {
          const { trial = 0, ...args } = props;
          cloudfront
            .getInvalidation(args)
            .then((r) => r.Invalidation?.Status)
            .then((status) => {
              if (status === "Completed") {
                resolve("Done!");
              } else if (trial === 60) {
                resolve("Ran out of time waiting for cloudfront...");
              } else {
                setTimeout(
                  () => waitForCloudfront({ ...args, trial: trial + 1 }),
                  1000
                );
              }
            });
        });
      const today = new Date();
      const version = toVersion(today);
      return Promise.all(
        fileNames.flatMap((p) => {
          const fileName = p.substring(sourcePath.length);
          const Key = `${destPath}${fileName}`;
          const uploadProps = {
            Bucket: "roamjs.com",
            ContentType: mime.lookup(fileName) || undefined,
          };
          info(`Uploading version ${version} of ${p} to ${Key}...`);
          return [
            s3.putObject({
              Key: `${destPath}/${version}${fileName}`,
              ...uploadProps,
              Body: fs.createReadStream(p),
            }),
            s3.putObject({
              Key,
              ...uploadProps,
              Body: fs.createReadStream(p),
            }),
          ];
        })
      )
        .then(() =>
          cloudfront
            .createInvalidation({
              DistributionId: r.data.distributionId,
              InvalidationBatch: {
                CallerReference: today.toJSON(),
                Paths: {
                  Quantity: 1,
                  Items: [`/${destPath}/*`],
                },
              },
            })
            .then((i) => ({
              Id: i.Invalidation?.Id || "",
              DistributionId: r.data.distributionId,
            }))
        )
        .then(waitForCloudfront)
        .then((msg) => info(msg))
        .then(() => 0);
    });
};

export default publish;
