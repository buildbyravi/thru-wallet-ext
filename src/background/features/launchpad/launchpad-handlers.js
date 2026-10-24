// Launchpad router registrations (M0). Thin seam: maps contract methods to the feature
// service. Same quarantine note as dex: the legacy marketing-page launchpad was deleted, not
// flagged off; this backend exists only as the reviewed M0 contract drop and answers
// unsupported/disabled everywhere in this build.

import * as launchpadService from './launchpad-service.js';

export const launchpadHandlers = Object.freeze({
  'launchpad.list': ({ networkId, sort, cursor, limit } = {}) => launchpadService.listLaunches({ networkId, sort, cursor, limit }),
  'launchpad.get': ({ launchId } = {}) => launchpadService.getLaunch({ launchId }),
  'launchpad.templates': () => launchpadService.listTemplates(),
  'launchpad.listMine': ({ address } = {}) => launchpadService.listMyLaunches({ address }),
  'launchpad.validateDraft': ({ networkId, draft } = {}) => launchpadService.validateDraft({ networkId, draft }),

  'launchpad.draftList': () => launchpadService.draftList(),
  'launchpad.draftGet': ({ draftId } = {}) => launchpadService.draftGet({ draftId }),
  'launchpad.draftSave': ({ draftId, draft } = {}) => launchpadService.draftSave({ draftId, draft }),
  'launchpad.draftDelete': ({ draftId } = {}) => launchpadService.draftDelete({ draftId }),

  'launchpad.uploadImage': ({ address, networkId, payload } = {}) => launchpadService.uploadImage({ address, networkId, payload }),
  'launchpad.prepareCreate': ({ address, networkId, draft, clientRequestId } = {}) => launchpadService.prepareCreate({ address, networkId, draft, clientRequestId }),
  'launchpad.prepareMigrate': ({ address, launchId, clientRequestId } = {}) => launchpadService.prepareMigrate({ address, launchId, clientRequestId }),
  'launchpad.prepareClaim': ({ address, launchId, clientRequestId } = {}) => launchpadService.prepareClaim({ address, launchId, clientRequestId }),
});
