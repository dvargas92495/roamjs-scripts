import type { CliArgs } from "@samepage/scripts/internal/compile";
import getPackageName from "./getPackageName";

const args = ({ env = [], ...params }: CliArgs = {}): CliArgs => {
  process.env.BLUEPRINT_NAMESPACE = "bp3";
  process.env.ROAM_DEPOT = "true";
  process.env.ROAMJS_EXTENSION_ID =
    process.env.ROAMJS_EXTENSION_ID || getPackageName();
  return {
    external: [
      "react-dom/client",
      "@blueprintjs/core=window.Blueprint.Core",
      "@blueprintjs/datetime=window.Blueprint.DateTime",
      "@blueprintjs/select=window.Blueprint.Select",
      "chrono-node=window.ChronoNode",
      "crypto-js=window.CryptoJS",
      "cytoscape=window.RoamLazy.Cytoscape",
      "file-saver=window.FileSaver",
      "jszip=window.RoamLazy.JSZip",
      "idb=window.idb",
      "insect=window.RoamLazy.Insect",
      "marked=window.RoamLazy.Marked",
      "marked-react=window.RoamLazy.MarkedReact",
      "nanoid=window.Nanoid",
      "react=window.React",
      "react-dom=window.ReactDOM",
      "react-youtube=window.ReactYoutube",
      "tslib=window.TSLib",
    ],
    include: ["package.json", "README.md"],
    out: "extension",
    env: [
      "ROAM_DEPOT",
      "BLUEPRINT_NAMESPACE",
      "ROAMJS_EXTENSION_ID",
      "API_URL",
    ].concat(env),
    mirror: ".",
    format: "esm",
    ...params,
  };
};

export default args;
