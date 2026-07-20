const fs = require('fs');
const path = require('path');
const { expo } = require('./app.json');

module.exports = () => {
  const config = {
    ...expo,
    ios: { ...(expo.ios || {}) },
    android: { ...(expo.android || {}) },
    plugins: [...(expo.plugins || [])],
  };

  // Only reference Google services files that actually exist, so the config
  // still parses on machines without the iOS plist (Android-only dev).
  for (const platform of ['ios', 'android']) {
    const file = config[platform].googleServicesFile;
    if (file && !fs.existsSync(path.resolve(__dirname, file))) {
      delete config[platform].googleServicesFile;
    }
  }

  if (process.env.PACKR_ANDROID_ALLOW_CLEARTEXT === '1') {
    config.plugins.push('./plugins/android-cleartext');
  }

  return config;
};
