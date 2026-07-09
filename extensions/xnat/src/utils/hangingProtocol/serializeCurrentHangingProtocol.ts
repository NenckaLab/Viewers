type DisplaySetLike = {
  SeriesNumber?: number | string;
  Modality?: string;
  SeriesDescription?: string;
  instances?: Array<Record<string, any>>;
  [key: string]: any;
};

function buildSeriesMatchingRules(displaySet: DisplaySetLike) {
  const rules: Array<Record<string, any>> = [];
  const firstInstance = displaySet.instances?.[0] || displaySet;
  const seriesNumber = displaySet.SeriesNumber ?? firstInstance.SeriesNumber;
  const modality = displaySet.Modality ?? firstInstance.Modality;
  const seriesDescription = displaySet.SeriesDescription ?? firstInstance.SeriesDescription;

  if (seriesNumber != null && seriesNumber !== '') {
    rules.push({
      weight: 100,
      attribute: 'SeriesNumber',
      constraint: { equals: { value: Number(seriesNumber) } },
      required: false,
    });
  }

  if (modality) {
    rules.push({
      weight: 50,
      attribute: 'Modality',
      constraint: { equals: { value: modality } },
      required: false,
    });
  }

  if (seriesDescription) {
    rules.push({
      weight: 75,
      attribute: 'SeriesDescription',
      constraint: { equals: { value: seriesDescription } },
      required: false,
    });
  }

  if (!rules.length) {
    rules.push({
      weight: 1,
      attribute: 'numImageFrames',
      constraint: { greaterThan: { value: 0 } },
      required: false,
    });
  }

  return rules;
}

function sanitizeProtocolId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug ? `user.${slug}` : `user.layout-${Date.now()}`;
}

function pickViewportOptions(viewportOptions: Record<string, any> = {}, positionId?: string) {
  const picked: Record<string, any> = {
    viewportType: viewportOptions.viewportType || 'stack',
    toolGroupId: viewportOptions.toolGroupId || 'default',
  };

  if (positionId) {
    picked.positionId = positionId;
  }

  if (viewportOptions.orientation) {
    picked.orientation = viewportOptions.orientation;
  }

  if (viewportOptions.initialImageOptions) {
    picked.initialImageOptions = viewportOptions.initialImageOptions;
  }

  if (viewportOptions.displayArea) {
    picked.displayArea = viewportOptions.displayArea;
  }

  if (Array.isArray(viewportOptions.syncGroups) && viewportOptions.syncGroups.length) {
    picked.syncGroups = viewportOptions.syncGroups;
  }

  return picked;
}

function mapViewportTypeForHangingProtocol(viewportType: unknown): string | undefined {
  if (viewportType == null) {
    return undefined;
  }

  const normalized = String(viewportType).toLowerCase();

  if (normalized === 'orthographic' || normalized === 'volume') {
    return 'volume';
  }

  if (normalized === 'volume3d') {
    return 'volume3d';
  }

  if (normalized === 'stack') {
    return 'stack';
  }

  return normalized;
}

function resolveLiveViewportOptions(
  viewportId: string,
  viewportOptions: Record<string, any> = {},
  cornerstoneViewportService?: {
    getViewportInfo?: (id: string) => {
      getOrientation?: () => string;
      getViewportType?: () => string;
      getViewportOptions?: () => Record<string, any>;
    };
  }
): Record<string, any> {
  const resolved = { ...viewportOptions };
  const viewportInfo = cornerstoneViewportService?.getViewportInfo?.(viewportId);

  if (!viewportInfo) {
    return resolved;
  }

  const liveOptions = viewportInfo.getViewportOptions?.() ?? {};
  const orientation = viewportInfo.getOrientation?.();

  if (orientation) {
    resolved.orientation = orientation;
  }

  const viewportType = mapViewportTypeForHangingProtocol(
    liveOptions.viewportType ?? viewportInfo.getViewportType?.()
  );

  if (viewportType) {
    resolved.viewportType = viewportType;
  }

  if (liveOptions.toolGroupId) {
    resolved.toolGroupId = liveOptions.toolGroupId;
  }

  if (liveOptions.initialImageOptions) {
    resolved.initialImageOptions = liveOptions.initialImageOptions;
  }

  if (liveOptions.displayArea) {
    resolved.displayArea = liveOptions.displayArea;
  }

  if (Array.isArray(liveOptions.syncGroups) && liveOptions.syncGroups.length) {
    resolved.syncGroups = liveOptions.syncGroups;
  }

  return resolved;
}

function getViewportGridPosition(
  viewport: Record<string, any> | undefined,
  viewportId: string
): { row: number; col: number } {
  const positionId = viewport?.positionId ?? viewport?.viewportOptions?.positionId;
  if (typeof positionId === 'string') {
    const match = positionId.match(/^(\d+)-(\d+)$/);
    if (match) {
      return {
        col: Number(match[1]),
        row: Number(match[2]),
      };
    }
  }

  if (typeof viewport?.y === 'number' && typeof viewport?.x === 'number') {
    return {
      row: viewport.y,
      col: viewport.x,
    };
  }

  const trailingIndex = Number(String(viewportId).match(/(\d+)$/)?.[1]);
  return {
    row: 0,
    col: Number.isFinite(trailingIndex) ? trailingIndex : Number.MAX_SAFE_INTEGER,
  };
}

function buildLayoutOptions(
  numRows: number,
  numCols: number,
  existingLayoutOptions?: Array<Record<string, any>>
) {
  if (Array.isArray(existingLayoutOptions) && existingLayoutOptions.length) {
    return existingLayoutOptions.map((option, index) => {
      const col = index % numCols;
      const row = Math.floor(index / numCols);
      return {
        ...option,
        positionId: option?.positionId || `${col}-${row}`,
      };
    });
  }

  const generatedLayoutOptions: Array<Record<string, any>> = [];
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      generatedLayoutOptions.push({
        x: col / numCols,
        y: row / numRows,
        width: 1 / numCols,
        height: 1 / numRows,
        positionId: `${col}-${row}`,
      });
    }
  }

  return generatedLayoutOptions;
}

export function serializeCurrentHangingProtocol(
  servicesManager: any,
  {
    name,
    protocolId,
  }: {
    name: string;
    protocolId?: string;
  }
): Record<string, any> {
  const { viewportGridService, displaySetService, cornerstoneViewportService } =
    servicesManager.services;
  const gridState = viewportGridService.getState();
  const { layout, viewports } = gridState;
  const { numRows, numCols, layoutOptions } = layout;

  const viewportStructureProperties: Record<string, any> = {
    rows: numRows,
    columns: numCols,
    layoutOptions: buildLayoutOptions(numRows, numCols, layoutOptions),
  };

  const displaySetSelectors: Record<string, any> = {};
  const stageViewports: Array<Record<string, any>> = [];
  let selectorIndex = 0;

  const viewportEntries = Array.from(viewports.entries()).sort((a, b) => {
    const aPosition = getViewportGridPosition(a[1], a[0]);
    const bPosition = getViewportGridPosition(b[1], b[0]);

    if (aPosition.row !== bPosition.row) {
      return aPosition.row - bPosition.row;
    }

    return aPosition.col - bPosition.col;
  });

  for (const [viewportId, viewport] of viewportEntries) {
    const {
      viewportOptions = {},
      displaySetInstanceUIDs = [],
    } = viewport;
    const positionId = viewport.positionId ?? viewportOptions.positionId;
    const resolvedViewportOptions = resolveLiveViewportOptions(
      viewportId,
      viewportOptions,
      cornerstoneViewportService
    );

    const displaySetsForViewport: Array<{ id: string }> = [];

    for (let i = 0; i < displaySetInstanceUIDs.length; i++) {
      const displaySetUID = displaySetInstanceUIDs[i];
      if (!displaySetUID) {
        continue;
      }

      const displaySet = displaySetService.getDisplaySetByUID(displaySetUID);
      if (!displaySet) {
        continue;
      }

      const selectorId = `displaySet${selectorIndex++}`;
      displaySetSelectors[selectorId] = {
        seriesMatchingRules: buildSeriesMatchingRules(displaySet),
      };

      displaySetsForViewport.push({ id: selectorId });
    }

    if (!displaySetsForViewport.length) {
      if (!displaySetSelectors.activeDisplaySet) {
        displaySetSelectors.activeDisplaySet = {
          seriesMatchingRules: [
            {
              weight: 1,
              attribute: 'numImageFrames',
              constraint: { greaterThan: { value: 0 } },
              required: false,
            },
          ],
        };
      }
      displaySetsForViewport.push({ id: 'activeDisplaySet' });
    }

    stageViewports.push({
      viewportOptions: pickViewportOptions(resolvedViewportOptions, positionId),
      displaySets: displaySetsForViewport,
    });
  }

  const resolvedProtocolId = protocolId || sanitizeProtocolId(name);
  const resolvedName = name.trim() || resolvedProtocolId;

  if (!displaySetSelectors.activeDisplaySet) {
    displaySetSelectors.activeDisplaySet = {
      seriesMatchingRules: [
        {
          weight: 1,
          attribute: 'numImageFrames',
          constraint: { greaterThan: { value: 0 } },
          required: false,
        },
      ],
    };
  }

  return {
    id: resolvedProtocolId,
    name: resolvedName,
    locked: false,
    isPreset: true,
    numberOfPriorsReferenced: 0,
    protocolMatchingRules: [
      {
        weight: 0.01,
        attribute: 'StudyInstanceUID',
        constraint: { contains: '' },
        required: false,
      },
    ],
    defaultViewport: {
      viewportOptions: {
        viewportType: 'stack',
        toolGroupId: 'default',
      },
      displaySets: [{ id: 'activeDisplaySet' }],
    },
    displaySetSelectors,
    stages: [
      {
        id: 'stage-1',
        name: resolvedName,
        viewportStructure: {
          layoutType: 'grid',
          properties: viewportStructureProperties,
        },
        viewports: stageViewports,
      },
    ],
  };
}
