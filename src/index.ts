#!/usr/bin/env node
import webpack from "webpack";
import fs from "fs";
import path from "path";
import repoName from "git-repo-name";
import Dotenv from "dotenv-webpack";

const build = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const srcFiles = fs.readdirSync("./src/");
    console.log("Found", srcFiles, "in src");
    const name = fs.existsSync("package.json")
      ? JSON.parse(fs.readFileSync("package.json").toString())?.name
      : repoName.sync({ cwd: path.resolve(".") });
    console.log("Decided on extension name", name);
    const entryFile =
      srcFiles.find((s) => /index\.(t|j)s/.test(s)) ||
      srcFiles.find((s) => new RegExp(`${name}\\.(t|j)s`).test(s));
    if (!entryFile) {
      console.error(
        `Need an entry file in the \`src\` directory named index or ${name}`
      );
      reject(1);
      return;
    }
    console.log("Using entry file", entryFile);
    webpack(
      {
        entry: {
          [name]: `./src/${entryFile}`,
        },
        resolve: {
          modules: ["node_modules"],
          extensions: [".ts", ".js", ".tsx"],
        },
        output: {
          path: "build",
          filename: "[name].js",
        },
        module: {
          rules: [
            {
              test: /\.tsx?$/,
              use: [
                {
                  loader: "babel-loader",
                  options: {
                    cacheDirectory: true,
                    cacheCompression: false,
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
              use: [
                {
                  loader: "url-loader",
                  options: {
                    limit: 100000,
                  },
                },
              ],
            },
            {
              test: /\.ne$/,
              use: ["nearley-loader"],
            },
          ],
        },
        plugins: [
          new Dotenv({
            path: ".env.local",
            systemvars: true,
            silent: true,
          }),
        ],
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
          resolve(0);
        }
      }
    );
  });
};

const run = async (command: string): Promise<number> => {
  switch (command) {
    case "build":
      return build();
    default:
      console.error("Command", command, "is unsupported");
      return 1;
  }
};

if (process.env.NODE_ENV !== "test") {
  run(process.argv[2]).then((code) => process.exit(code));
}

export default run;
