const upper = (value) => String(value || '').trim().toUpperCase()

export const isSelectableResolverPack = (pack = {}) => (
  upper(pack.status || pack.lifecycleStatus) === 'ACTIVE'
  && pack.runtimeBindable !== false
)

export default {
  isSelectableResolverPack,
}
