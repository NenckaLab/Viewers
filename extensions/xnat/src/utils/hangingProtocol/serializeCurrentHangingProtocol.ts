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

function pickViewportOptions(viewportOptions: Record<string, any> = {}) {
  const picked: Record<string, any> = {
    viewportType: viewportOptions.viewportType || 'stack',
    toolGroupId: viewportOptions.toolGroupId || 'default',
  };

  if (viewportOptions.orientation) {
    picked.orientation = viewportOptions.orientation;
  }

  if (viewportOptions.initialImageOptions) {
    picked.initialImageOptions = viewportOptions.initialImageOptions;
  }

  if (Array.isArray(viewportOptions.syncGroups) && viewportOptions.syncGroups.length) {
    picked.syncGroups = viewportOptions.syncGroups;
  }

  return picked;
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
  const { viewportGridService, displaySetService } = servicesManager.services;
  const gridState = viewportGridService.getState();
  const { layout, viewports } = gridState;
  const { numRows, numCols, layoutOptions } = layout;

  const viewportStructureProperties: Record<string, any> = {
    rows: numRows,
    columns: numCols,
  };

  if (Array.isArray(layoutOptions) && layoutOptions.length) {
    viewportStructureProperties.layoutOptions = layoutOptions;
  }

  const displaySetSelectors: Record<string, any> = {};
  const stageViewports: Array<Record<string, any>> = [];
  let selectorIndex = 0;

  const viewportEntries = Array.from(viewports.entries()).sort((a, b) => {
    const aPosition = a[1]?.viewportOptions?.positionId ?? a[0];
    const bPosition = b[1]?.viewportOptions?.positionId ?? b[0];
    return String(aPosition).localeCompare(String(bPosition));
  });

  for (const [, viewport] of viewportEntries) {
    const {
      viewportOptions = {},
      displaySetInstanceUIDs = [],
      displaySetOptions = [],
    } = viewport;

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
      viewportOptions: pickViewportOptions(viewportOptions),
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
