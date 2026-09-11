import { expect, test } from '@jest/globals'
import { buildRendererSections } from '../services/runtimeRendererService.js'

// Local projection proof: both configurations use the same renderer entry point.
// This does not establish licence provisioning, live runtime creation or browser QA.
test.each([
  { frameworkKey: 'VMF', fields: [
    { key: 'context', label: 'Customer context', dataType: 'STRING', value: 'A customer narrative', control: 'TEXT', order: 20 },
    { key: 'priority', label: 'Priority', dataType: 'NUMBER', value: 3, control: 'NUMBER', order: 10 },
  ] },
  { frameworkKey: 'WEBSITE_ANALYSIS', fields: [
    { key: 'website_url', label: 'Website URL', dataType: 'STRING', value: 'https://example.com', control: 'TEXT', order: 10 },
    { key: 'analysis_mode', label: 'Analysis mode', dataType: 'ENUM', value: 'SUMMARY', control: 'SELECT', order: 30, allowedValues: ['SUMMARY', 'FULL'] },
    { key: 'include_links', label: 'Include links', dataType: 'BOOLEAN', value: true, control: 'CHECKBOX', order: 20 },
  ] },
])('shared renderer projects $frameworkKey declared inputs, labels, controls and order', ({ frameworkKey, fields }) => {
  const pathFor = (key) => `framework_state.sections.${key}`
  const frameworkState = { lifecycle: { stage: 'DRAFT' }, sections: Object.fromEntries(fields.map((field) => [field.key, { input: field.value }])) }
  const warnings = []
  const result = buildRendererSections({
    frameworkPackage: { frameworkKey, packageKey: frameworkKey.toLowerCase(), version: '1.0.0',
      sections: fields.map((field) => ({ sectionKey: field.key, runtimePath: pathFor(field.key), required: true })) },
    frameworkState, runtimeInstance: { status: 'ACTIVE', executionStatus: 'IDLE', framework_state: frameworkState },
    discovery: { accepted: true }, mutationAccess: { allowed: true }, configWarnings: warnings,
    uiContract: { sections: fields.map((field) => ({ sectionKey: field.key, runtimePath: pathFor(field.key),
      label: field.label, displayOrder: field.order, isVisible: true })) },
    runtimePathRecords: new Map(fields.map((field) => [pathFor(field.key), {
      allowedOperations: ['READ', 'WRITE'], dataType: field.dataType, allowedValues: field.allowedValues || [],
    }])),
  })
  expect(warnings).toEqual([])
  expect(result.map((row) => ({ key: row.sectionKey, label: row.label, control: row.control,
    value: row.value, editable: row.editable, required: row.required, allowedValues: row.allowedValues })))
    .toEqual([...fields].sort((a, b) => a.order - b.order).map((field) => ({ key: field.key,
      label: field.label, control: field.control, value: field.value, editable: true, required: true,
      allowedValues: field.allowedValues || [] })))
})
