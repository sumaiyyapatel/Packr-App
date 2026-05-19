const {
  withAppBuildGradle,
  withProjectBuildGradle,
} = require('@expo/config-plugins');

const GOOGLE_SERVICES_CLASSPATH = "classpath 'com.google.gms:google-services:4.4.4'";
const GOOGLE_SERVICES_PLUGIN = "apply plugin: 'com.google.gms.google-services'";

function withGoogleServicesGradle(config) {
  config = withProjectBuildGradle(config, (nextConfig) => {
    const gradle = nextConfig.modResults;
    if (gradle.language !== 'groovy') return nextConfig;

    let contents = gradle.contents;
    contents = contents.replace(
      /classpath ['"]com\.google\.gms:google-services:[^'"]+['"]/,
      GOOGLE_SERVICES_CLASSPATH
    );

    if (!contents.includes(GOOGLE_SERVICES_CLASSPATH)) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n        ${GOOGLE_SERVICES_CLASSPATH}`
      );
    }

    gradle.contents = contents;
    return nextConfig;
  });

  return withAppBuildGradle(config, (nextConfig) => {
    const gradle = nextConfig.modResults;
    if (gradle.language !== 'groovy') return nextConfig;

    if (!gradle.contents.includes(GOOGLE_SERVICES_PLUGIN)) {
      gradle.contents = `${gradle.contents.trim()}\n\n${GOOGLE_SERVICES_PLUGIN}\n`;
    }

    return nextConfig;
  });
}

module.exports = withGoogleServicesGradle;
