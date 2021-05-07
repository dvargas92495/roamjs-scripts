#!/usr/bin/env node
import webpack from "webpack";
import webpackDevServer from "webpack-dev-server";
import fs from "fs";
import path from "path";
import repoName from "git-repo-name";
import dotenv from "dotenv";

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
    entry: {
      main: `./src/${entryFile}`,
    },
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
        baseConfig.plugins.push(new webpack.HotModuleReplacementPlugin());
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
          hot: true,
          publicPath: `http://localhost:${port}/`,
          headers: {
            "Access-Control-Allow-Origin": "https://roamresearch.com",
          },
          clientLogLevel: "none",
          injectClient: true,
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
