import webpack, { Stats } from "webpack";
import toVersion from "./common/toVersion";
import fs from "fs";
import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer";
import TerserWebpackPlugin from "terser-webpack-plugin";
import getBaseConfig from "./common/getBaseConfig";
import getPackageName from "./common/getPackageName";
import labsBuild from "@samepage/scripts/build";
import args from "./common/args";

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

const build = ({
  analyze,
  marketplace,
  depot = marketplace,
  max = "5000000",
  labs = false,
}: {
  analyze?: boolean;
  max?: string;
  depot?: boolean;
  // @deprecated
  marketplace?: boolean;
  labs?: boolean;
}): Promise<number> => {
  if (labs) {
    process.env.LABS = "true";
    return labsBuild({
      ...args({ analyze, max }),
      review: "node_modules/roamjs-scripts/publish.js",
    });
  }
  const version = toVersion();
  const envExisting = fs.existsSync(".env")
    ? fs.readFileSync(".env").toString()
    : "";
  fs.writeFileSync(
    ".env",
    `${envExisting.replace(
      /ROAMJS_VERSION=[\d-]+\n/gs,
      ""
    )}ROAMJS_VERSION=${version}\n`
  );
  process.env.ROAMJS_EXTENSION_ID =
    process.env.ROAMJS_EXTENSION_ID || getPackageName();
  if (depot) {
    process.env.ROAM_MARKETPLACE = "true";
    process.env.ROAM_DEPOT = "true";
    process.env.API_URL = process.env.API_URL || "https://lambda.roamjs.com";
  } else {
    process.env.ROAM_MARKETPLACE = "";
    process.env.ROAM_DEPOT = "";
  }
  return new Promise((resolve, reject) => {
    getBaseConfig()
      .then((baseConfig) => {
        if (analyze) {
          baseConfig.plugins.push(
            new BundleAnalyzerPlugin({
              analyzerMode: "static",
              generateStatsFile: true,
            })
          );
          baseConfig.optimization = {
            minimize: false,
          };
          delete baseConfig.output.library;
        } else {
          baseConfig.optimization = optimization;
        }
        const maxEntrypointSize = Number(max) || 5000000;
        webpack(
          {
            ...baseConfig,
            mode: "production",
            performance: {
              hints: analyze ? "warning" : "error",
              maxEntrypointSize,
              maxAssetSize: maxEntrypointSize,
            },
            stats: "verbose",
          },
          webpackCallback(resolve, reject)
        );
      })
      .catch(reject);
  });
};

export default build;
