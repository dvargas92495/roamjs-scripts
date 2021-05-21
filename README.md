# roamjs-scripts
    
A series of developer utilities to help make Roam extensions that can be hosted on [RoamJS](https://roamjs.com).

### build

Uses webpack to build your extension to a single javascript entry file. Looks for a script named `index` or the same name as the package name to serve as the entrypoint. Compiled scripts are in the `build` folder.

### dev

Compiles your extension and serves it from `webpack-dev-server`. Changes made while the server is running will automatically be built.

### init

Generates a new repo for a new RoamJS extension. Please reach out before using this command, as its very opinionated towards my specific workflow at the moment.

### lambdas

Compiles the files in the `lambdas` directory and uploads to lambda functions of a similar name. These lambdas will serve as the backend of the extension. Please reach out before using this command, as its very opinionated towards my specific workflow at the moment.

### publish

Uploads your extension to RoamJS' hosting service for distribution. It supports the following arguments:
- `path` - The RoamJS destination path that the extension is being uploaded to.
- `source` - The source directory that the extension will upload assets from. Default value `build`.
- `token` - The RoamJS developer token required to be allowed to upload to RoamJS. To generate a token, sign up at `https://roamjs.com/services/developer`. Default value uses the `ROAMJS_DEVELOPER_TOKEN` environment variable (recommended).

To use from `npx`:

```bash
npx roamjs-scripts publish --path google-calendar --source build
```

To use from `npm` script after installing:
```bash
roamjs-scripts publish --path google-calendar --source build
```
