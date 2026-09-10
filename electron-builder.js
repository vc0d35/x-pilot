const { existsSync } = require('node:fs');
const { join } = require('node:path');

// A macOS development/Developer ID profile granting keychain-access-groups (see docs/passkeys.md).
// It is git-ignored, so a fresh clone builds without it and passkeys stay off in that build.
const provisioningProfile = join(__dirname, 'build', 'embedded.provisionprofile');
const hasProvisioningProfile = existsSync(provisioningProfile);

// Notarization needs credentials. Without them electron-builder must not try, or the build fails.
const env = process.env;
const canNotarize = Boolean(env.APPLE_KEYCHAIN_PROFILE || (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID));

// Baked into the packaged app so a shipped build derives its keychain group from the identity it
// was signed with, never from the environment it happens to run in (see resolveKeychainGroup).
const teamId = (env.XPILOT_TEAM_ID ?? '').trim();

module.exports = {
  appId: 'com.vicnicius.xpilot',
  productName: 'XPilot',
  // The fuses are flipped right before signing. enableCookieEncryption is a one-way transition:
  // once a profile's cookies are written encrypted, a build with the fuse off cannot read them.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // Off: the sidebar renderer is served from the app's own xpilot:// scheme (see hardening.ts),
    // so nothing in the app needs file: to carry more privileges than Chromium's default.
    grantFileProtocolExtraPrivileges: false,
    // Flipping fuses invalidates the ad-hoc signature an unsigned local build carries.
    resetAdHocDarwinSignature: true,
  },
  // Injected into the bundled package.json so app.getName() is XPilot and the packaged app
  // uses its own profile folder instead of sharing (and single-instance-locking) the dev one.
  extraMetadata: { productName: 'XPilot', ...(teamId ? { xpilotTeamId: teamId } : {}) },
  directories: { buildResources: 'build', output: 'dist' },
  // The Claude Agent SDK ships a bundled Claude Code binary per platform as optional dependencies.
  // XPilot drives the user's own `claude`, so those ~50 MB of binaries are left out of the app.
  // three.js is the custom views' library shelf (xpilot://lib/...). Only the three files the shelf
  // serves are shipped: the package is ~22 MB and the rest of it is never read.
  files: [
    'out/**',
    'package.json',
    '!node_modules/@anthropic-ai/claude-agent-sdk-*/**',
    '!node_modules/three/**',
    'node_modules/three/package.json',
    'node_modules/three/LICENSE',
    'node_modules/three/build/three.module.js',
    'node_modules/three/build/three.core.js',
    // electron-builder's node_modules walker prunes an `examples` directory before any include
    // pattern is applied, so the one addon the shelf serves is copied in as its own file set.
    { from: 'node_modules/three/examples/jsm/controls', to: 'node_modules/three/examples/jsm/controls', filter: ['OrbitControls.js'] },
  ],
  artifactName: '${productName}-${version}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.social-networking',
    icon: 'build/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    notarize: canNotarize,
    ...(hasProvisioningProfile ? { provisioningProfile: 'build/embedded.provisionprofile' } : {}),
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  },
  dmg: {
    window: { width: 540, height: 380 },
    iconSize: 100,
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' },
    ],
  },
  publish: { provider: 'github', owner: 'vc0d35', repo: 'x-pilot', releaseType: 'draft' },
};
