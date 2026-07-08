import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { describe, expect, jest, test } from '@jest/globals'
import {
  buildImportUpdatePayload,
  importRecord,
  loadSeedBundle,
  parseArgs,
} from '../scripts/importFrameworkSeed.js'

const execFileAsync = promisify(execFile)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const apiRoot = path.resolve(__dirname, '../..')
const workspaceRoot = path.resolve(apiRoot, '..')
const seedDir = path.resolve(workspaceRoot, 'docs/seed-data')
const importScript = path.resolve(apiRoot, 'src/scripts/importFrameworkSeed.js')

jest.setTimeout(30_000)

const runSeedGuard = (args = []) =>
  execFileAsync(process.execPath, [importScript, '--json', '--no-report', ...args], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    maxBuffer: 1024 * 1024 * 5,
  })

describe('framework seed import guard', () => {
  test('suggests help for unknown script arguments', () => {
    expect(() => parseArgs(['--no-edditor-contract'])).toThrow(/--help/i)
  })

  test.each(['--seed-dir', '--seed-version', '--audit-file', '--report-dir'])(
    'rejects %s when the value is omitted or another flag',
    (flagName) => {
      expect(() => parseArgs([flagName])).toThrow(`${flagName} requires a value`)
      expect(() => parseArgs([flagName, '--apply'])).toThrow(`${flagName} requires a value`)
    },
  )

  test.each([
    ['3.1', seedDir, 'vmf_v3_1_seed_pack_audit.json'],
    ['3.1.1', path.resolve(seedDir, 'vmf-v3-1-1-rkm'), 'seed_pack_audit.json'],
  ])('uses the selected %s seed version to resolve the default audit file', (
    seedVersion,
    selectedSeedDir,
    expectedAuditFile,
  ) => {
    const parsed = parseArgs(['--seed-dir', selectedSeedDir, '--seed-version', seedVersion])

    expect(parsed.seedVersion).toBe(seedVersion)
    expect(path.basename(parsed.auditFile)).toBe(expectedAuditFile)
  })

  test('passes when seeded Framework Package dropdown values are exposed by the editor contract', async () => {
    const { stdout } = await runSeedGuard()
    const payload = JSON.parse(stdout)

    expect(payload.editorOptionContract.status).toBe('pass')
    expect(payload.editorOptionContract.failures).toBe(0)
    expect(payload.auditRegistryContract.status).toBe('pass')
    expect(payload.auditRegistryContract.failures).toBe(0)
    expect(payload.editorOptionContract.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'validationBindings.trigger',
          seededValues: expect.arrayContaining(['ON_VALIDATE']),
          missingFromClient: [],
          missingFromBackend: [],
        }),
        expect.objectContaining({
          field: 'workflowBindings.executionContext',
          seededValues: expect.arrayContaining(['ON_QUERY', 'ON_RENDER', 'ON_SPD_COMPILE']),
          missingFromClient: [],
          missingFromBackend: [],
        }),
        expect.objectContaining({
          field: 'availableOutputKeys',
          seededValues: expect.arrayContaining(['full-report', 'validation-audit']),
          missingFromClient: [],
        }),
      ]),
    )
  })

  test('reports the framework version from the seed package instead of a hardcoded importer value', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-version-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    const packageFile = path.join(tempSeedDir, 'v2_3_1_framework_package.json')
    const frameworkPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    frameworkPackage.version = '2.3.530847'
    fs.writeFileSync(packageFile, `${JSON.stringify(frameworkPackage, null, 2)}\n`, 'utf8')

    const { stdout } = await runSeedGuard(['--seed-dir', tempSeedDir])
    const payload = JSON.parse(stdout)

    expect(payload.version).toBe('2.3.530847')
  })

  test('normalizes workflow step binding keys before Mongoose validation and persistence', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-binding-keys-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    const policyFile = path.join(tempSeedDir, 'v2_3_1_policies.json')
    const policies = JSON.parse(fs.readFileSync(policyFile, 'utf8'))
    policies.workflowPolicies[0].key = 'qa-binding-key-policy'
    policies.workflowPolicies[0].stableId = 'workflow-policy-qa-binding-key-policy'
    policies.workflowPolicies[0].steps = [{
      stepKey: 'validate_required.truth',
      type: 'VALIDATION',
      order: 1,
      validationKeys: ['required.truth_key', 'REQUIRED_TRUTH_KEY'],
      requiredValidationKeys: ['required-truth-key'],
    }]
    fs.writeFileSync(policyFile, `${JSON.stringify(policies, null, 2)}\n`, 'utf8')

    const bundle = loadSeedBundle(tempSeedDir, '2.3.1')
    const workflowPolicyStep = bundle
      .find((entry) => entry.label === 'Workflow Policies')
      .records[0]
      .steps[0]
    const workflowPolicyRecord = bundle
      .find((entry) => entry.label === 'Workflow Policies')
      .records[0]

    expect(workflowPolicyRecord.stableId).toBe('policy-qa-binding-key-policy')
    expect(workflowPolicyStep.stepKey).toBe('validate-required-truth')
    expect(workflowPolicyStep.bindingKeys).toEqual(['required-truth-key'])
  })

  test('passes the VMF v3.1 seed pack when selected', async () => {
    const { stdout } = await runSeedGuard(['--seed-version', '3.1', '--seed-dir', seedDir])
    const payload = JSON.parse(stdout)

    expect(payload.version).toBe('3.1')
    expect(payload.summary.mode).toBe('dry-run')
    expect(payload.audit.actual).toEqual(
      expect.objectContaining({
        runtimePathCount: 223,
        skillRoleCount: 18,
        skillCount: 25,
        validationCount: 44,
        agentCount: 11,
        policyCount: 19,
        skillReferenceAssetCount: 150,
        uiSectionCount: 19,
        supportAssetCount: 176,
        packageDependencyReferenceCount: 532,
        vmfStateNamespaceReferences: 0,
      }),
    )
    expect(payload.editorOptionContract.status).toBe('pass')
    expect(payload.auditRegistryContract.status).toBe('pass')
  })

  test('hydrates RuntimeSkill reference assets from the staged v3.1 RKM support asset manifest', async () => {
    const rkmSeedDir = path.resolve(seedDir, 'vmf-v3-1-rkm')
    const { stdout } = await runSeedGuard([
      '--seed-version',
      '3.1',
      '--seed-dir',
      rkmSeedDir,
    ])
    const payload = JSON.parse(stdout)

    expect(payload.version).toBe('3.1')
    expect(payload.summary.mode).toBe('dry-run')
    expect(payload.audit.actual).toEqual(
      expect.objectContaining({
        runtimePathCount: 283,
        skillCount: 36,
        skillReferenceAssetCount: 216,
        supportAssetCount: 265,
        packageDependencyReferenceCount: 401,
      }),
    )
    expect(payload.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          source: 'Support Asset Manifest',
          message: expect.stringContaining('Hydrated 216 RuntimeSkill referenceAssets'),
        }),
      ]),
    )
    expect(payload.notes.filter((note) => note.level === 'error')).toEqual([])
  })

  test('staged v3.1 RKM seed includes the governed Discovery evidence pack write path', () => {
    const rkmSeedDir = path.resolve(seedDir, 'vmf-v3-1-rkm')
    const runtimePaths = JSON.parse(
      fs.readFileSync(path.join(rkmSeedDir, 'vmf_v3_1_runtime_paths.json'), 'utf8'),
    )
    const frameworkPackage = JSON.parse(
      fs.readFileSync(path.join(rkmSeedDir, 'vmf_v3_1_framework_package.json'), 'utf8'),
    )

    const evidencePackPath = runtimePaths.runtimePathRegistries.find(
      (entry) => entry.pathKey === 'framework_state.evidence_pack',
    )
    expect(evidencePackPath).toEqual(expect.objectContaining({
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      scope: 'FRAMEWORK_STATE',
      dataType: 'OBJECT',
      category: 'STATE',
      sourceType: 'RUNTIME_STATE',
      isProtected: false,
      isSystem: true,
    }))
    expect(evidencePackPath.allowedOperations).toEqual(['READ', 'WRITE'])

    expect(frameworkPackage.dependencyLock.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collectionKey: 'RuntimePathRegistry',
          key: 'framework_state.evidence_pack',
          status: 'ACTIVE',
          issues: [],
        }),
      ]),
    )
  })

  test('passes the staged VMF v3.1.1 RKM seed pack when selected', async () => {
    const rkmSeedDir = path.resolve(seedDir, 'vmf-v3-1-1-rkm')
    const { stdout } = await runSeedGuard([
      '--seed-version',
      '3.1.1',
      '--seed-dir',
      rkmSeedDir,
    ])
    const payload = JSON.parse(stdout)

    expect(payload.version).toBe('3.1.1')
    expect(payload.summary.mode).toBe('dry-run')
    expect(payload.audit.actual).toEqual(
      expect.objectContaining({
        runtimePathCount: 283,
        skillRoleCount: 20,
        skillCount: 36,
        validationCount: 26,
        agentCount: 14,
        policyCount: 21,
        skillReferenceAssetCount: 278,
        uiSectionCount: 6,
        supportAssetCount: 278,
        packageDependencyReferenceCount: 401,
      }),
    )
    expect(payload.editorOptionContract.status).toBe('pass')
    expect(payload.auditRegistryContract.status).toBe('pass')
    expect(payload.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          source: 'Support Asset Manifest',
          message: expect.stringContaining('Hydrated 278 RuntimeSkill referenceAssets'),
        }),
        expect.objectContaining({
          level: 'info',
          source: 'Conformance Audit',
          message: expect.stringContaining('compatibility audit has PASS status'),
        }),
      ]),
    )
    expect(payload.notes.filter((note) => note.level === 'error')).toEqual([])
  })

  test('staged v3.1.1 RKM seed includes the governed Discovery evidence pack write path', () => {
    const rkmSeedDir = path.resolve(seedDir, 'vmf-v3-1-1-rkm')
    const runtimePaths = JSON.parse(
      fs.readFileSync(path.join(rkmSeedDir, '02_seed_data/runtime_path_registry.json'), 'utf8'),
    )
    const frameworkPackage = JSON.parse(
      fs.readFileSync(path.join(rkmSeedDir, '02_seed_data/framework_package.json'), 'utf8'),
    )

    const evidencePackPath = runtimePaths.runtimePathRegistries.find(
      (entry) => entry.pathKey === 'framework_state.evidence_pack',
    )
    expect(evidencePackPath).toEqual(expect.objectContaining({
      status: 'ACTIVE',
      frameworkKeys: ['VMF'],
      scope: 'FRAMEWORK_STATE',
      dataType: 'OBJECT',
      category: 'STATE',
      sourceType: 'RUNTIME_STATE',
      introducedInVersion: '3.1.1',
      isProtected: false,
      isSystem: true,
    }))
    expect(evidencePackPath.allowedOperations).toEqual(['READ', 'WRITE'])

    expect(frameworkPackage.dependencyLock.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collectionKey: 'RuntimePathRegistry',
          key: 'framework_state.evidence_pack',
          status: 'ACTIVE',
          issues: [],
        }),
      ]),
    )
  })

  test('staged v3.1.1 R3 action alignment preserves executable workspace action bridge', () => {
    const r3SeedDataDir = path.resolve(seedDir, 'vmf-v3-1-1-rkm-r3-action-alignment/02_seed_data')
    const uiContract = JSON.parse(fs.readFileSync(path.join(r3SeedDataDir, 'ui_contract.json'), 'utf8'))
    const workflowPolicies = JSON.parse(fs.readFileSync(path.join(r3SeedDataDir, 'workflow_policies.json'), 'utf8'))
    const frameworkPackage = JSON.parse(fs.readFileSync(path.join(r3SeedDataDir, 'framework_package.json'), 'utf8'))

    expect(uiContract.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actionKey: 'GENERATE_TRUTH',
        governedAction: 'GENERATE_TRUTH',
        presentationKey: 'primary-action',
      }),
      expect.objectContaining({
        actionKey: 'GENERATE_SECTION',
        governedAction: 'GENERATE_SECTION',
        presentationKey: 'section-action',
      }),
      expect.objectContaining({
        actionKey: 'REGENERATE_SECTION',
        governedAction: 'REGENERATE_SECTION',
        presentationKey: 'section-action',
      }),
      expect.objectContaining({
        actionKey: 'MARK_READY',
        governedAction: 'MARK_READY',
        presentationKey: 'primary-action',
      }),
      expect.objectContaining({
        actionKey: 'APPROVE',
        governedAction: 'APPROVE',
        presentationKey: 'primary-action',
      }),
      expect.objectContaining({
        actionKey: 'LOCK_RECORD',
        governedAction: 'LOCK_RECORD',
        presentationKey: 'primary-action',
      }),
    ]))

    expect(workflowPolicies.workflowPolicies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'truth-generation-policy',
        governedAction: 'GENERATE_TRUTH',
      }),
      expect.objectContaining({
        key: 'generate-section-gate',
        governedAction: 'GENERATE_SECTION',
        decisionMode: 'ALLOW',
      }),
      expect.objectContaining({
        key: 'regenerate-section-gate',
        governedAction: 'REGENERATE_SECTION',
        decisionMode: 'ALLOW',
      }),
      expect.objectContaining({
        key: 'mark-ready-policy',
        governedAction: 'MARK_READY',
        decisionMode: 'ALLOW',
      }),
      expect.objectContaining({
        key: 'lifecycle-approval-policy',
        governedAction: 'APPROVE',
        decisionMode: 'REQUIRE_AGENT_AND_SKILL_EXECUTION',
        executionType: 'ORDERED_WORKFLOW',
      }),
      expect.objectContaining({
        key: 'lock-record-policy',
        governedAction: 'LOCK_RECORD',
        decisionMode: 'ALLOW',
      }),
    ]))

    expect(frameworkPackage.workflowBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        policyKey: 'truth-generation-policy',
        executionContext: 'ON_GENERATE_TRUTH',
      }),
      expect.objectContaining({
        policyKey: 'generate-section-gate',
        executionContext: 'ON_SECTION_GENERATE',
      }),
      expect.objectContaining({
        policyKey: 'regenerate-section-gate',
        executionContext: 'ON_SECTION_REGENERATE',
      }),
      expect.objectContaining({
        policyKey: 'mark-ready-policy',
        executionContext: 'ON_MARK_READY',
      }),
      expect.objectContaining({
        policyKey: 'lifecycle-approval-policy',
        executionContext: 'ON_APPROVE',
      }),
      expect.objectContaining({
        policyKey: 'lock-record-policy',
        executionContext: 'ON_LOCK',
      }),
    ]))
  })

  test('passes RKM compatibility values used by the v3.1 runtime knowledge model seed', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-rkm-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    const readSeed = (fileName) =>
      JSON.parse(fs.readFileSync(path.join(tempSeedDir, fileName), 'utf8'))
    const writeSeed = (fileName, payload) => {
      fs.writeFileSync(path.join(tempSeedDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    }

    const runtimePaths = readSeed('vmf_v3_1_runtime_paths.json')
    const pathCategoriesToTest = ['ADVISOR', 'GOVERNANCE', 'KNOWLEDGE_PACK', 'OWNERSHIP']
    pathCategoriesToTest.forEach((category, index) => {
      if (index < runtimePaths.runtimePathRegistries.length) {
        runtimePaths.runtimePathRegistries[index].category = category
      }
    })
    writeSeed('vmf_v3_1_runtime_paths.json', runtimePaths)

    const skills = readSeed('vmf_v3_1_runtime_skills.json')
    const skillCategoriesToTest = ['TRUTH', 'EVIDENCE', 'RECOMMENDATION', 'OUTCOME', 'KNOWLEDGE_PACK', 'ADVISOR', 'CONSUMPTION']
    skillCategoriesToTest.forEach((category, index) => {
      if (index < skills.runtimeSkills.length) {
        skills.runtimeSkills[index].category = category
      }
    })
    writeSeed('vmf_v3_1_runtime_skills.json', skills)

    const policies = readSeed('vmf_v3_1_workflow_policies.json')
    const policyTemplate = policies.workflowPolicies[0]
    const rkmPolicies = [
      'SAVE_DISCOVERY',
      'GENERATE_TRUTH',
      'ESCALATE_CONTRADICTION',
      'SAVE_ECONOMIC_MODEL',
      'SAVE_COMMERCIAL_MODEL',
      'REVIEW_DECISION',
      'REVIEW_RECOMMENDATION',
      'PREPARE_OUTPUT',
      'PREPARE_ADVISOR',
      'PREPARE_OUTCOME',
      'HANDOFF_DOWNSTREAM',
      'VALIDATE_BOUNDARY',
      'CLASSIFY_APPENDICES',
      'BUILD_KNOWLEDGE_PACKS',
      'VALIDATE_MUTATION',
      'NOTIFY',
      'PREPARE_CONSUMPTION',
    ]
    const rkmPolicyMap = new Map()
    policies.workflowPolicies.push(
      ...rkmPolicies.map((governedAction, index) => {
        const policyKey = `rkm-compat-policy-${index + 1}`
        const policy = {
          ...policyTemplate,
          _id: { $oid: `000000000000000000${String(index + 1000).padStart(6, '0')}` },
          key: policyKey,
          stableId: `policy-${policyKey}`,
          lineageId: `policy-${policyKey}`,
          name: `RKM Compat Policy ${index + 1}`,
          policyType: 'RUNTIME_KNOWLEDGE_POLICY',
          governedAction,
          decisionMode: 'ALLOW',
          severity: 'INFO',
          requiredValidationKeys: [],
          onPassEffects: [],
          onFailEffects: [],
          requiredAgentIds: [],
          gatingRules: [],
        }
        rkmPolicyMap.set(governedAction, policyKey)
        return policy
      }),
    )
    writeSeed('vmf_v3_1_workflow_policies.json', policies)

    const frameworkPackage = readSeed('vmf_v3_1_framework_package.json')
    const rkmBindings = [
      { executionContext: 'ON_DISCOVERY_SAVE', governedAction: 'SAVE_DISCOVERY' },
      { executionContext: 'ON_GENERATE_TRUTH', governedAction: 'GENERATE_TRUTH' },
      { executionContext: 'ON_CONTRADICTION_FOUND', governedAction: 'ESCALATE_CONTRADICTION' },
      { executionContext: 'ON_ECONOMIC_MODEL_SAVE', governedAction: 'SAVE_ECONOMIC_MODEL' },
      { executionContext: 'ON_COMMERCIAL_MODEL_SAVE', governedAction: 'SAVE_COMMERCIAL_MODEL' },
      { executionContext: 'ON_DECISION_REVIEW', governedAction: 'REVIEW_DECISION' },
      { executionContext: 'ON_RECOMMENDATION_GENERATED', governedAction: 'REVIEW_RECOMMENDATION' },
      { executionContext: 'ON_OUTPUT_REQUEST', governedAction: 'PREPARE_OUTPUT' },
      { executionContext: 'ON_ADVISOR_REQUEST', governedAction: 'PREPARE_ADVISOR' },
      { executionContext: 'ON_OUTCOME_REQUEST', governedAction: 'PREPARE_OUTCOME' },
      { executionContext: 'ON_HANDOFF', governedAction: 'HANDOFF_DOWNSTREAM' },
      { executionContext: 'ON_PACKAGE_BUILD', governedAction: 'BUILD_KNOWLEDGE_PACKS' },
      { executionContext: 'ON_MUTATION', governedAction: 'VALIDATE_MUTATION' },
      { executionContext: 'ON_CONSUMPTION_REQUEST', governedAction: 'PREPARE_CONSUMPTION' },
    ]
    frameworkPackage.executionModel = {
      ...(frameworkPackage.executionModel || {}),
      stateModel: 'RUNTIME_KNOWLEDGE_MODEL',
    }
    frameworkPackage.workflowBindings = [
      ...(frameworkPackage.workflowBindings || []),
      ...rkmBindings.map((binding, index) => ({
        policyKey: rkmPolicyMap.get(binding.governedAction),
        executionContext: binding.executionContext,
        governedAction: binding.governedAction,
        priority: 700 + index,
      })),
    ]
    frameworkPackage.availableOutputKeys = [
      ...(frameworkPackage.availableOutputKeys || []),
      'executive-value-brief',
      'discovery-truth-summary',
      'economic-rationale',
      'decision-readiness-brief',
      'outcome-studio-brief',
      'commercial-clarity-brief',
    ]
    frameworkPackage.defaultOutputStyles = ['executive-runtime-brief']
    writeSeed('vmf_v3_1_framework_package.json', frameworkPackage)

    const agents = readSeed('vmf_v3_1_runtime_agents.json')
    const supportAssets = readSeed('vmf_v3_1_support_asset_manifest.json')
    fs.writeFileSync(path.join(tempSeedDir, 'support_assets/rkm-agent-asset.md'), 'agent asset\n', 'utf8')
    fs.writeFileSync(path.join(tempSeedDir, 'support_assets/rkm-policy-asset.md'), 'policy asset\n', 'utf8')
    if (agents.runtimeAgents && agents.runtimeAgents.length > 0) {
      supportAssets.assets.push({
        assetKey: 'rkm-agent-asset',
        fileName: 'support_assets/rkm-agent-asset.md',
        assetType: 'POLICY_GUIDANCE',
        targetType: 'RuntimeAgent',
        targetKey: agents.runtimeAgents[0].key,
        visible: false,
        editable: false,
        publishable: false,
        navigable: false,
        searchable: true,
        advisorAccessible: true,
        skillAccessible: true,
        runtimeAccessible: true,
        status: 'ACTIVE',
      })
    }
    const firstRkmPolicyKey = rkmPolicyMap.values().next().value
    if (firstRkmPolicyKey) {
      supportAssets.assets.push({
        assetKey: 'rkm-policy-asset',
        fileName: 'support_assets/rkm-policy-asset.md',
        assetType: 'POLICY_GUIDANCE',
        targetType: 'WorkflowPolicy',
        targetKey: firstRkmPolicyKey,
        visible: false,
        editable: false,
        publishable: false,
        navigable: false,
        searchable: true,
        advisorAccessible: true,
        skillAccessible: true,
        runtimeAccessible: true,
        status: 'ACTIVE',
      })
    }
    writeSeed('vmf_v3_1_support_asset_manifest.json', supportAssets)

    const { stdout } = await runSeedGuard([
      '--seed-version',
      '3.1',
      '--seed-dir',
      tempSeedDir,
      '--no-audit',
    ])
    const payload = JSON.parse(stdout)

    expect(payload.summary.mode).toBe('dry-run')
    expect(payload.editorOptionContract.status).toBe('pass')
    expect(payload.auditRegistryContract.status).toBe('pass')
    expect(payload.notes.filter((note) => note.level === 'error')).toEqual([])
    const checksByField = new Map(
      payload.editorOptionContract.checks.map((check) => [check.field, check]),
    )
    expect(checksByField.get('executionModel.stateModel')).toEqual(expect.objectContaining({
      seededValues: expect.arrayContaining(['RUNTIME_KNOWLEDGE_MODEL']),
      missingFromClient: [],
      missingFromBackend: [],
    }))
    expect(checksByField.get('workflowBindings.executionContext')).toEqual(expect.objectContaining({
      seededValues: expect.arrayContaining(['ON_DISCOVERY_SAVE', 'ON_ADVISOR_REQUEST', 'ON_OUTCOME_REQUEST']),
      missingFromClient: [],
      missingFromBackend: [],
    }))
    expect(checksByField.get('availableOutputKeys')).toEqual(expect.objectContaining({
      seededValues: expect.arrayContaining(['executive-value-brief', 'commercial-clarity-brief']),
      missingFromClient: [],
    }))
    expect(checksByField.get('defaultOutputStyles')).toEqual(expect.objectContaining({
      seededValues: expect.arrayContaining(['executive-runtime-brief']),
      missingFromClient: [],
    }))
  })

  test('blocks audit-shaped seed data that references an unregistered audit action', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-audit-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    fs.writeFileSync(
      path.join(tempSeedDir, 'audit_seed_test.json'),
      `${JSON.stringify({
        actorUserId: '507f1f77bcf86cd799439011',
        action: 'FUTURE_AUDIT_EVENT',
        resourceType: 'FrameworkPackage',
        resourceId: '807f1f77bcf86cd799439044',
        requestId: 'req-seed-audit-contract',
      }, null, 2)}\n`,
      'utf8',
    )

    await expect(runSeedGuard(['--seed-dir', tempSeedDir, '--no-audit'])).rejects.toMatchObject({
      stdout: expect.stringContaining('FUTURE_AUDIT_EVENT'),
    })
  })

  test('blocks generated seed data that contains an output key missing from the editor options', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'framework-seed-contract-'))
    const tempSeedDir = path.join(tempRoot, 'seed-data')
    fs.cpSync(seedDir, tempSeedDir, { recursive: true })

    const packageFile = path.join(tempSeedDir, 'v2_3_1_framework_package.json')
    const frameworkPackage = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    frameworkPackage.availableOutputKeys = [
      ...(Array.isArray(frameworkPackage.availableOutputKeys) ? frameworkPackage.availableOutputKeys : []),
      'future-output-pack',
    ]
    fs.writeFileSync(packageFile, `${JSON.stringify(frameworkPackage, null, 2)}\n`, 'utf8')

    await expect(runSeedGuard(['--seed-dir', tempSeedDir, '--no-audit'])).rejects.toMatchObject({
      stdout: expect.stringContaining('future-output-pack'),
    })
  })

  test('preserves managed fields when updating existing records', async () => {
    const updatePayload = buildImportUpdatePayload({
      key: 'standard-package-2-3-1',
      name: 'Standard Package',
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockedReason: null,
      dependencyLock: null,
      lastCheckpointResult: null,
      status: 'DRAFT',
      assignedCustomerIds: [],
      updatedBy: '000000000000000000000001',
    })

    expect(updatePayload).toEqual({
      key: 'standard-package-2-3-1',
      name: 'Standard Package',
    })
  })

  test('updates existing seed rows through the safe payload only', async () => {
    const existing = {
      $locals: {},
      set: jest.fn(function set(payload) {
        this.payload = payload
      }),
      isModified: jest.fn(() => true),
      save: jest.fn(),
    }
    class FakeModel {
      static findOne = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(existing),
      }))
      constructor(record) {
        this.record = record
      }
    }

    const status = await importRecord(
      {
        label: 'Framework Packages',
        model: FakeModel,
        identityFields: ['key'],
      },
      {
        key: 'standard-package-2-3-1',
        name: 'Updated Package',
        status: 'DRAFT',
        lockedReason: null,
        lastCheckpointResult: null,
        updatedBy: '000000000000000000000001',
      },
    )

    expect(status).toBe('updated')
    expect(existing.set).toHaveBeenCalledWith({
      key: 'standard-package-2-3-1',
      name: 'Updated Package',
    })
    expect(existing.save).toHaveBeenCalled()
  })

  test('skips locked existing Runtime Control rows during side-by-side seed import', async () => {
    const existing = {
      isLocked: true,
      set: jest.fn(),
      isModified: jest.fn(),
      save: jest.fn(),
    }
    class FakeModel {
      static findOne = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(existing),
      }))
      constructor(record) {
        this.record = record
      }
    }

    const status = await importRecord(
      {
        label: 'Runtime Paths',
        model: FakeModel,
        identityFields: ['pathKey'],
      },
      {
        pathKey: 'framework_state.sections.customer_context',
        category: 'CUSTOMER_KNOWLEDGE',
        sourceType: 'CUSTOMER_RUNTIME_STATE',
      },
    )

    expect(status).toBe('skipped')
    expect(existing.set).not.toHaveBeenCalled()
    expect(existing.isModified).not.toHaveBeenCalled()
    expect(existing.save).not.toHaveBeenCalled()
  })

  test('creates missing seed rows', async () => {
    const saved = jest.fn()
    class FakeModel {
      static findOne = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(null),
      }))
      constructor(record) {
        this.record = record
        this.save = saved
      }
    }

    const status = await importRecord(
      {
        label: 'Runtime Paths',
        model: FakeModel,
        identityFields: ['pathKey'],
      },
      {
        pathKey: 'framework_state.sections.executive_summary',
      },
    )

    expect(status).toBe('created')
    expect(saved).toHaveBeenCalled()
  })
})
