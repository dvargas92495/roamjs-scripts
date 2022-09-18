import appPath from "./common/appPath";
import webpack from "webpack";
import webpackDevServer from "webpack-dev-server";
import getBaseConfig from "./common/getBaseConfig";
import getPackageName from "./common/getPackageName";
import labsDev from "./labs/dev";
import args from "./common/args";

const dev = async ({
  host: inputHost,
  port: inputPort,
  hot: hotReloading = false,
  marketplace = false,
  depot = marketplace,
  labs = false,
}: {
  host?: string;
  port?: string;
  hot?: boolean;
  // @deprecated
  marketplace?: boolean;
  depot?: boolean;
  labs?: boolean;
}): Promise<number> => {
  if (labs) return labsDev(args())
  const port = Number(inputPort) || 8000;
  const host = inputHost || "127.0.0.1";
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  process.env.ROAMJS_VERSION = process.env.ROAMJS_VERSION || "development";
  process.env.ROAMJS_EXTENSION_ID =
    process.env.ROAMJS_EXTENSION_ID || getPackageName();
  if (depot) {
    process.env.ROAM_MARKETPLACE = "true";
    process.env.ROAM_DEPOT = "true";
    process.env.API_URL = process.env.API_URL || "https://lambda.roamjs.com";
  } else {
    process.env.ROAM_MARKETPLACE = "";
    process.env.ROAM_DEPOT = "";
    process.env.API_URL = process.env.API_URL || "http://localhost:3003/dev";
  }
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
          host: host,
          headers: {
            "Access-Control-Allow-Origin": "https://roamresearch.com",
          },
          hot: hotReloading,
          devMiddleware: {
            writeToDisk: true,
            publicPath: `http://${hostOutput}:${port}/`,
          },
          static: {
            directory: appPath("build"),
          },
          allowedHosts: "all",
          client: false,
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

export default dev;
