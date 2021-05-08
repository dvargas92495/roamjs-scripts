#!/usr/bin/env node
import webpack from "webpack";
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

const appPath = (p: string) => path.resolve(fs.realpathSync(process.cwd()), p);

const getBaseConfig = (): Promise<
  Required<
    Pick<
      webpack.Configuration,
      "entry" | "module" | "target" | "resolve" | "output" | "plugins"
    >
  >
> => {
  const srcFiles = fs.readdirSync("./src/");

  const name = fs.existsSync("package.json")
    ? JSON.parse(fs.readFileSync("package.json").toString())?.name
    : repoName.sync({ cwd: path.resolve(".") });

  const entryFile =
    srcFiles.find((s) => /index\.(t|j)s/.test(s)) ||
    srcFiles.find((s) => new RegExp(`${name}\\.(t|j)s`).test(s));
  if (!entryFile) {
    return Promise.reject(
      `Need an entry file in the \`src\` directory named index or ${name}`
    );
  }

  const env = fs.existsSync(".env.local")
    ? dotenv.parse(fs.readFileSync(".env.local"))
    : {};
  return Promise.resolve({
    entry: `./src/${entryFile}`,
    target: "web",
    resolve: {
      modules: ["node_modules", appPath("node_modules")],
      extensions: [".ts", ".js", ".tsx"],
    },
    output: {
      path: path.resolve("build"),
      filename: "main.js",
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
          test: /\.(png|jpe?g|gif)$/i,
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
          test: /\.(png|woff|woff2|eot|ttf)$/,
          loader: "url-loader?limit=100000",
        },
        {
          test: /\.ne$/,
          use: ["nearley-loader"],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin(
        Object.fromEntries(
          Object.keys(env).map((k) => [`process.env.${k}`, env[k]])
        )
      ),
    ],
  });
};

const build = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    getBaseConfig()
      .then((baseConfig) => {
        webpack(
          {
            ...baseConfig,
            mode: "production",
            performance: {
              hints: "error",
              maxEntrypointSize: 5000000,
              maxAssetSize: 5000000,
            },
          },
          (err, stats) => {
            if (err || !stats) {
              reject(err);
            } else {
              console.log(
                "Successfully compiled from",
                new Date(stats.startTime || 0).toLocaleTimeString(),
                "to",
                new Date(stats.endTime || 0).toLocaleTimeString()
              );
              if (stats.hasErrors()) {
                reject(
                  stats.toString({
                    chunks: false,
                    colors: true,
                  })
                );
              } else {
                resolve(0);
              }
            }
          }
        );
      })
      .catch(reject);
  });
};

const dev = async ({ port: inputPort }: { port: string }): Promise<number> => {
  const port = Number(inputPort) || 8000;
  return new Promise((resolve, reject) => {
    getBaseConfig()
      .then((baseConfig) => {
        baseConfig.module.rules.push({
          test: /\.js$/,
          enforce: "pre",
          use: ["source-map-loader"],
        });
        baseConfig.output.publicPath = `http://localhost:${port}/`;
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
          host: "127.0.0.1",
          disableHostCheck: true,
          publicPath: `http://localhost:${port}/`,
          headers: {
            "Access-Control-Allow-Origin": "https://roamresearch.com",
          },
          clientLogLevel: "none",
          injectClient: false,
          hot: false,
          inline: false,
        });

        server.listen(port, "localhost", function (err) {
          if (err) {
            reject(err);
          } else {
            console.log("WebpackDevServer listening at localhost:", port);
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
  user,
}: {
  name?: string;
  description?: string;
  user?: string;
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
  const tasks = [
    {
      title: "Make Project Directory",
      task: () => fs.mkdirSync(name),
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
    },
    {
      title: "Write main.yaml",
      task: () => {
        fs.mkdirSync(path.join(root, ".github", "workflows"), {
          recursive: true,
        });
        return fs.writeFileSync(
          path.join(root, "main.yaml"),
          `name: Publish Extension
on:
  push:
    branches: main

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
        uses: dvargas92495/roamjs-publish@0.2.0
        with:
          token: \${{ secrets.ROAMJS_DEVELOPER_TOKEN }}
          source: build
          path: ${projectName}
          release_token: \${{ secrets.ROAMJS_RELEASE_TOKEN }}
`
        );
      },
    },
    {
      title: "Write .gitignore",
      task: () => {
        return fs.writeFileSync(
          path.join(root, ".gitignore"),
          `node_modules
build
`
        );
      },
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
          ];
          const child = spawn(
            "npm",
            ["install", "--save-dev"].concat(dependencies),
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
    },
    {
      title: "Install Packages",
      task: () => {
        process.chdir(root);
        return new Promise<void>((resolve, reject) => {
          const dependencies = [
            "@blueprintjs/core",
            "@blueprintjs/select",
            "react",
            "react-dom",
            "roam-client",
            "roamjs-components",
          ];
          const child = spawn("npm", ["install"].concat(dependencies), {
            stdio: "inherit",
          });
          child.on("close", (code) => {
            if (code !== 0) {
              reject(code);
              return;
            }
            resolve();
          });
        });
      },
    },
    {
      title: "Write src",
      task: () => {
        fs.mkdirSync(path.join(root, "src"));
        return fs.writeFileSync(
          path.join(root, "src", "index.ts"),
          `const CONFIG = \`roam/js/${projectName}\`;`
        );
      },
    },
    {
      title: "Create a github repo",
      task: () => {
        return axios
          .post("https://api.github.com/user/repos", { name }, githubOpts)
          .catch((e) => console.log("Failed to create repo", e.response?.data));
      },
      skip: () => !user || !process.env.GITHUB_TOKEN,
    },
    {
      title: "Add Developer Tokens",
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
              `https://api.github.com/repos/${user}/${name}/actions/secrets/public-key`,
              githubOpts
            )
            .then(({ data: { key } }) => {
              const keyBytes = Buffer.from(key, "base64");
              const encryptedBytes = sodium.seal(messageBytes, keyBytes);
              const encrypted_value = Buffer.from(encryptedBytes).toString(
                "base64"
              );
              return axios.put(
                `https://api.github.com/repos/${user}/${name}/actions/secrets/${secretName}`,
                {
                  encrypted_value,
                  key_id: key,
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
      skip: () => !user || !process.env.GITHUB_TOKEN,
    },
    {
      title: "Git init",
      task: () => {
        process.chdir(root);
        return sync("git init", { stdio: "ignore" });
      },
    },
    {
      title: "Git add",
      task: () => {
        process.chdir(root);
        return sync("git add -A", { stdio: "ignore" });
      },
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
    },
    {
      title: "Git remote",
      task: () => {
        process.chdir(root);
        return sync(
          `git remote add origin "https:\\/\\/github.com\\/${user}\\/${name}.git"`,
          { stdio: "ignore" }
        );
      },
      skip: () => !user,
    },
    {
      title: "Git push",
      task: () => {
        process.chdir(root);
        return sync(`git push origin main`, { stdio: "ignore" });
      },
      skip: () => !user,
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

const run = async (command: string, args: string[]): Promise<number> => {
  const opts = Object.fromEntries(
    args
      .map((a, i) => [a.replace(/^--/, ""), args[i + 1]])
      .filter((_, i) => i % 2 == 0)
  );
  switch (command) {
    case "build":
      return build();
    case "dev":
      return dev(opts);
    case "init":
      return init(opts);
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
