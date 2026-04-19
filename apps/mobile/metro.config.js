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

module.exports = config;
