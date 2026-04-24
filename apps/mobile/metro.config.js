const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/** Monorepo: dependencies may live in the repo root `node_modules` while `expo` stays under `apps/mobile`. */
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

const { resolveRequest: upstreamResolve } = config.resolver;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@sheepmug/permissions-catalog") {
    return {
      filePath: path.resolve(monorepoRoot, "src/permissions/catalog.ts"),
      type: "sourceFile",
    };
  }
  if (typeof upstreamResolve === "function") {
    return upstreamResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
