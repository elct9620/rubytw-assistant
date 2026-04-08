import { describe, it, expect } from 'vitest'
import { ensurePkcs8 } from '../../src/adapters/github-key'
import { createPrivateKey, generateKeyPairSync } from 'node:crypto'

function generatePkcs1Key(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  return privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
}

function generatePkcs8Key(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
}

describe('ensurePkcs8', () => {
  it('should convert PKCS#1 key to PKCS#8 format', () => {
    const pkcs1Key = generatePkcs1Key()
    expect(pkcs1Key).toContain('-----BEGIN RSA PRIVATE KEY-----')

    const result = ensurePkcs8(pkcs1Key)

    expect(result).toContain('-----BEGIN PRIVATE KEY-----')
    expect(result).not.toContain('-----BEGIN RSA PRIVATE KEY-----')
  })

  it('should pass through PKCS#8 key unchanged', () => {
    const pkcs8Key = generatePkcs8Key()
    expect(pkcs8Key).toContain('-----BEGIN PRIVATE KEY-----')

    const result = ensurePkcs8(pkcs8Key)

    expect(result).toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('should produce a valid private key after conversion', () => {
    const pkcs1Key = generatePkcs1Key()

    const converted = ensurePkcs8(pkcs1Key)

    expect(() => createPrivateKey(converted)).not.toThrow()
  })
})
