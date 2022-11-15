import appPath from "./common/appPath";
import getPackageName from "./common/getPackageName";
import fs from "fs";
import path from "path";
import axios from "axios";
import mime from "mime-types";
import { S3 } from "@aws-sdk/client-s3";
import toVersion from "./common/toVersion";
import dotenv from "dotenv";
import { execSync } from "child_process";
import JSZip from "jszip";
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

const opts = () => ({
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

const pushToRoamDepot = async ({
  repo,
  owner,
  tagName,
  branch = repo,
  proxy = owner,
}: {
  repo: string;
  owner: string;
  tagName: string;
  branch?: string;
  proxy?: string;
}) => {
  console.log("Attempting to publish to Roam Depot...");
  const pr = await axios
    .get(
      `https://api.github.com/repos/Roam-Research/roam-depot/pulls?head=${owner}:${branch}`
    )
    .then((r) => r.data[0]?.html_url);
  const cwd = process.cwd();
  process.chdir("/tmp");
  execSync(
    `git clone https://${owner}:${process.env.GITHUB_TOKEN}@github.com/${owner}/roam-depot.git`
  );
  process.chdir("roam-depot");
  const manifestFile = `extensions/${proxy}/${repo.replace(
    /^roam(js)?-/,
    ""
  )}.json`;
  const { name: authorName, email: authorEmail } = await axios
    .get(`https://api.github.com/user`, opts())
    .then((r) => r.data);
  execSync(`git config --global user.email "${authorEmail}"`);
  execSync(`git config --global user.name "${authorName}"`);
  execSync(`git remote add roam https://github.com/Roam-Research/roam-depot`);
  execSync(`git pull roam main --rebase`);
  execSync(`git push origin main -f`);
  if (pr) {
    console.log("Found existing PR");
    execSync(`git checkout ${branch}`);
    execSync(`git rebase origin/main`);
    const manifest = fs.readFileSync(manifestFile).toString();
    fs.writeFileSync(
      manifestFile,
      manifest.replace(
        /"source_commit": "[a-f0-9]+",/,
        `"source_commit": "${process.env.GITHUB_SHA}",`
      )
    );
    execSync("git add --all");
    execSync(`git commit -m "Version ${tagName}"`);
    execSync(`git push origin ${branch} -f`);
    console.log(`Updated pull request: ${pr}`);
  } else {
    console.log("Creating new PR");
    execSync(`git checkout -b ${branch}`);
    if (!fs.existsSync(`extensions/${proxy}`))
      fs.mkdirSync(`extensions/${proxy}`);
    const name = repo
      .replace(/^roam(js)?-/, "")
      .split("-")
      .map((s) => `${s.slice(0, 1).toUpperCase()}${s.slice(1)}`)
      .join(" ");
    if (fs.existsSync(manifestFile)) {
      const manifest = fs.readFileSync(manifestFile).toString();
      fs.writeFileSync(
        manifestFile,
        manifest.replace(
          /"source_commit": "[a-f0-9]+",/,
          `"source_commit": "${process.env.GITHUB_SHA}",`
        )
      );
    } else {
      const packageJson = JSON.parse(
        fs.readFileSync(`${cwd}/package.json`).toString()
      );
      fs.writeFileSync(
        manifestFile,
        JSON.stringify(
          {
            name,
            short_description:
              packageJson?.description ||
              "Description missing from package json",
            author: authorName,
            tags: packageJson?.tags || [],
            source_url: `https://github.com/${owner}/${repo}`,
            source_repo: `https://github.com/${owner}/${repo}.git`,
            source_commit: process.env.GITHUB_SHA,
            stripe_account: packageJson.stripe,
          },
          null,
          4
        ) + "\n"
      );
    }
    const title = `${name}: Version ${tagName}`;
    execSync("git add --all");
    execSync(`git commit -m "${title}"`);
    execSync(`git push origin ${branch} -f`);
    const url = await axios
      .post(
        `https://api.github.com/repos/Roam-Research/roam-depot/pulls`,
        {
          head: `${owner}:${branch}`,
          base: "main",
          title,
        },
        opts()
      )
      .then((r) => r.data.html_url)
      .catch((e) => Promise.reject(e.response.data || e.message));
    console.log(`Created pull request: ${url}`);
  }
  process.chdir(cwd);
};

const createGithubRelease = async ({
  owner,
  repo,
  tagName,
  depot,
  branch = repo,
  proxy = owner,
}: {
  owner: string;
  repo: string;
  tagName: string;
  depot?: boolean;
  branch?: string;
  proxy?: string;
}): Promise<void> => {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const message = await axios
      .get(
        `https://api.github.com/repos/${owner}/${repo}/commits/${process.env.GITHUB_SHA}`,
        {
          headers: {
            Authorization: `token ${token}`,
          },
        }
      )
      .then((r) => r.data.commit.message as string);
    return axios
      .post(
        `https://api.github.com/repos/${owner}/${repo}/releases`,
        {
          tag_name: tagName,
          name:
            message.length > 50 ? `${message.substring(0, 47)}...` : message,
          body: message.length > 50 ? `...${message.substring(47)}` : "",
        },
        opts()
      )
      .then(async (r) => {
        console.log(
          `Successfully created github release for version ${r.data.tag_name}`
        );
        if (depot) {
          await pushToRoamDepot({
            owner,
            branch,
            repo,
            tagName,
            proxy,
          });
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
  email = process.env.ROAMJS_EMAIL,
  user = process.env.GITHUB_REPOSITORY_OWNER,
  source = "build",
  path: destPathInput = getPackageName(),
  logger: { info, warning } = { info: console.log, warning: console.warn },
  marketplace,
  depot = marketplace,
  branch,
  proxy,
  labs = !!process.env.LABS,
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
  //@deprecated
  marketplace?: boolean;
  depot?: boolean;
  branch?: string;
  proxy?: string;
  labs?: boolean;
}): Promise<number> => {
  const version = process.env.ROAMJS_VERSION || toVersion(new Date());
  if (labs) {
    return pushToRoamDepot({
      repo: path.basename(process.cwd()),
      owner: user || "",
      branch,
      tagName: version,
    }).then(() => 0);
  }
  const Authorization = email
    ? `Bearer ${Buffer.from(`${email}:${token}`).toString("base64")}`
    : token;
  const sourcePath = depot ? appPath(".") : appPath(source);
  info(`Source Path: ${sourcePath}`);
  const fileNames = depot
    ? [
        "extension.js",
        "extension.css",
        "README.md",
        "CHANGELOG.md",
        "package.json",
      ].filter((f) => fs.existsSync(f))
    : readDir(sourcePath);

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
      return Promise.all<unknown[]>(
        fileNames
          .flatMap<unknown>((p) => {
            const fileName = depot ? `/${p}` : p.substring(sourcePath.length);
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
          .concat([
            depot
              ? Promise.resolve(new JSZip()).then((zip) => {
                  fileNames.forEach((f) => {
                    console.log(`Zipping ${f}...`);
                    const content = fs.readFileSync(f);
                    zip.file(f, content, { date: new Date("09-24-1995") });
                  });
                  return zip
                    .generateAsync({
                      type: "nodebuffer",
                      compression: "DEFLATE",
                      mimeType: "application/zip",
                    })
                    .then((Body) =>
                      s3.putObject({
                        Key: `downloads/${destPath}.zip`,
                        Bucket: "roamjs.com",
                        ContentType: "application/zip",
                        Body,
                      })
                    );
                })
              : Promise.resolve(),
          ])
      )
        .then(() =>
          createGithubRelease({
            tagName: version,
            repo: path.basename(process.cwd()),
            owner: user || "",
            depot,
            branch,
            proxy,
          })
        )
        .then(() => 0);
    });
};

export default publish;
