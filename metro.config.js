const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Keep Metro's file watcher away from native build/intermediate dirs.
    // On Windows these (esp. android/app/.cxx) are created and deleted during
    // Gradle/CMake builds, which can crash Metro's fallback watcher (ENOENT).
    blockList: [
      /[\\/]android[\\/]\.gradle[\\/].*/,
      /[\\/]android[\\/]build[\\/].*/,
      /[\\/]android[\\/]app[\\/]build[\\/].*/,
      /[\\/]android[\\/]app[\\/]\.cxx[\\/].*/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);