import { createPrivateKey } from 'node:crypto'

/**
 * Ensure a GitHub App private key is in PKCS#8 PEM format. GitHub issues
 * keys in PKCS#1 ("BEGIN RSA PRIVATE KEY"), but @octokit/auth-app's
 * Workers-compatible crypto path only accepts PKCS#8. Keys that are
 * already PKCS#8 are returned unchanged.
 */
export function ensurePkcs8(privateKey: string): string {
  if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    return privateKey
  }

  return createPrivateKey(privateKey).export({
    type: 'pkcs8',
    format: 'pem',
  }) as string
}
