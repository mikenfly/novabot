const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = {
  watchFolders: [sharedRoot],
  resolver: {
    // Allow Metro to resolve modules from shared/
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(projectRoot, '..', 'node_modules'),
    ],
    // Map @nanoclaw/shared to the shared directory
    extraNodeModules: {
      '@nanoclaw/shared': sharedRoot,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
