const { expo } = require('./app.json');

module.exports = () => {
  const config = {
    ...expo,
    plugins: [...(expo.plugins || [])],
  };

  if (process.env.PACKR_ANDROID_ALLOW_CLEARTEXT === '1') {
    config.plugins.push('./plugins/android-cleartext');
  }

  return config;
};
