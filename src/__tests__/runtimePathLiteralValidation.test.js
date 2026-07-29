import { describe, expect, test } from '@jest/globals'
import {
  RUNTIME_PATH_LITERAL_VALIDATION_MODES,
  isWorkflowPolicyValueMissing,
  validateRuntimePathLiteralValue,
} from '../utils/runtimePathLiteralValidation.js'

const validate = (runtimePath, value, options = {}) =>
  validateRuntimePathLiteralValue({
    runtimePath,
    value,
    ...options,
  })

describe('runtime path literal validation', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['blank text', '  '],
    ['empty array', []],
  ])('treats %s as a missing required Workflow Policy value', (_label, value) => {
    expect(isWorkflowPolicyValueMissing(value)).toBe(true)
  })

  test.each([
    ['false', false],
    ['zero', 0],
    ['text', 'READY'],
    ['object', {}],
    ['non-empty array', ['READY']],
  ])('treats %s as a present Workflow Policy value', (_label, value) => {
    expect(isWorkflowPolicyValueMissing(value)).toBe(false)
  })

  test.each([
    ['STRING accepts policy-qualified markers', { dataType: 'STRING' }, 'truth-generation-policy:COMPLETED'],
    ['NUMBER accepts native values', { dataType: 'NUMBER' }, 42],
    ['NUMBER accepts serialized values', { dataType: 'NUMBER' }, '42.5'],
    ['BOOLEAN accepts native values', { dataType: 'BOOLEAN' }, true],
    ['BOOLEAN accepts serialized values', { dataType: 'BOOLEAN' }, 'FALSE'],
    ['OBJECT accepts native values', { dataType: 'OBJECT' }, { status: 'READY' }],
    ['OBJECT accepts serialized values', { dataType: 'OBJECT' }, '{"status":"READY"}'],
    ['ARRAY accepts native values', { dataType: 'ARRAY' }, ['READY']],
    ['ARRAY accepts serialized values', { dataType: 'ARRAY' }, '["READY"]'],
    ['ENUM accepts an allowed string', { dataType: 'ENUM', allowedValues: ['READY'] }, 'READY'],
    ['MIXED JSON accepts serialized JSON', { dataType: 'MIXED', uiControl: 'JSON' }, '{"status":"READY"}'],
    ['MIXED text accepts a string', { dataType: 'MIXED', uiControl: 'TEXT' }, 'READY'],
  ])('%s', (_label, runtimePath, value) => {
    expect(validate(runtimePath, value)).toBeNull()
  })

  test.each([
    ['STRING rejects non-strings', { dataType: 'STRING' }, 42, 'Expected a string value.'],
    ['NUMBER rejects non-numeric strings', { dataType: 'NUMBER' }, 'forty-two', 'Expected a numeric value.'],
    ['BOOLEAN rejects non-boolean strings', { dataType: 'BOOLEAN' }, 'READY', 'Expected a boolean value.'],
    ['OBJECT rejects arrays', { dataType: 'OBJECT' }, [], 'Expected a JSON object.'],
    ['OBJECT rejects invalid serialized JSON', { dataType: 'OBJECT' }, '{bad}', 'Expected valid JSON.'],
    ['ARRAY rejects objects', { dataType: 'ARRAY' }, {}, 'Expected a JSON array.'],
    ['ARRAY rejects invalid serialized JSON', { dataType: 'ARRAY' }, '[bad]', 'Expected valid JSON.'],
    [
      'ENUM rejects a disallowed string',
      { dataType: 'ENUM', allowedValues: ['READY'] },
      'BLOCKED',
      'Value must be one of the allowed values for this runtime path.',
    ],
    [
      'MIXED JSON rejects invalid serialized JSON',
      { dataType: 'MIXED', uiControl: 'JSON' },
      '{bad}',
      'Expected valid JSON.',
    ],
    ['MIXED text rejects non-strings', { dataType: 'MIXED', uiControl: 'TEXT' }, 42, 'Expected a string value.'],
  ])('%s', (_label, runtimePath, value, expected) => {
    expect(validate(runtimePath, value)).toBe(expected)
  })

  test('enforces nullability only when isNullable is false', () => {
    expect(validate({ dataType: 'STRING', isNullable: false }, null))
      .toBe('Null is not allowed for this runtime path.')
    expect(validate({ dataType: 'STRING', isNullable: true }, null)).toBeNull()
    expect(validate({ dataType: 'STRING' }, null)).toBeNull()
  })

  test('preserves operator-aware IN and NOT_IN validation', () => {
    const runtimePath = { dataType: 'ENUM', allowedValues: ['READY', 'BLOCKED'] }

    expect(validate(runtimePath, 'READY, BLOCKED', { operator: 'IN' })).toBeNull()
    expect(validate(runtimePath, 'READY, UNKNOWN', { operator: 'NOT_IN' }))
      .toBe('Value must be one of the allowed values for this runtime path.')
  })

  test('type-and-nullability mode skips business constraints but retains representation checks', () => {
    const options = {
      validationMode: RUNTIME_PATH_LITERAL_VALIDATION_MODES.TYPE_AND_NULLABILITY,
    }

    expect(validate({
      dataType: 'STRING',
      allowedValues: ['READY'],
      minLength: 10,
      maxLength: 12,
      regexPattern: '^READY$',
    }, 'ACCEPTED', options)).toBeNull()
    expect(validate({ dataType: 'NUMBER', minValue: 10, maxValue: 20 }, 5, options)).toBeNull()
    expect(validate({ dataType: 'STRING' }, ['READY'], {
      ...options,
      allowListValues: false,
    })).toBe('Expected a string value.')
    expect(validate({ dataType: 'ARRAY' }, {}, options)).toBe('Expected a JSON array.')
    expect(validate({ dataType: 'STRING', isNullable: false }, null, options))
      .toBe('Null is not allowed for this runtime path.')
  })

  test.each([
    ['STRING', { dataType: 'STRING' }, ['READY'], 'Expected a string value.'],
    ['ENUM', { dataType: 'ENUM' }, ['READY'], 'Expected a string value.'],
    ['NUMBER', { dataType: 'NUMBER' }, [42], 'Expected a numeric value.'],
    ['BOOLEAN', { dataType: 'BOOLEAN' }, [true], 'Expected a boolean value.'],
    ['MIXED text', { dataType: 'MIXED', uiControl: 'TEXT' }, ['READY'], 'Expected a string value.'],
  ])('rejects top-level arrays for scalar %s paths when list values are disabled', (
    _label,
    runtimePath,
    value,
    expected,
  ) => {
    expect(validate(runtimePath, value, {
      validationMode: RUNTIME_PATH_LITERAL_VALIDATION_MODES.TYPE_AND_NULLABILITY,
      allowListValues: false,
    })).toBe(expected)
  })

  test.each([
    ['ARRAY', { dataType: 'ARRAY' }, ['READY']],
    ['MIXED JSON', { dataType: 'MIXED', uiControl: 'JSON' }, ['READY']],
  ])('retains native arrays for whole-literal %s paths when list values are disabled', (
    _label,
    runtimePath,
    value,
  ) => {
    expect(validate(runtimePath, value, {
      validationMode: RUNTIME_PATH_LITERAL_VALIDATION_MODES.TYPE_AND_NULLABILITY,
      allowListValues: false,
    })).toBeNull()
  })
})
