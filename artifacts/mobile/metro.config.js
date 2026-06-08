const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Sentry's postinstall script creates _tmp_ directories that are then removed.
// Metro tries to watch them and crashes with ENOENT. Block the pattern.
config.resolver = config.resolver ?? {};
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  /_tmp_\d+/,
];

module.exports = config;
