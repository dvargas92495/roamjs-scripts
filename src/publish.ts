import appPath from "./common/appPath";
import getPackageName from "./common/getPackageName";
import fs from "fs";
import path from "path";
import axios from "axios";
import mime from "mime-types";
import { S3 } from "@aws-sdk/client-s3";
import { CloudFront } from "@aws-sdk/client-cloudfront";
import toVersion from "./common/toVersion";
import dotenv from "dotenv";
import { execSync } from "child_process";
dotenv.config();

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

const createGithubRelease = async ({
  owner,
  repo,
  commit,
  tagName,
  marketplace,
  stripe,
}: {
  owner: string;
  repo: string;
  commit?: string;
  tagName: string;
  marketplace?: boolean;
  stripe?: string;
}): Promise<void> => {
  const token = process.env.ROAMJS_RELEASE_TOKEN;
  if (token) {
    const message = await axios
      .get(`https://api.github.com/repos/${owner}/${repo}/commits/${commit}`, {
        headers: {
          Authorization: `token ${token}`,
        },
      })
      .then((r) => r.data.commit.message as string);
    const opts = {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `token ${token}`,
      },
    };
    return axios
      .post(
        `https://api.github.com/repos/${owner}/${repo}/releases`,
        {
          tag_name: tagName,
          name:
            message.length > 50 ? `${message.substring(0, 47)}...` : message,
          body: message.length > 50 ? `...${message.substring(47)}` : "",
        },
        opts
      )
      .then(async (r) => {
        console.log(
          `Successfully created github release for version ${r.data.tag_name}`
        );
        if (marketplace) {
          console.log("Attempting to publish to Roam Depot...");
          const pr = await axios
            .get(
              `https://api.github.com/repos/Roam-Research/roam-depot/pulls?head=${owner}:${repo}`
            )
            .then((r) => r.data[0]?.html_url);
          const cwd = process.cwd();
          process.chdir("/tmp");
          execSync(`git clone https://github.com/${owner}/roam-depot.git`);
          process.chdir("roam-depot");
          const manifestFile = `extensions/${owner}/${repo.replace(
            /^roamjs-/,
            ""
          )}.json`;
          if (pr) {
            execSync(`git checkout ${repo}`);
            const manifest = fs.readFileSync(manifestFile).toString();
            fs.writeFileSync(
              manifestFile,
              manifest.replace(
                /"source_commit": "[a-f0-9]+",/,
                `"source_commit": "${commit}",`
              )
            );
            execSync("git add --all");
            execSync(`git commit -m "Version ${tagName}"`);
            execSync(`git push origin ${repo}`);
            console.log(`Updated pull request: ${pr}`);
          } else {
            execSync(`git checkout -b ${repo}`);
            fs.mkdirSync(`extensions/${owner}`);
            const packageJson = JSON.parse(
              fs.readFileSync(`${cwd}/package.json`).toString()
            );
            const name = repo
              .replace(/^roamjs-/, "")
              .split("-")
              .map((s) => `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`)
              .join(" ");
            const author = axios
              .get(`  https://api.github.com/users/${owner}`)
              .then((r) => r.data.name);
            fs.writeFileSync(
              manifestFile,
              JSON.stringify(
                {
                  name,
                  short_description:
                    packageJson?.description ||
                    "Description missing from package json",
                  author,
                  tags: packageJson?.tags || [],
                  source_url: `https://github.com/${owner}/${repo}`,
                  source_repo: `https://github.com/${owner}/${repo}.git`,
                  source_commit: commit,
                  stripe_account: stripe,
                },
                null,
                4
              )
            );
            execSync("git add --all");
            execSync(`git commit -m "${name}: Version ${tagName}"`);
            execSync(`git push origin ${repo}`);
            const url = await axios
              .post(
                `https://api.github.com/repos/Roam-Research/roam-depot/pulls`,
                {
                  head: `${owner}:${repo}`,
                  base: "main",
                },
                opts
              )
              .then((r) => r.data.url);
            console.log(`Created pull request: ${url}`);
          }
          process.chdir(cwd);
        }
      })
      .catch((e) => console.error(e));
  } else {
    console.warn("No release token set so no Github release created");
    return Promise.resolve();
  }
};

const publish = async ({
  token = process.env.ROAMJS_DEVELOPER_TOKEN,
  email,
  user,
  source = "build",
  path: destPathInput = getPackageName(),
  logger: { info, warning } = { info: console.log, warning: console.warn },
  marketplace,
  commit,
}: {
  token?: string;
  email?: string;
  user?: string;
  source?: string;
  path?: string;
  logger?: {
    info: (s: string) => void;
    warning: (s: string) => void;
  };
  marketplace?: boolean;
  commit?: string;
}): Promise<number> => {
  const Authorization = email
    ? `Bearer ${Buffer.from(`${email}:${token}`).toString("base64")}`
    : token;
  const sourcePath = appPath(source);
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
        region: "us-east-1",
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
      const version = process.env.ROAMJS_VERSION || toVersion(new Date());
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
                CallerReference: new Date().toJSON(),
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
        .then((cf) =>
          axios
            .get("https://lambda.roamjs.com/user")
            .then((r) =>
              createGithubRelease({
                tagName: version,
                repo: path.basename(process.cwd()),
                owner: user || r.data.username || "",
                commit,
                marketplace,
                stripe: r.data.stripeAccount,
              })
            )
            .then(() => waitForCloudfront(cf))
        )
        .then((msg) => info(msg))
        .then(() => 0);
    });
};

export default publish;
