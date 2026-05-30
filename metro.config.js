const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

// Buffer the JS bundle response and send it with an explicit Content-Length
// instead of Transfer-Encoding: chunked. The Android okhttp client trips over
// large chunked dev bundles on the emulator (ProtocolException: "Expected
// leading [0-9a-fA-F] character but was 0xd"); a non-chunked response avoids it.
function bufferBundleMiddleware(middleware) {
  return (req, res, next) => {
    if (req.url && req.url.includes('.bundle')) {
      // Disable gzip for the bundle: Metro's compression middleware also wraps
      // res.write/res.end, and combined with our buffering it corrupts the
      // output. Forcing identity encoding means only our Content-Length
      // buffering runs, yielding a clean, non-chunked plain-text bundle.
      req.headers['accept-encoding'] = 'identity';
      const chunks = [];
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);
      const push = (chunk, encoding) => {
        if (chunk) {
          // Copy: Node may reuse the underlying buffer for the next write, so
          // storing the reference would corrupt earlier chunks.
          chunks.push(
            Buffer.isBuffer(chunk)
              ? Buffer.from(chunk)
              : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined),
          );
        }
      };
      res.write = (chunk, encoding, cb) => {
        push(chunk, encoding);
        if (typeof encoding === 'function') encoding();
        else if (typeof cb === 'function') cb();
        return true;
      };
      res.end = (chunk, encoding, cb) => {
        if (typeof chunk === 'function') {
          cb = chunk;
          chunk = undefined;
        } else if (typeof encoding === 'function') {
          cb = encoding;
          encoding = undefined;
        }
        push(chunk, encoding);
        const body = Buffer.concat(chunks);
        try {
          res.removeHeader('Transfer-Encoding');
          res.setHeader('Content-Length', String(body.length));
        } catch {}
        origWrite(body);
        return origEnd(cb);
      };
    }
    return middleware(req, res, next);
  };
}

const config = {
  server: {
    enhanceMiddleware: bufferBundleMiddleware,
  },
  resolver: {
    // .tflite kept as an asset ext (harmless; the model now loads from native
    // android assets via file:///android_asset rather than require()).
    assetExts: [...defaultConfig.resolver.assetExts, 'tflite'],
    // Keep Metro's file watcher away from native build/intermediate dirs.
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
