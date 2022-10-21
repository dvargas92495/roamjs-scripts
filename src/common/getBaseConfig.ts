import webpack from "webpack";
import fs from "fs";
import path from "path";
import getPackageName from "./getPackageName";
import getDotEnvObject from "./getDotEnvObject";
import appPath from "./appPath";
import "@babel/polyfill";

const getDotEnvPlugin = () => new webpack.DefinePlugin(getDotEnvObject());

const getBaseConfig = (): Promise<
  Required<
    Pick<
      webpack.Configuration,
      | "entry"
      | "module"
      | "target"
      | "resolve"
      | "output"
      | "plugins"
      | "experiments"
      | "externals"
      | "externalsType"
    >
  > &
    Partial<Pick<webpack.Configuration, "optimization">>
> => {
  const srcFiles = fs.readdirSync("./src/");
  const name = getPackageName();

  const entryFile =
    srcFiles.find((s) => new RegExp(`${name}\\.(t|j)s`).test(s)) ||
    srcFiles.find((s) => /index\.(t|j)s/.test(s));
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
          .map((f) => [
            f.name.replace(/\.[t|j]s$/, ""),
            `./src/workers/${f.name}`,
          ])
      )
    : {};
  const isForRoamDepot =
    process.env.ROAM_MARKETPLACE === "true" ||
    process.env.ROAM_DEPOT === "true";

  return Promise.resolve({
    target: "web",
    externals: {
      "@blueprintjs/core": ["Blueprint", "Core"],
      "@blueprintjs/datetime": ["Blueprint", "DateTime"],
      "@blueprintjs/select": ["Blueprint", "Select"],
      "chrono-node": "ChronoNode",
      crypto: "crypto",
      "crypto-js": "CryptoJS",
      "file-saver": "FileSaver",
      jszip: ["RoamLazy", "JSZip"],
      idb: "idb",
      marked: ["RoamLazy", "Marked"],
      "marked-react": ["RoamLazy", "MarkedReact"],
      nanoid: "Nanoid",
      react: "React",
      "react-dom": "ReactDOM",
      "react-dom/client": "ReactDOM",
      tslib: "TSLib",
    } as Record<string, string | string[]>,
    externalsType: "window",
    resolve: {
      modules: ["node_modules", appPath("node_modules")],
      extensions: [".ts", ".js", ".tsx", ".jsx"],
    },
    plugins: [getDotEnvPlugin()],
    entry: {
      [isForRoamDepot ? "extension" : "main"]: [
        "@babel/polyfill",
        `./src/${entryFile}`,
      ],
      ...workers,
    },
    ...(isForRoamDepot
      ? {
          output: {
            path: path.resolve("."),
            filename: "[name].js",
            library: {
              type: "module",
            },
          },
          experiments: {
            outputModule: true,
          },
        }
      : {
          output: {
            path: path.resolve("build"),
            filename: "[name].js",
          },
          experiments: {},
        }),
    module: {
      rules: [
        {
          test: /\.[jt]sx?$/,
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
          ],
          exclude: /node_modules/,
        },
        {
          test: /\.tsx?$/,
          use: [
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
      ],
    },
  });
};

export default getBaseConfig;
