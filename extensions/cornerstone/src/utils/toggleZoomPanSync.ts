import { ViewportGridService } from '@ohif/core';

const ZOOM_PAN_SYNC_NAME = 'mpr-zoompan';

export default function toggleZoomPanSync({
  servicesManager,
  viewports: providedViewports,
  syncId,
}: withAppTypes) {
  const { syncGroupService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;

  syncId ||= ZOOM_PAN_SYNC_NAME;

  const viewports = providedViewports || getNonEmptyViewports(viewportGridService);

  const someViewportHasSync = viewports.some(viewport => {
    const syncStates = syncGroupService.getSynchronizersForViewport(
      viewport.viewportOptions.viewportId
    );

    return !!syncStates.find(syncState => syncState.id === syncId);
  });

  if (someViewportHasSync) {
    return disableSync(syncId, servicesManager);
  }

  // create synchronization group and add the viewports to it.
  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
      type: 'zoompan',
      id: syncId,
      source: true,
      target: true,
    });
  });
}

function disableSync(syncName, servicesManager: AppTypes.ServicesManager) {
  const { syncGroupService, viewportGridService, cornerstoneViewportService } =
    servicesManager.services;
  const viewports = getNonEmptyViewports(viewportGridService);
  viewports.forEach(gridViewport => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport) {
      return;
    }
    syncGroupService.removeViewportFromSyncGroup(
      viewport.id,
      viewport.getRenderingEngine().id,
      syncName
    );
  });
}

/**
 * Returns all grid viewports that have a display set loaded; zoom/pan sync
 * has no reconstructability requirement, unlike image slice sync.
 */
function getNonEmptyViewports(viewportGridService: ViewportGridService) {
  const { viewports } = viewportGridService.getState();

  return [...viewports.values()].filter(
    viewport => viewport.displaySetInstanceUIDs && viewport.displaySetInstanceUIDs.length
  );
}
