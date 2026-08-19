import { useViewportLockStore } from '../stores/useViewportLockStore';
import type { ViewportLockOptionId } from '../stores/useViewportLockStore';

export const VIEWPORT_LOCK_OPTIONS: ReadonlyArray<{
  id: ViewportLockOptionId;
  label: string;
  group: 'zoomPan' | 'windowLevel';
}> = [
  {
    id: 'zoomPanCurrentSeries',
    label: 'Zoom/Pan — current series',
    group: 'zoomPan',
  },
  {
    id: 'zoomPanAllSeries',
    label: 'Zoom/Pan — all series',
    group: 'zoomPan',
  },
  {
    id: 'windowLevelCurrentSeries',
    label: 'Window Level — current series',
    group: 'windowLevel',
  },
  {
    id: 'windowLevelAllSeries',
    label: 'Window Level — all series',
    group: 'windowLevel',
  },
];

type SyncType = 'zoompan' | 'voi';

type ViewportRef = {
  viewportId: string;
  renderingEngineId: string;
  seriesInstanceUID: string;
};

type GridViewport = {
  displaySetInstanceUIDs?: string[];
  viewportOptions?: {
    viewportId?: string;
    viewportType?: string;
  };
};

type ViewportLockServices = {
  syncGroupService: {
    addViewportToSyncGroup: (
      viewportId: string,
      renderingEngineId: string,
      syncGroup: {
        type: SyncType;
        id: string;
        source: boolean;
        target: boolean;
      }
    ) => void;
    removeViewportFromSyncGroup: (
      viewportId: string,
      renderingEngineId: string,
      syncGroupId: string
    ) => void;
    getSynchronizer: (id: string) =>
      | {
          id: string;
          getSourceViewports: () => Array<{ viewportId: string; renderingEngineId: string }>;
        }
      | void;
    getSynchronizersOfType: (
      type: string
    ) => Array<{ id: string; getSourceViewports: () => Array<{ viewportId: string; renderingEngineId: string }> }> | undefined;
  };
  viewportGridService: {
    getState: () => { viewports: Map<string, GridViewport> };
    EVENTS: {
      GRID_STATE_CHANGED: string;
      VIEWPORTS_READY: string;
    };
    subscribe: (eventName: string, callback: () => void) => { unsubscribe: () => void };
  };
  displaySetService: {
    getDisplaySetByUID: (uid: string) => { SeriesInstanceUID?: string } | undefined;
  };
  cornerstoneViewportService: {
    getCornerstoneViewport: (viewportId: string) =>
      | { id: string; getRenderingEngine: () => { id: string } }
      | undefined;
    EVENTS?: { VIEWPORT_DATA_CHANGED: string };
    subscribe?: (eventName: string, callback: () => void) => { unsubscribe: () => void };
  };
};

type ViewportLockServicesManager = {
  services: ViewportLockServices;
};

const UNSUPPORTED_VIEWPORT_TYPES = new Set(['video', 'volume3d', 'wholeSlide']);

const ALL_SYNC_IDS: Record<SyncType, string> = {
  zoompan: 'xnat-lock-zoompan-all',
  voi: 'xnat-lock-voi-all',
};

const SERIES_SYNC_PREFIX: Record<SyncType, string> = {
  zoompan: 'xnat-lock-zoompan-series-',
  voi: 'xnat-lock-voi-series-',
};

type Unsubscribe = { unsubscribe: () => void };

const subscriptions: Unsubscribe[] = [];
let reapplyTimer: ReturnType<typeof setTimeout> | undefined;

export function applyViewportLocks(servicesManager: ViewportLockServicesManager): void {
  if (!servicesManager?.services?.syncGroupService) {
    return;
  }

  const enabled = useViewportLockStore.getState().enabled;

  applyLockType(
    servicesManager.services,
    'zoompan',
    enabled.zoomPanAllSeries,
    enabled.zoomPanCurrentSeries
  );
  applyLockType(
    servicesManager.services,
    'voi',
    enabled.windowLevelAllSeries,
    enabled.windowLevelCurrentSeries
  );
}

export function bindViewportLockListeners(servicesManager: ViewportLockServicesManager): void {
  unbindViewportLockListeners();

  const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
  const scheduleReapply = () => {
    if (!useViewportLockStore.getState().hasAnyEnabled()) {
      return;
    }
    if (reapplyTimer) {
      clearTimeout(reapplyTimer);
    }
    reapplyTimer = setTimeout(() => {
      reapplyTimer = undefined;
      applyViewportLocks(servicesManager);
    }, 50);
  };

  subscriptions.push(
    viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, scheduleReapply),
    viewportGridService.subscribe(viewportGridService.EVENTS.VIEWPORTS_READY, scheduleReapply)
  );

  if (cornerstoneViewportService?.EVENTS?.VIEWPORT_DATA_CHANGED && cornerstoneViewportService.subscribe) {
    subscriptions.push(
      cornerstoneViewportService.subscribe(
        cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
        scheduleReapply
      )
    );
  }
}

export function unbindViewportLockListeners(servicesManager?: ViewportLockServicesManager): void {
  if (reapplyTimer) {
    clearTimeout(reapplyTimer);
    reapplyTimer = undefined;
  }

  while (subscriptions.length) {
    subscriptions.pop()?.unsubscribe();
  }

  useViewportLockStore.getState().clear();

  if (servicesManager) {
    applyViewportLocks(servicesManager);
  }
}

function applyLockType(
  services: ViewportLockServices,
  type: SyncType,
  allSeriesEnabled: boolean,
  currentSeriesEnabled: boolean
): void {
  const eligible = getEligibleViewportRefs(services);

  if (allSeriesEnabled) {
    setGroupMembers(services, type, ALL_SYNC_IDS[type], eligible);
  } else {
    clearGroup(services, ALL_SYNC_IDS[type]);
  }

  const seriesPrefix = SERIES_SYNC_PREFIX[type];

  // All-series already covers every viewport; skip per-series groups to avoid
  // putting a viewport in two synchronizers of the same type.
  if (currentSeriesEnabled && !allSeriesEnabled) {
    const bySeries = groupViewportRefsBySeries(eligible);
    const desiredIds = new Set<string>();

    for (const [seriesInstanceUID, refs] of bySeries) {
      const syncId = `${seriesPrefix}${seriesInstanceUID}`;
      desiredIds.add(syncId);
      setGroupMembers(services, type, syncId, refs);
    }

    clearManagedSeriesGroupsExcept(services, type, seriesPrefix, desiredIds);
    return;
  }

  clearManagedSeriesGroupsExcept(services, type, seriesPrefix, new Set());
}

function getEligibleViewportRefs(services: ViewportLockServices): ViewportRef[] {
  const { viewportGridService, displaySetService, cornerstoneViewportService } = services;
  const { viewports } = viewportGridService.getState();
  const refs: ViewportRef[] = [];

  for (const gridViewport of viewports.values()) {
    const viewportType = gridViewport.viewportOptions?.viewportType;
    if (viewportType && UNSUPPORTED_VIEWPORT_TYPES.has(viewportType)) {
      continue;
    }

    const displaySetInstanceUID = gridViewport.displaySetInstanceUIDs?.[0];
    if (!displaySetInstanceUID) {
      continue;
    }

    const viewportId = gridViewport.viewportOptions?.viewportId;
    if (!viewportId) {
      continue;
    }

    const csViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const renderingEngineId = csViewport?.getRenderingEngine()?.id;
    if (!csViewport || !renderingEngineId) {
      continue;
    }

    const seriesInstanceUID = displaySetService.getDisplaySetByUID(displaySetInstanceUID)
      ?.SeriesInstanceUID;
    if (!seriesInstanceUID) {
      continue;
    }

    refs.push({
      viewportId,
      renderingEngineId,
      seriesInstanceUID,
    });
  }

  return refs;
}

function groupViewportRefsBySeries(refs: ViewportRef[]): Map<string, ViewportRef[]> {
  const bySeries = new Map<string, ViewportRef[]>();

  for (const ref of refs) {
    const existing = bySeries.get(ref.seriesInstanceUID);
    if (existing) {
      existing.push(ref);
    } else {
      bySeries.set(ref.seriesInstanceUID, [ref]);
    }
  }

  return bySeries;
}

function setGroupMembers(
  services: ViewportLockServices,
  type: SyncType,
  syncId: string,
  desired: ViewportRef[]
): void {
  const current = getGroupMembers(services, syncId);
  const currentIds = new Set(current.map(member => member.viewportId));
  const desiredIds = new Set(desired.map(member => member.viewportId));

  for (const member of current) {
    if (!desiredIds.has(member.viewportId)) {
      services.syncGroupService.removeViewportFromSyncGroup(
        member.viewportId,
        member.renderingEngineId,
        syncId
      );
    }
  }

  for (const member of desired) {
    if (currentIds.has(member.viewportId)) {
      continue;
    }
    services.syncGroupService.addViewportToSyncGroup(member.viewportId, member.renderingEngineId, {
      type,
      id: syncId,
      source: true,
      target: true,
    });
  }
}

function getGroupMembers(
  services: ViewportLockServices,
  syncId: string
): Array<{ viewportId: string; renderingEngineId: string }> {
  const synchronizer = services.syncGroupService.getSynchronizer(syncId);
  if (!synchronizer) {
    return [];
  }
  return synchronizer.getSourceViewports();
}

function clearGroup(services: ViewportLockServices, syncId: string): void {
  const members = getGroupMembers(services, syncId);
  for (const member of members) {
    services.syncGroupService.removeViewportFromSyncGroup(
      member.viewportId,
      member.renderingEngineId,
      syncId
    );
  }
}

function clearManagedSeriesGroupsExcept(
  services: ViewportLockServices,
  type: SyncType,
  seriesPrefix: string,
  keepIds: Set<string>
): void {
  const synchronizers = services.syncGroupService.getSynchronizersOfType(type) ?? [];

  for (const synchronizer of synchronizers) {
    if (!synchronizer.id.startsWith(seriesPrefix) || keepIds.has(synchronizer.id)) {
      continue;
    }
    clearGroup(services, synchronizer.id);
  }
}
