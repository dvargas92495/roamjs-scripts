#!/usr/bin/env node
import webpack, { Stats } from "webpack";
import webpackDevServer from "webpack-dev-server";
import fs from "fs";
import path from "path";
import repoName from "git-repo-name";
import dotenv from "dotenv";
import axios from "axios";
import getName from "git-user-name";
import os from "os";
import spawn, { sync } from "cross-spawn";
import sodium from "tweetsodium";
import AWS from "aws-sdk";
import mime from "mime-types";
import JSZip from "jszip";
import crypto from "crypto";
import rimraf from "rimraf";
import TerserWebpackPlugin from "terser-webpack-plugin";
import NodePolyfillPlugin from "node-polyfill-webpack-plugin";
import "@babel/polyfill";
import esbuild from "esbuild";

const lambda = new AWS.Lambda({
  apiVersion: "2015-03-31",
  region: "us-east-1",
});

const appPath = (p: string) => path.resolve(fs.realpathSync(process.cwd()), p);

const IGNORE_ENV = ["HOME"];
const getDotEnvObject = () => {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => !/[()]/.test(k))
        .filter(([k]) => !IGNORE_ENV.includes(k))
    ),
    ...(fs.existsSync(".env.local")
      ? dotenv.parse(fs.readFileSync(".env.local"))
      : {}),
  };
  return Object.fromEntries(
    Object.keys(env).map((k) => [`process.env.${k}`, JSON.stringify(env[k])])
  );
};

const getDotEnvPlugin = () => new webpack.DefinePlugin(getDotEnvObject());

const optimization: webpack.Configuration["optimization"] = {
  minimizer: [
    new TerserWebpackPlugin({
      // Terser Webpack Plugin now depends on jest-worker which uses dynamic path resolution here:
      // https://github.com/facebook/jest/blob/master/packages/jest-worker/src/workers/NodeThreadsWorker.ts#L62
      // This seems to not be handled by vercel/ncc:
      // https://github.com/vercel/ncc/issues/489
      // This prevents any worker initialization, preventing the MODULE_NOT_FOUND error. but is also slower :/
      parallel: false,
    }),
  ],
};

const getPackageName = () =>
  (fs.existsSync("package.json")
    ? JSON.parse(fs.readFileSync("package.json").toString())?.name
    : repoName.sync({ cwd: path.resolve(".") })
  )?.replace(/^roamjs-/, "");

const getBaseConfig = (): Promise<
  Required<
    Pick<
      webpack.Configuration,
      "entry" | "module" | "target" | "resolve" | "output" | "plugins"
    >
  >
> => {
  const srcFiles = fs.readdirSync("./src/");
  const name = getPackageName();

  const entryFile =
    srcFiles.find((s) => /index\.(t|j)s/.test(s)) ||
    srcFiles.find((s) => new RegExp(`${name}\\.(t|j)s`).test(s));
  if (!entryFile) {
    return Promise.reject(
      `Need an entry file in the \`src\` directory named index or ${name}`
    );
  }
  const workers = fs.existsSync("./src/workers")
    ? Object.fromEntries(
        fs
          .readdirSync("./src/workers", { withFileTypes: true })
          .filter((f) => !f.isDirectory())
          .map((f) => [f.name.replace(/\.[t|j]s$/, ""), `./src/workers/${f}`])
      )
    : {};

  return Promise.resolve({
    entry: {
      main: ["@babel/polyfill", `./src/${entryFile}`],
      ...workers,
    },
    target: "web",
    resolve: {
      modules: ["node_modules", appPath("node_modules")],
      extensions: [".ts", ".js", ".tsx"],
    },
    output: {
      path: path.resolve("build"),
      filename: "[name].js",
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: [
            {
              loader: "shebang-loader",
            },
            {
              loader: "babel-loader",
              options: {
                cacheDirectory: true,
                cacheCompression: false,
                presets: ["@babel/preset-env", "@babel/preset-react"],
              },
            },
            {
              loader: "ts-loader",
              options: {
                compilerOptions: {
                  noEmit: false,
                },
              },
            },
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.css$/i,
          use: [
            (info) => {
              const relative = path
                .relative(
                  path.join(__dirname, "node_modules"),
                  (info as { realResource: string }).realResource
                )
                .replace(/\//g, "-")
                .replace(/\\/g, "-")
                .replace(/\.js/g, "");
              const className = relative.split("-")[0];
              return {
                loader: "style-loader",
                options: {
                  attributes: {
                    id: `roamjs-style-${relative}`,
                    class: `roamjs-style-${className}`,
                  },
                },
              };
            },
            "css-loader",
          ],
        },
        {
          test: /\.(png|jpe?g|gif|cur)$/i,
          use: [
            {
              loader: "file-loader",
            },
          ],
        },
        {
          test: /\.(svg)$/,
          loader: "svg-react-loader",
        },
        {
          test: /\.(woff|woff2|eot|ttf)$/,
          loader: "url-loader",
          options: {
            limit: 100000,
          },
        },
        {
          test: /\.ne$/,
          use: ["nearley-loader"],
        },
      ],
    },
    plugins: [
      getDotEnvPlugin(),
      new NodePolyfillPlugin(),
      new webpack.ProvidePlugin({ process: "process/browser.js" }),
    ],
  });
};

const webpackCallback = (
  resolve: (value: number | PromiseLike<number>) => void,
  reject: (reason?: Error | string) => void
) => (err?: Error, stats?: Stats): void => {
  if (err || !stats) {
    reject(err);
  } else {
    if (stats.hasErrors()) {
      reject(
        stats.toString({
          chunks: false,
          colors: true,
        })
      );
    } else {
      console.log(
        "Successfully compiled from",
        new Date(stats.startTime || 0).toLocaleTimeString(),
        "to",
        new Date(stats.endTime || 0).toLocaleTimeString()
      );
      resolve(0);
    }
  }
};

const build = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    getBaseConfig()
      .then((baseConfig) => {
        webpack(
          {
            ...baseConfig,
            mode: "production",
            optimization,
            performance: {
              hints: "error",
              maxEntrypointSize: 5000000,
              maxAssetSize: 5000000,
            },
          },
          webpackCallback(resolve, reject)
        );
      })
      .catch(reject);
  });
};

const dev = async ({
  host: inputHost,
  port: inputPort,
  hot: hotReloading = false,
}: {
  host?: string;
  port?: string;
  hot?: boolean;
}): Promise<number> => {
  const port = Number(inputPort) || 8000;
  const host = inputHost || "127.0.0.1";
  return new Promise((resolve, reject) => {
    getBaseConfig()
      .then((baseConfig) => {
        baseConfig.module.rules?.push({
          test: /\.js$/,
          enforce: "pre",
          exclude: /node_modules/,
          use: ["source-map-loader"],
        });
        let hostOutput = host;
        if (["127.0.0.1", "0.0.0.0"].includes(host)) {
          // Don't try to show links with 0.0.0.0
          hostOutput = "localhost";
        }
        baseConfig.output.publicPath = `http://${hostOutput}:${port}/`;
        baseConfig.output.pathinfo = true;
        const compiler = webpack({
          ...baseConfig,
          mode: "development",
          performance: {
            hints: "error",
            maxEntrypointSize: 20000000,
            maxAssetSize: 20000000,
          },
        });
        const server = new webpackDevServer(compiler, {
          contentBase: appPath("build"),
          host: host,
          disableHostCheck: true,
          publicPath: `http://${hostOutput}:${port}/`,
          headers: {
            "Access-Control-Allow-Origin": "https://roamresearch.com",
          },
          clientLogLevel: "none",
          injectClient: false,
          hot: hotReloading,
          inline: false,
        });

        server.listen(port, host, function (err) {
          if (err) {
            reject(err);
          } else {
            console.log(`WebpackDevServer listening at ${hostOutput}:${port}`);
            resolve(-1);
          }
        });
      })
      .catch(reject);
  });
};

const EXTENSION_NAME_REGEX = /^[a-z][a-z0-9-]*$/;
const init = async ({
  name,
  description,
  user = process.env.GITHUB_USERNAME,
  backend,
  repo = name,
}: {
  name?: string;
  description?: string;
  user?: string;
  backend?: boolean;
  repo?: string;
}): Promise<number> => {
  if (!name) {
    return Promise.reject("--name parameter is required");
  }
  if (!EXTENSION_NAME_REGEX.test(name)) {
    return Promise.reject(
      "Extension name must consist of only lowercase letters, numbers, and dashes"
    );
  }

  const githubOpts = {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
    },
  };
  const root = path.resolve(name);
  const projectName = name.replace(/^roamjs-/, "");
  const projectDescription = description || `Description for ${projectName}.`;
  const extensionExists = fs.existsSync(name);
  const terraformOrganizationToken = process.env.TERRAFORM_ORGANIZATION_TOKEN;
  const tasks = [
    {
      title: "Make Project Directory",
      task: () => fs.mkdirSync(name),
      skip: () => extensionExists,
    },
    {
      title: "Write Package JSON",
      task: () => {
        const packageJson = {
          name: projectName,
          version: "1.0.0",
          description: projectDescription,
          main: "./build/main.js",
          scripts: {
            build: "roamjs-scripts build",
            dev: "roamjs-scripts dev",
            ...(backend
              ? {
                  preserver: "roamjs-scripts lambdas --build",
                  lambdas: "roamjs-scripts lambdas",
                  server: "localhost-lambdas",
                  start: "concurrently npm:dev npm:server",
                }
              : {}),
          },
          license: "MIT",
        };

        return Promise.resolve(
          fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify(packageJson, null, 2) + os.EOL
          )
        );
      },
      skip: () => extensionExists,
    },
    {
      title: "Add backend to package.json",
      task: () => {
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(root, "package.json")).toString()
        );
        packageJson.scripts.lambdas = "roamjs-scripts lambdas";
        packageJson.scripts.server = "localhost-lambdas";
        return Promise.resolve(
          fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify(packageJson, null, 2) + os.EOL
          )
        );
      },
      skip: () => !backend,
    },
    {
      title: "Write README.md",
      task: () =>
        fs.writeFileSync(
          path.join(root, "README.md"),
          `# ${projectName}
      
${projectDescription}
      `
        ),
      skip: () => extensionExists,
    },
    {
      title: "Write tsconfig.json",
      task: () => {
        const tsconfig = {
          extends: "./node_modules/roamjs-scripts/dist/default.tsconfig",
          include: ["src"],
          exclude: ["node_modules"],
        };

        return fs.writeFileSync(
          path.join(root, "tsconfig.json"),
          JSON.stringify(tsconfig, null, 2) + os.EOL
        );
      },
      skip: () => extensionExists,
    },
    {
      title: "Add backend to tsconfig.json",
      task: () => {
        const tsconfig = JSON.parse(
          fs.readFileSync(path.join(root, "tsconfig.json")).toString()
        );
        tsconfig.include.push("lambdas");
        return Promise.resolve(
          fs.writeFileSync(
            path.join(root, "tsconfig.json"),
            JSON.stringify(tsconfig, null, 2) + os.EOL
          )
        );
      },
      skip: () => !backend,
    },
    {
      title: "Write main.yaml",
      task: () => {
        fs.mkdirSync(path.join(root, ".github", "workflows"), {
          recursive: true,
        });
        return fs.writeFileSync(
          path.join(root, ".github", "workflows", "main.yaml"),
          `name: Publish Extension
on:
  push:
    branches: main
    paths:
      - "src/**"
      - "package.json"
      - ".github/workflows/main.yaml"

${
  backend
    ? `env:
  API_URL: https://lambda.roamjs.com
`
    : ""
}
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: install
        run: npm install
      - name: build
        run: npm run build 
      - name: RoamJS Publish
        uses: dvargas92495/roamjs-publish@0.4.3
        with:
          token: \${{ secrets.ROAMJS_DEVELOPER_TOKEN }}
          source: build
          path: ${projectName}
          release_token: \${{ secrets.ROAMJS_RELEASE_TOKEN }}
          email: ${user}@gmail.com
          branch: \${{ github.ref_name }}
`
        );
      },
      skip: () => extensionExists || !process.env.ROAMJS_DEVELOPER_TOKEN,
    },
    {
      title: "Write lambda.yaml",
      task: () => {
        fs.mkdirSync(path.join(root, ".github", "workflows"), {
          recursive: true,
        });
        return fs.writeFileSync(
          path.join(root, ".github", "workflows", "lambda.yaml"),
          `name: Publish Lambda
on:
  push:
    branches: main
    paths:
      - "lambdas/**"
      - "package.json"
      - ".github/workflows/lambda.yaml"

env:
  AWS_ACCESS_KEY_ID: \${{ secrets.DEPLOY_AWS_ACCESS_KEY }}
  AWS_SECRET_ACCESS_KEY: \${{ secrets.DEPLOY_AWS_ACCESS_SECRET }}
  ROAMJS_DEVELOPER_TOKEN: \${{ secrets.ROAMJS_DEVELOPER_TOKEN }}

jobs:
  deploy:
    runs-on: ubuntu-18.04
    steps:
      - uses: actions/checkout@v2
      - name: Use Node.js 14.17.6
        uses: actions/setup-node@v1
        with:
          node-version: 14.17.6
      - name: install
        run: npm install
      - name: Deploy
        run: npm run lambdas
`
        );
      },
      skip: () => !backend,
    },
    {
      title: "Write .gitignore",
      task: () => {
        return fs.writeFileSync(
          path.join(root, ".gitignore"),
          `node_modules
build
dist
out
.env.local
`
        );
      },
      skip: () => extensionExists,
    },
    {
      title: "Write LICENSE",
      task: () => {
        return fs.writeFileSync(
          path.join(root, "LICENSE"),
          `MIT License

Copyright (c) ${new Date().getFullYear()} ${getName()}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
        );
      },
      skip: () => extensionExists,
    },
    {
      title: "Install Dev Packages",
      task: () => {
        process.chdir(root);
        return new Promise<void>((resolve, reject) => {
          const dependencies = [
            "@types/react",
            "@types/react-dom",
            "roamjs-scripts",
            "typescript",
          ].concat(...(backend ? ["concurrently"] : []));
          const child = spawn(
            "npm",
            ["install", "--save-dev", "--quiet"].concat(dependencies),
            {
              stdio: "inherit",
            }
          );
          child.on("close", (code) => {
            if (code !== 0) {
              reject(code);
              return;
            }
            resolve();
          });
        });
      },
      skip: () => extensionExists,
    },
    {
      title: "Install Backend Dev Packages",
      task: () => {
        process.chdir(root);
        return new Promise<void>((resolve, reject) => {
          const dependencies = ["@types/aws-lambda", "localhost-lambdas"];
          const child = spawn(
            "npm",
            ["install", "--save-dev", "--quiet"].concat(dependencies),
            {
              stdio: "inherit",
            }
          );
          child.on("close", (code) => {
            if (code !== 0) {
              reject(code);
              return;
            }
            resolve();
          });
        });
      },
      skip: () => !backend,
    },
    {
      title: "Install Packages",
      task: () => {
        process.chdir(root);
        return new Promise<void>((resolve, reject) => {
          const dependencies = ["react", "react-dom", "roamjs-components"];
          const child = spawn(
            "npm",
            ["install", "--quiet"].concat(dependencies),
            {
              stdio: "inherit",
            }
          );
          child.on("close", (code) => {
            if (code !== 0) {
              reject(code);
              return;
            }
            resolve();
          });
        });
      },
      skip: () => extensionExists,
    },
    {
      title: "Write src",
      task: () => {
        fs.mkdirSync(path.join(root, "src"));
        return fs.writeFileSync(
          path.join(root, "src", "index.ts"),
          `import toConfigPageName from "roamjs-components/util/toConfigPageName";
import runExtension from "roamjs-components/util/runExtension";
import { createConfigObserver } from "roamjs-components/components/ConfigPage";

const ID = "${projectName}";
const CONFIG = toConfigPageName(ID);
runExtension(ID, () => {
  createConfigObserver({ title: CONFIG, config: { tabs: [] } });
});
`
        );
      },
      skip: () => extensionExists,
    },
    {
      title: "Write main.tf",
      task: () => {
        return Promise.resolve(
          fs.writeFileSync(
            path.join(root, "main.tf"),
            `terraform {
  backend "remote" {
    hostname = "app.terraform.io"
    organization = "VargasArts"
    workspaces {
      prefix = "${name}"
    }
  }
  required_providers {
    github = {
      source = "integrations/github"
      version = "4.2.0"
    }
  }
}

variable "aws_access_token" {
  type = string
}

variable "aws_secret_token" {
  type = string
}

variable "developer_token" {
  type = string
}

variable "github_token" {
  type = string
}

provider "aws" {
  region = "us-east-1"
  access_key = var.aws_access_token
  secret_key = var.aws_secret_token
}

provider "github" {
    owner = "dvargas92495"
    token = var.github_token
}

module "roamjs_lambda" {
  source = "dvargas92495/lambda/roamjs"
  providers = {
    aws = aws
    github = github
  }

  name = "${projectName}"
  lambdas = [
    { 
      path = "${projectName}", 
      method = "post"
    },
  ]
  aws_access_token = var.aws_access_token
  aws_secret_token = var.aws_secret_token
  github_token     = var.github_token
  developer_token  = var.developer_token
}
`
          )
        );
      },
      skip: () => !backend,
    },
    {
      title: "Write .env.local",
      task: () => {
        return Promise.resolve(
          fs.writeFileSync(
            path.join(root, ".env.local"),
            `API_URL=http://localhost:3003/dev
`
          )
        );
      },
      skip: () => !backend,
    },
    {
      title: "Write lambdas",
      task: () => {
        fs.mkdirSync(path.join(root, "lambdas"));
        return fs.writeFileSync(
          path.join(root, "lambdas", `${projectName}_post.ts`),
          `import { APIGatewayProxyHandler } from "aws-lambda";

export const handler: APIGatewayProxyHandler = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
    }),
    headers: {
      "Access-Control-Allow-Origin": "https://roamresearch.com",
      "Access-Control-Allow-Methods": "POST",
    },
  };
}
`
        );
      },
      skip: () => !backend,
    },
    {
      title: "Create a github repo",
      task: () => {
        return axios
          .get(`https://api.github.com/repos/${user}/${repo}`)
          .then(() => console.log("Repo already exists."))
          .catch((e) =>
            e.response?.status === 404
              ? axios
                  .post(
                    "https://api.github.com/user/repos",
                    { name: repo },
                    githubOpts
                  )
                  .catch((err) =>
                    console.log("Failed to create repo", err.response?.data)
                  )
              : console.log("Failed to check repo", e.response?.data)
          );
      },
      skip: () => !user || !process.env.GITHUB_TOKEN || extensionExists,
    },
    {
      title: "Add Developer Tokens As Secrets",
      task: () => {
        // https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#example-encrypting-a-secret-using-nodejs
        const addSecret = (secretName: string) => {
          const secretValue = process.env[secretName];
          if (!secretValue) {
            console.log("No local developer token set, skip");
            return;
          }
          const messageBytes = Buffer.from(secretValue);
          return axios
            .get(
              `https://api.github.com/repos/${user}/${repo}/actions/secrets/public-key`,
              githubOpts
            )
            .then(({ data: { key, key_id } }) => {
              const keyBytes = Buffer.from(key, "base64");
              const encryptedBytes = sodium.seal(messageBytes, keyBytes);
              const encrypted_value = Buffer.from(encryptedBytes).toString(
                "base64"
              );
              return axios.put(
                `https://api.github.com/repos/${user}/${repo}/actions/secrets/${secretName}`,
                {
                  encrypted_value,
                  key_id,
                },
                githubOpts
              );
            });
        };
        process.env.ROAMJS_RELEASE_TOKEN = process.env.GITHUB_TOKEN;
        return Promise.all([
          addSecret("ROAMJS_DEVELOPER_TOKEN"),
          addSecret("ROAMJS_RELEASE_TOKEN"),
        ]).catch((e) => console.log("Failed to add secret", e.response?.data));
      },
      skip: () =>
        !user ||
        !process.env.GITHUB_TOKEN ||
        backend ||
        extensionExists ||
        !process.env.ROAMJS_DEVELOPER_TOKEN,
    },
    {
      title: "Git init",
      task: () => {
        process.chdir(root);
        return sync("git init", { stdio: "ignore" });
      },
      skip: () => extensionExists,
    },
    {
      title: "Git add",
      task: () => {
        process.chdir(root);
        return sync("git add -A", { stdio: "ignore" });
      },
      skip: () => extensionExists,
    },
    {
      title: "Git commit",
      task: () => {
        process.chdir(root);
        return sync(
          `git commit -m "Initial commit for RoamJS extension ${projectName}"`,
          {
            stdio: "ignore",
          }
        );
      },
      skip: () => extensionExists,
    },
    {
      title: "Git remote",
      task: () => {
        process.chdir(root);
        return new Promise<void>((resolve, reject) => {
          const child = spawn(
            "git",
            [
              "remote",
              "add",
              "origin",
              `https://github.com/${user}/${repo}.git`,
            ],
            {
              stdio: "inherit",
            }
          );
          child.on("close", (code) => {
            if (code !== 0) {
              reject(code);
              return;
            }
            resolve();
          });
        });
      },
      skip: () => !user || extensionExists,
    },
    {
      title: "Git push",
      task: () => {
        process.chdir(root);
        return sync(`git push origin main`, { stdio: "ignore" });
      },
      skip: () => !user || extensionExists,
    },
    {
      title: "Create Workspace",
      task: () => {
        const tfOpts = {
          headers: {
            Authorization: `Bearer ${terraformOrganizationToken}`,
            "Content-Type": "application/vnd.api+json",
          },
        };
        return axios
          .get<{
            data: { attributes: { "service-provider": string }; id: string }[];
          }>(
            "https://app.terraform.io/api/v2/organizations/VargasArts/oauth-clients",
            tfOpts
          )
          .then(
            (r) =>
              r.data.data.find(
                (cl) => cl.attributes["service-provider"] === "github"
              )?.id
          )
          .then((id) =>
            axios
              .get(
                `https://app.terraform.io/api/v2/oauth-clients/${id}/oauth-tokens`,
                tfOpts
              )
              .then((r) => r.data.data[0].id)
          )
          .then((id) =>
            axios
              .post(
                "https://app.terraform.io/api/v2/organizations/VargasArts/workspaces",
                {
                  data: {
                    type: "workspaces",
                    attributes: {
                      name,
                      "auto-apply": true,
                      "vcs-repo": {
                        "oauth-token-id": id,
                        identifier: `${user}/${repo}`,
                      },
                    },
                  },
                },
                tfOpts
              )
              .then((r) => r.data.data.id)
          )
          .then((id) =>
            Promise.all(
              [
                { key: "aws_access_token", env: "AWS_ACCESS_KEY_ID" },
                { key: "aws_secret_token", env: "AWS_SECRET_ACCESS_KEY" },
                { key: "developer_token", env: "ROAMJS_DEVELOPER_TOKEN" },
                { key: "github_token", env: "GITHUB_TOKEN" },
              ].map(({ key, env }) =>
                axios.post(
                  `https://app.terraform.io/api/v2/workspaces/${id}/vars`,
                  {
                    data: {
                      type: "vars",
                      attributes: {
                        key,
                        sensitive: true,
                        category: "terraform",
                        value: process.env[env],
                      },
                    },
                  },
                  tfOpts
                )
              )
            )
          );
      },
      skip: () =>
        !backend ||
        !terraformOrganizationToken ||
        !user ||
        !process.env.ROAMJS_DEVELOPER_TOKEN ||
        !process.env.GITHUB_TOKEN ||
        !process.env.AWS_ACCESS_KEY_ID ||
        !process.env.AWS_SECRET_ACCESS_KEY,
    },
  ] as { title: string; task: () => Promise<void>; skip?: () => boolean }[];
  for (const task of tasks) {
    console.log("Running", task.title, "...");
    if (task.skip?.()) {
      console.log("Skipped", task.title);
      continue;
    }
    const result = await Promise.resolve(task.task)
      .then((t) => t())
      .then(() => ({ success: true as const }))
      .catch((e) => ({ success: false as const, message: e.message }));
    if (!result.success) {
      return Promise.reject(result.message);
    }
  }
  console.log(`Package ${name} is ready!`);
  return Promise.resolve(0);
};

const JS_FILE_REGEX = /\.js$/;
const lambdas = async ({ build }: { build?: true }): Promise<number> => {
  process.env.NODE_ENV =
    process.env.NODE_ENV || (build ? "development" : "production");
  await new Promise((resolve) => rimraf(appPath("out"), resolve));
  return new Promise<number>((resolve, reject) => {
    const entryPoints = Object.fromEntries(
      fs
        .readdirSync("./lambdas/", { withFileTypes: true })
        .filter((f) => !f.isDirectory())
        .map((f) => f.name)
        .map((f) => [f.replace(/\.[t|j]s$/, ""), `./lambdas/${f}`])
    );
    const jsdomPatch: esbuild.Plugin = {
      name: "jsdom-patch",
      setup: (build) => {
        build.onLoad({ filter: /XMLHttpRequest-impl\.js$/ }, async (args) => {
          let contents = await fs.promises.readFile(args.path, "utf8");

          contents = contents.replace(
            'const syncWorkerFile = require.resolve ? require.resolve("./xhr-sync-worker.js") : null;',
            `const syncWorkerFile = null;`
          );

          return { contents, loader: "js" };
        });
      },
    };
    return esbuild
      .build({
        entryPoints,
        bundle: true,
        outdir: appPath("out"),
        platform: "node",
        external: ["aws-sdk", "canvas", "re2"],
        minify: true,
        plugins: [jsdomPatch],
        define: getDotEnvObject(),
      })
      .then((r) =>
        r.errors.length
          ? reject(JSON.stringify(r.errors))
          : resolve(r.errors.length)
      )
      .catch(reject);
  }).then((code) => {
    return Promise.all(
      fs
        .readdirSync(appPath("out"), { withFileTypes: true })
        .filter((f) => !f.isDirectory())
        .map((f) => f.name)
        .filter((f) => JS_FILE_REGEX.test(f))
        .map((f) => {
          const zip = new JSZip();
          console.log(`Zipping ${path.join(appPath("out"), f)}...`);
          const content = fs.readFileSync(path.join(appPath("out"), f));
          zip.file(f, content, { date: new Date("09-24-1995") });
          const name = f.replace(/\.js$/, "");
          const shasum = crypto.createHash("sha256");
          const data: Uint8Array[] = [];
          return new Promise<void>((resolve, reject) =>
            zip
              .generateNodeStream({ type: "nodebuffer", streamFiles: true })
              .on("data", (d) => {
                data.push(d);
                shasum.update(d);
              })
              .on("end", () => {
                console.log(`Zip of ${name} complete (${data.length}).`);
                const sha256 = shasum.digest("base64");
                const FunctionName = `RoamJS_${name}`;
                lambda
                  .getFunction({
                    FunctionName,
                  })
                  .promise()
                  .then((l) => {
                    if (sha256 === l.Configuration?.CodeSha256) {
                      return `No need to upload ${f}, shas match.`;
                    } else {
                      return build
                        ? new Promise((resolve) =>
                            fs.writeFile(
                              path.join(
                                appPath("out"),
                                f.replace(/\.js$/, ".zip")
                              ),
                              Buffer.concat(data).toString(),
                              () =>
                                resolve(
                                  `Would've uploaded ${f}, wrote zip to disk. Lambda SHA ${l.Configuration?.CodeSha256}. Local SHA ${sha256}.`
                                )
                            )
                          )
                        : lambda
                            .updateFunctionCode({
                              FunctionName,
                              Publish: true,
                              ZipFile: Buffer.concat(data),
                            })
                            .promise()
                            .then(
                              (upd) =>
                                `Succesfully uploaded ${f} at ${upd.LastModified}`
                            );
                    }
                  })
                  .then(console.log)
                  .then(resolve)
                  .catch(reject);
              })
          );
        })
    ).then(() => code);
  });
};

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

const toDoubleDigit = (n: number) => n.toString().padStart(2, "0");

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
      const s3 = new AWS.S3({
        apiVersion: "2006-03-01",
        credentials,
      });
      const cloudfront = new AWS.CloudFront({
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
            .promise()
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
      const version = `${today.getFullYear()}-${toDoubleDigit(
        today.getMonth() + 1
      )}-${toDoubleDigit(today.getDate())}-${toDoubleDigit(
        today.getHours()
      )}-${toDoubleDigit(today.getMinutes())}`;
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
            s3
              .upload({
                Key: `${destPath}/${version}${fileName}`,
                ...uploadProps,
                Body: fs.createReadStream(p),
              })
              .promise(),
            s3
              .upload({
                Key,
                ...uploadProps,
                Body: fs.createReadStream(p),
              })
              .promise(),
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
            .promise()
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

const run = async (command: string, args: string[]): Promise<number> => {
  const opts = Object.fromEntries(
    args
      .map(
        (a, i) =>
          [
            a,
            args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true,
          ] as const
      )
      .filter(([k]) => k.startsWith("--"))
      .map(([k, v]) => [k.replace(/^--/, ""), v])
  );
  switch (command) {
    case "build":
      return build();
    case "dev":
      return dev(opts);
    case "init":
      return init(opts);
    case "lambdas":
      return lambdas(opts);
    case "publish":
      return publish(opts);
    default:
      console.error("Command", command, "is unsupported");
      return 1;
  }
};

if (process.env.NODE_ENV !== "test") {
  run(process.argv[2], process.argv.slice(3))
    .then((code) => code >= 0 && process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export default run;
