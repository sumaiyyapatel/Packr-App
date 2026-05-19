const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const appJsonPath = path.join(root, 'app.json');
const googleServicesPath = path.join(root, 'google-services.json');
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const debugKeystorePath = path.join(root, 'android', 'app', 'debug.keystore');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function ok(label, value) {
  console.log(`OK  ${label}: ${value}`);
}

function warn(label, value) {
  console.log(`WARN ${label}: ${value}`);
}

function fail(label, value) {
  console.log(`FAIL ${label}: ${value}`);
  process.exitCode = 1;
}

function normalizeSha1(value) {
  return String(value || '')
    .replace(/:/g, '')
    .toLowerCase();
}

function getGradleApplicationId() {
  if (!fs.existsSync(gradlePath)) return null;
  const text = fs.readFileSync(gradlePath, 'utf8');
  return text.match(/applicationId\s+['"]([^'"]+)['"]/)?.[1] || null;
}

function getDebugSha1() {
  if (!fs.existsSync(debugKeystorePath)) return null;
  try {
    const output = execFileSync(
      'keytool',
      [
        '-list',
        '-v',
        '-alias',
        'androiddebugkey',
        '-keystore',
        debugKeystorePath,
        '-storepass',
        'android',
        '-keypass',
        'android',
      ],
      { encoding: 'utf8' }
    );
    return output.match(/SHA1:\s*([A-F0-9:]+)/i)?.[1] || null;
  } catch (error) {
    warn('debug keystore SHA-1', `could not run keytool (${error.message})`);
    return null;
  }
}

function main() {
  if (!fs.existsSync(appJsonPath)) fail('app.json', 'missing');
  if (!fs.existsSync(googleServicesPath)) fail('google-services.json', 'missing');
  if (process.exitCode) return;

  const appJson = readJson(appJsonPath);
  const googleServices = readJson(googleServicesPath);
  const env = readEnv(envPath);
  const appPackage = appJson.expo?.android?.package;
  const gradleApplicationId = getGradleApplicationId();
  const client = googleServices.client?.[0];
  const firebasePackage = client?.client_info?.android_client_info?.package_name;
  const firebaseAppId = client?.client_info?.mobilesdk_app_id;
  const oauthClients = client?.oauth_client || [];
  const androidClient = oauthClients.find((item) => item.client_type === 1);
  const webClient = oauthClients.find((item) => item.client_type === 3);
  const debugSha1 = getDebugSha1();
  const firebaseSha1 = androidClient?.android_info?.certificate_hash;

  if (appPackage) ok('app.json android package', appPackage);
  else fail('app.json android package', 'missing expo.android.package');

  if (gradleApplicationId) ok('native applicationId', gradleApplicationId);
  else warn('native applicationId', 'android folder missing or not generated');

  if (firebasePackage === appPackage) ok('Firebase package', firebasePackage);
  else fail('Firebase package', `${firebasePackage || 'missing'} does not match ${appPackage || 'missing'}`);

  if (firebaseAppId === env.EXPO_PUBLIC_FIREBASE_APP_ID) ok('Firebase app id env', 'matches');
  else fail('Firebase app id env', 'EXPO_PUBLIC_FIREBASE_APP_ID does not match google-services.json');

  if (!gradleApplicationId || gradleApplicationId === appPackage) {
    if (gradleApplicationId) ok('Gradle package match', gradleApplicationId);
  } else {
    fail('Gradle package match', `${gradleApplicationId} does not match ${appPackage}`);
  }

  if (androidClient?.client_id) ok('Android OAuth client', 'present');
  else fail('Android OAuth client', 'missing from google-services.json');

  if (webClient?.client_id) ok('Web OAuth client', 'present');
  else fail('Web OAuth client', 'missing from google-services.json');

  if (webClient?.client_id === env.EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID) ok('Web client env', 'matches');
  else fail('Web client env', 'EXPO_PUBLIC_FIREBASE_GOOGLE_WEB_CLIENT_ID does not match google-services.json');

  if (
    !env.EXPO_PUBLIC_FIREBASE_GOOGLE_ANDROID_CLIENT_ID ||
    androidClient?.client_id === env.EXPO_PUBLIC_FIREBASE_GOOGLE_ANDROID_CLIENT_ID
  ) {
    ok('Android client env', env.EXPO_PUBLIC_FIREBASE_GOOGLE_ANDROID_CLIENT_ID ? 'matches' : 'not set');
  } else {
    fail('Android client env', 'EXPO_PUBLIC_FIREBASE_GOOGLE_ANDROID_CLIENT_ID does not match google-services.json');
  }

  if (debugSha1 && firebaseSha1 && normalizeSha1(debugSha1) === normalizeSha1(firebaseSha1)) {
    ok('Debug SHA-1', debugSha1);
  } else if (debugSha1 && firebaseSha1) {
    fail('Debug SHA-1', `${debugSha1} does not match Firebase ${firebaseSha1}`);
  } else if (debugSha1) {
    fail('Firebase SHA-1', `missing Android OAuth certificate for ${debugSha1}`);
  } else {
    warn('Debug SHA-1', 'debug keystore not found; run android:apk first');
  }

  console.log('');
  console.log('If all checks pass but Android still returns DEVELOPER_ERROR:');
  console.log('1. Enable Google in Firebase Authentication > Sign-in method.');
  console.log('2. Re-download google-services.json after Firebase changes.');
  console.log('3. Rebuild and reinstall the APK, then clear app data.');
  console.log('4. For Play Store/Internal App Sharing/EAS release builds, add that signing SHA-1 too.');
}

main();
