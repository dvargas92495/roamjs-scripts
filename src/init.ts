import getName from "git-user-name";
import os from "os";
import spawn, { sync } from "cross-spawn";
import sodium from "tweetsodium";
import fs from "fs";
import path from "path";
import axios from "axios";

const EXTENSION_NAME_REGEX = /^[a-z][a-z0-9-]*$/;
const init = async ({
  name,
  description,
  user = process.env.GITHUB_USERNAME,
  backend,
  repo = name,
  email = `${user}@gmail.com`,
}: {
  name?: string;
  description?: string;
  user?: string;
  backend?: boolean;
  repo?: string;
  email?: string;
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
  const extensionName = name.replace(/^roamjs-/, "");
  const extensionDescription =
    description || `Description for ${extensionName}.`;
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
          name: extensionName,
          version: "1.0.0",
          description: extensionDescription,
          main: "./build/main.js",
          scripts: {
            "prebuild:roam": "npm install",
            "build:roam":
              "cross-env ROAM_MARKETPLACE=true roamjs-scripts build --depot",
            "dev:roam": "cross-env ROAM_MARKETPLACE=true roamjs-scripts dev --depot",
            start: "roamjs-scripts dev",
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
          `# ${extensionName}
        
${extensionDescription}
  
For full documentation, checkout https://roamjs.com/extensions/${extensionName}!
`
        ),
      skip: () => extensionExists,
    },
    {
      title: "Write build.sh",
      task: () =>
        fs.writeFileSync(path.join(root, "build.sh"), `npm run build:roam`),
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

env:
  API_URL: https://lambda.roamjs.com
  ROAMJS_DEVELOPER_TOKEN: \${{ secrets.ROAMJS_DEVELOPER_TOKEN }}
  ROAMJS_RELEASE_TOKEN: \${{ secrets.ROAMJS_RELEASE_TOKEN }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: install
        run: npm install
      - name: build
        run: npx roamjs-scripts build 
      - name: publish
        run: npx roamjs-scripts publish --email support@roamjs.com --commit \${{ github.sha }} --depot
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
    ROAMJS_EMAIL: ${email}
    ROAMJS_EXTENSION_ID: ${extensionName}
  
  jobs:
    deploy:
      runs-on: ubuntu-18.04
      steps:
        - uses: actions/checkout@v2
        - name: Use Node.js 16.14.0
          uses: actions/setup-node@v1
          with:
            node-version: 16.14.0
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
  .env
  .env.local
  extension.js
  extension.js.LICENSE.txt
  report.html
  stats.json
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
      title: "Install Dev Package",
      task: () => {
        process.chdir(root);
        return new Promise<void>((resolve, reject) => {
          const child = spawn(
            "npm",
            ["install", "--save-dev", "--quiet", "roamjs-scripts"],
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
          const child = spawn(
            "npm",
            ["install", "--quiet", "roamjs-components"],
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

const extensionId = "${extensionName}";
const CONFIG = toConfigPageName(extensionId);
export default runExtension({
  extensionId, 
  run: () => {
    createConfigObserver({ title: CONFIG, config: { tabs: [] } });
  },
  unload: () => {},
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
  
    name = "${extensionName}"
    lambdas = [
      { 
        path = "${extensionName}", 
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
      title: "Write .env",
      task: () => {
        return Promise.resolve(
          fs.writeFileSync(
            path.join(root, ".env"),
            `API_URL=http://localhost:3003/dev
  ROAMJS_EMAIL=${email}
  ROAMJS_EXTENSION_ID=${extensionName}
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
          path.join(root, "lambdas", `${extensionName}_post.ts`),
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
          `git commit -m "Initial commit for RoamJS extension ${extensionName}"`,
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

export default init;
