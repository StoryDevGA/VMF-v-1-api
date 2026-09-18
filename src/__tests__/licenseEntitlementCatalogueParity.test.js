import { describe, expect, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KNOWN_LICENSE_ENTITLEMENTS } from '../constants/licenseEntitlements.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const clientConstantsPath = resolve(
  currentDirectory,
  '../../../VMF-v-1-client/src/pages/SuperAdminLicenseLevels/superAdminLicenseLevels.constants.js',
)

test('client and API licence entitlement catalogues stay in parity', () => {
  const clientSource = readFileSync(clientConstantsPath, 'utf8')
  const match = clientSource.match(/LICENSE_ENTITLEMENT_KEYS\s*=\s*\[([^\]]*)\]/)
  const clientKeys = match?.[1]
    ?.split(',')
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  expect(clientKeys.sort()).toEqual([...KNOWN_LICENSE_ENTITLEMENTS].sort())
})
