export const strictOptionalBoolean = (value, fallback, name) => {
  if (value === undefined) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid boolean configuration: ${name}`)
}

export const resolveDevelopmentStartupPolicy = (config) => {
  const quiet = config.developmentStartupTasksEnabled === false
  const controlled = config.controlledDocxReadEnabled === true
  const selectedProfiles = [config.controlledDocxReadCorrectionEnabled, config.controlledDocxReadApprovedEnabled,
    config.controlledDocxReadNarrowEnabled].filter(value => value === true).length
  if (selectedProfiles > 0 && !controlled) {
    throw new Error('Corrected document reads require the controlled development reader.')
  }
  if (selectedProfiles > 1) {
    throw new Error('Only one controlled document profile may be selected.')
  }
  if ((quiet || controlled) && (!['development', 'test'].includes(config.nodeEnv)
    || config.appEnv !== 'development')) {
    throw new Error('Development-only document configuration is unavailable in this environment.')
  }
  return {
    quiet,
    autoIndex: quiet ? false : !config.isProduction,
    runSeeds: !quiet && config.nodeEnv === 'development',
    startMaintenance: !quiet,
  }
}
