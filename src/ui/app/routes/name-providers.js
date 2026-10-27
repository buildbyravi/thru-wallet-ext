// Domain route registration capability policy. Only the deployed `.thru` providers are
// mint routes; canonical roots such as `.id` remain lookup/resolution data.
export function availableThruProviders({ registry, custom } = {}) {
  const providers = [];
  if (custom?.supported && custom.rootMatchesNameService && String(custom.rootName || '').toLowerCase() === 'thru') {
    providers.push('custom');
  }
  if (registry?.supported && registry.registry && String(registry.registry.rootName || '').toLowerCase() === 'thru') {
    providers.push('registry');
  }
  return providers;
}
