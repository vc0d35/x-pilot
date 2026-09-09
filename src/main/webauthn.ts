/**
 * Electron does not service platform-authenticator (Touch ID) requests until `app.configureWebAuthn`
 * is called, and the credentials it creates need a keychain access group that the app's
 * `keychain-access-groups` code-signing entitlement also grants. See docs/passkeys.md.
 */
export const BUNDLE_ID = 'com.vicnicius.xpilot';

/**
 * A packaged app takes its keychain group from the identity it was built and signed with (the team
 * id baked into its own package.json), never from the environment it happens to be launched in:
 * the group is attacker-influenced input to a Keychain API otherwise. The environment switches stay
 * available in development, where there is no bundle to read the team id from.
 */
export function resolveKeychainGroup(
  env: Record<string, string | undefined>,
  platform: string,
  opts: { packaged?: boolean; bundleTeamId?: string | null } = {},
): string | null {
  if (platform !== 'darwin') return null;
  if (opts.packaged) return opts.bundleTeamId ? `${opts.bundleTeamId}.${BUNDLE_ID}.webauthn` : null;
  const explicit = env.XPILOT_KEYCHAIN_GROUP?.trim();
  if (explicit) return explicit;
  const team = env.XPILOT_TEAM_ID?.trim();
  return team ? `${team}.${BUNDLE_ID}.webauthn` : null;
}

interface WebAuthnApp {
  configureWebAuthn(options: { touchID: { keychainAccessGroup: string; promptReason?: string } }): void;
}
interface WebAuthnAccount {
  name?: string;
  displayName?: string;
  credentialId: string;
}
type SelectAccountListener = (
  event: unknown,
  details: { accounts: WebAuthnAccount[] },
  callback: (credentialId?: string | null) => void,
) => void;

export function configureTouchIdPasskeys(deps: {
  app: WebAuthnApp;
  onSelectAccount: (listener: SelectAccountListener) => void;
  group: string | null;
  log?: (msg: string) => void;
}): boolean {
  const log = deps.log ?? ((m) => console.log(m));
  if (!deps.group) {
    log('[xpilot] passkeys disabled: set XPILOT_TEAM_ID (see docs/passkeys.md) to enable Touch ID passkeys');
    return false;
  }
  deps.app.configureWebAuthn({ touchID: { keychainAccessGroup: deps.group, promptReason: 'sign in to $1' } });
  // With several matching credentials (e.g. two X accounts registered in-app), pick the
  // first one Electron lists; a chooser in the sidebar can replace this later.
  deps.onSelectAccount((_event, details, callback) => {
    const chosen = details.accounts[0];
    if (details.accounts.length > 1)
      log(
        `[xpilot] passkeys: ${details.accounts.length} accounts match; using "${chosen.name ?? chosen.displayName ?? chosen.credentialId}"`,
      );
    callback(chosen?.credentialId);
  });
  log(`[xpilot] passkeys enabled with keychain group ${deps.group}`);
  return true;
}
