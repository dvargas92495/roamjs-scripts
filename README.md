# roamjs-scripts
    
A series of developer utilities to help make Roam extensions that can be hosted on [RoamJS](https://roamjs.com).

### build

Uses webpack to build your extension to a single javascript entry file. Looks for a script named `index` or the same name as the package name to serve as the entrypoint. Compiled scripts are in the `build` folder.

### dev

Compiles your extension and serves it from `webpack-dev-server`. Changes made while the server is running will automatically be built.

### init

Generates a new repo for a new RoamJS extension. Please reach out before using this command, as its very opinionated towards my specific workflow at the moment. It supports the following argument:
- `name` - The name of the RoamJS extension
- `description` - The description of the RoamJS extension
- `user` - The name of the github repo to create for the extension
- `backend` - A boolean flag indicating whether or not to include backend resources for the extension.

You could also add the following environment variables:
- `GITHUB_TOKEN` - A personal access token from your GitHub account with permission to create repos. Set this if you want a github repo of the same name created in your account.
- `ROAMJS_DEVELOPER_TOKEN` - The RoamJS token generated for you at [https://roamjs.com/services/developer](https://roamjs.com/services/developer). Set this if you want a GitHub action for publishing the extension to RoamJS created for you, as well as the token added as a secret to your repo. 

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
