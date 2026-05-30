const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // Bundle .tflite models as assets so require() resolves them for
    // react-native-fast-tflite.
    assetExts: [...defaultConfig.resolver.assetExts, 'tflite'],
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

module.exports = withNativeWind(mergeConfig(defaultConfig, config), {
  input: './global.css',
});
