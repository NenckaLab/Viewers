import React, { useEffect, useCallback, useRef } from 'react';
import { Types, MeasurementService } from '@ohif/core';
import { ViewportGrid, ViewportPane } from '@ohif/ui-next';
import { useViewportGrid } from '@ohif/ui-next';
import EmptyViewport from './EmptyViewport';
import { useAppConfig } from '@state';

function ViewerViewportGrid(props: withAppTypes) {
  const { servicesManager, viewportComponents = [], dataSource, commandsManager } = props;
  const [viewportGrid, viewportGridService] = useViewportGrid();
  const [appConfig] = useAppConfig();

  const { layout, activeViewportId, viewports, isHangingProtocolLayout } = viewportGrid;
  const { numCols, numRows } = layout;
  const layoutHash = useRef(null);

  const {
    displaySetService,
    measurementService,
    hangingProtocolService,
    uiNotificationService,
    customizationService,
  } = servicesManager.services;

  const generateLayoutHash = () => `${numCols}-${numRows}`;

  /**
   * This callback runs after the viewports structure has changed in any way.
   * On initial display, that means if it has changed by applying a HangingProtocol,
   * while subsequently it may mean by changing the stage or by manually adjusting
   * the layout.

   */
  const updateDisplaySetsFromProtocol = (
    protocol: Types.HangingProtocol.Protocol,
    stage,
    activeStudyUID,
    viewportMatchDetails
  ) => {
    const availableDisplaySets = displaySetService.getActiveDisplaySets();

    if (!availableDisplaySets.length) {
      console.log('No available display sets', availableDisplaySets);
      return;
    }

    // Match each viewport individually
    const { layoutType } = stage.viewportStructure;
    const stageProps = stage.viewportStructure.properties;
    const { columns: numCols, rows: numRows, layoutOptions = [] } = stageProps;

    /**
     * This find or create viewport uses the hanging protocol results to
     * specify the viewport match details, which specifies the size and
     * setup of the various viewports.
     */
    const findOrCreateViewport = pos => {
      const viewportId = Array.from(viewportMatchDetails.keys())[pos];
      const details = viewportMatchDetails.get(viewportId);
      if (!details) {
        console.log('No match details for viewport', viewportId);
        return;
      }

      const { displaySetsInfo, viewportOptions } = details;
      const displaySetUIDsToHang = [];
      const displaySetUIDsToHangOptions = [];

      displaySetsInfo.forEach(({ displaySetInstanceUID, displaySetOptions }) => {
        if (displaySetInstanceUID) {
          displaySetUIDsToHang.push(displaySetInstanceUID);
        }

        displaySetUIDsToHangOptions.push(displaySetOptions);
      });

      const computedViewportOptions = hangingProtocolService.getComputedOptions(
        viewportOptions,
        displaySetUIDsToHang
      );

      const computedDisplaySetOptions = hangingProtocolService.getComputedOptions(
        displaySetUIDsToHangOptions,
        displaySetUIDsToHang
      );

      return {
        displaySetInstanceUIDs: displaySetUIDsToHang,
        displaySetOptions: computedDisplaySetOptions,
        viewportOptions: computedViewportOptions,
      };
    };

    viewportGridService.setLayout({
      numRows,
      numCols,
      layoutType,
      layoutOptions,
      findOrCreateViewport,
      isHangingProtocolLayout: true,
    });
  };

  const _getUpdatedViewports = useCallback(
    (viewportId, displaySetInstanceUID) => {
      if (!displaySetInstanceUID) {
        return [];
      }

      let updatedViewports = [];
      try {
        updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
          viewportId,
          displaySetInstanceUID,
          isHangingProtocolLayout
        );
      } catch (error) {
        console.warn(error);
        uiNotificationService.show({
          title: 'Drag and Drop',
          message:
            'The selected display sets could not be added to the viewport due to a mismatch in the Hanging Protocol rules.',
          type: 'error',
          duration: 3000,
        });
      }

      return updatedViewports;
    },
    [hangingProtocolService, uiNotificationService, isHangingProtocolLayout]
  );

  // Using Hanging protocol engine to match the displaySets
  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      ({ protocol, stage, activeStudyUID, viewportMatchDetails }) => {
        updateDisplaySetsFromProtocol(protocol, stage, activeStudyUID, viewportMatchDetails);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Check viewport readiness in useEffect
  useEffect(() => {
    const allReady = viewportGridService.getGridViewportsReady();
    const sameLayoutHash = layoutHash.current === generateLayoutHash();
    if (allReady && !sameLayoutHash) {
      layoutHash.current = generateLayoutHash();
      viewportGridService.publishViewportsReady();
    }
  }, [viewportGridService, generateLayoutHash]);

  useEffect(() => {
    const { unsubscribe } = measurementService.subscribe(
      MeasurementService.EVENTS.JUMP_TO_MEASUREMENT_LAYOUT,
      event => {
        const { viewportId, measurement, isConsumed } = event;
        if (isConsumed) {
          return;
        }

        const { displaySetInstanceUID: referencedDisplaySetInstanceUID } = measurement;
        const { viewports } = viewportGridService.getState();

        // Check if any viewport can display this measurement
        let canAnyViewportDisplayMeasurement = false;

        viewports.forEach((viewport, id) => {
          const displaySetInstanceUIDs = viewport.displaySetInstanceUIDs || [];
          const viewportHasDisplaySet = displaySetInstanceUIDs.includes(
            referencedDisplaySetInstanceUID
          );

          // Extract metadata and prepare reference
          const { FrameOfReferenceUID, ...metadataRest } = measurement.metadata;
          const reference = {
            ...(viewportHasDisplaySet ? measurement.metadata : metadataRest),
            displaySetInstanceUID: referencedDisplaySetInstanceUID,
          };

          // Check if viewport can display the reference
          if (
            viewport.isReferenceViewable?.({
              viewportId: id,
              reference,
            })
          ) {
            canAnyViewportDisplayMeasurement = true;
          }
        });

        if (canAnyViewportDisplayMeasurement) {
          // Let the viewports handle the jump
          return;
        }

        // Need to change layouts since no viewport consumed the event
        const updatedViewports = _getUpdatedViewports(viewportId, referencedDisplaySetInstanceUID);

        if (!updatedViewports?.[0]) {
          console.warn(
            'ViewportGrid::Unable to navigate to viewport containing',
            referencedDisplaySetInstanceUID
          );
          return;
        }

        // Find the viewport that can display the measurement
        const viewport = updatedViewports.find(viewport => {
          const gridViewport = viewportGridService.getViewportState(viewport.viewportId);
          return gridViewport.isReferenceViewable?.({
            viewportId: viewport.viewportId,
            reference: {
              ...measurement.metadata,
              displaySetInstanceUID: referencedDisplaySetInstanceUID,
            },
            viewportOptions: gridViewport.viewportOptions || {},
          });
        });

        if (!viewport) {
          console.warn('No suitable viewport found for displaying measurement');
          return;
        }

        // Update stored position presentation
        commandsManager.run('updateStoredPositionPresentation', {
          viewportId: viewport.viewportId,
          displaySetInstanceUIDs: [referencedDisplaySetInstanceUID],
          referencedImageId: measurement.referencedImageId,
          options: {
            ...measurement.metadata,
          },
        });

        event.consume();

        commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: updatedViewports });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [viewports, _getUpdatedViewports]);

  const onDropHandler = (viewportId, { displaySetInstanceUID }) => {
    const { viewportGridService } = servicesManager.services;
    const customOnDropHandler = customizationService.getCustomization('customOnDropHandler');
    const dropHandlerPromise = customOnDropHandler({
      ...props,
      viewportId,
      displaySetInstanceUID,
      appConfig,
    });
    dropHandlerPromise.then(({ handled }) => {
      if (!handled) {
        const updatedViewports = _getUpdatedViewports(viewportId, displaySetInstanceUID);

        commandsManager.run('setDisplaySetsForViewports', { viewportsToUpdate: updatedViewports });
      }
    });
    viewportGridService.publishViewportOnDropHandled({ displaySetInstanceUID });
  };

  // Store previous isReferenceViewable values to avoid infinite loops
  const prevReferenceViewableMap = useRef(new Map());
  // Track viewports that need isReferenceViewable updates
  const viewportsToUpdate = useRef(new Map());

  // Apply isReferenceViewable updates in an effect, not during render
  useEffect(() => {
    const updates = viewportsToUpdate.current;
    if (updates.size > 0) {
      updates.forEach((isReferenceViewable, viewportId) => {
        viewportGridService.setIsReferenceViewable(viewportId, isReferenceViewable);
        prevReferenceViewableMap.current.set(viewportId, isReferenceViewable);
      });
      viewportsToUpdate.current.clear();
    }
  });

  const getViewportPanes = useCallback(() => {
    const viewportPanes = [];

    const numViewportPanes = viewportGridService.getNumViewportPanes();
    for (let i = 0; i < numViewportPanes; i++) {
      const paneMetadata = Array.from(viewports.values())[i] || {};
      const {
        displaySetInstanceUIDs,
        viewportOptions,
        displaySetOptions, // array of options for each display set in the viewport
        x: viewportX,
        y: viewportY,
        width: viewportWidth,
        height: viewportHeight,
        viewportLabel,
      } = paneMetadata;

      const viewportId = viewportOptions.viewportId;
      const isActive = activeViewportId === viewportId;

      const displaySetInstanceUIDsToUse = displaySetInstanceUIDs || [];

      // This is causing the viewport components re-render when the activeViewportId changes
      const displaySets = displaySetInstanceUIDsToUse
        .map(displaySetInstanceUID => {
          return displaySetService.getDisplaySetByUID(displaySetInstanceUID) || {};
        })
        .filter(displaySet => {
          return !displaySet?.unsupported;
        });

      const { component: ViewportComponent, isReferenceViewable } = _getViewportComponent(
        displaySets,
        viewportComponents,
        uiNotificationService
      );

      // Only queue isReferenceViewable updates if it's changed to avoid render loops
      // We need to handle both function and non-function values
      if (viewportId) {
        const prevValue = prevReferenceViewableMap.current.get(viewportId);
        const isFunction = typeof isReferenceViewable === 'function';
        const isSameFunction = isFunction && typeof prevValue === 'function';

        // For non-functions, compare directly. For functions, we treat them as always different
        // (this is conservative but safe)
        if (!isSameFunction && prevValue !== isReferenceViewable) {
          // Queue the update instead of doing it during render
          viewportsToUpdate.current.set(viewportId, isReferenceViewable);
        }
      }

      // look inside displaySets to see if they need reRendering
      const displaySetsNeedsRerendering = displaySets.some(displaySet => {
        return displaySet.needsRerendering;
      });

      const onInteractionHandler = event => {
        if (isActive) {
          return;
        }

        if (event && (appConfig?.activateViewportBeforeInteraction ?? true)) {
          event.preventDefault();
          event.stopPropagation();
        }

        viewportGridService.setActiveViewportId(viewportId);
      };

      const getBorderStyle = viewportIndex => {
        const style = {} as any;
        const layoutOptions = viewportGridService.getLayoutOptionsFromState(
          viewportGridService.getState()
        );
        const vp = layoutOptions[viewportIndex];
        if (!vp) {
          return style;
        }
        const { x, y, width, height } = vp;
        const tolerance = 0.01;

        if (x + width < 1 - tolerance) {
          style.borderRight = '1px solid hsl(var(--input))';
        }

        if (y + height < 1 - tolerance) {
          style.borderBottom = '1px solid hsl(var(--input))';
        }

        return style;
      };

      viewportPanes[i] = (
        <ViewportPane
          // Note: It is highly important that the key is the viewportId here,
          // since it is used to determine if the component should be re-rendered
          // by React, and also in the hanging protocol and stage changes if the
          // same viewportId is used, React, by default, will only move (not re-render)
          // those components. For instance, if we have a 2x3 layout, and we move
          // from 2x3 to 1x1 (second viewport), if the key is the viewportId,
          // React will RE-RENDER the resulting viewport as the key will be different.
          // however, if the key is the viewportId, React will only move the component
          // and not re-render it.
          key={viewportId}
          acceptDropsFor="displayset"
          onDrop={onDropHandler.bind(null, viewportId)}
          onInteraction={onInteractionHandler}
          customStyle={{
            position: 'absolute',
            top: viewportY * 100 + '%',
            left: viewportX * 100 + '%',
            width: viewportWidth * 100 + '%',
            height: viewportHeight * 100 + '%',
            ...getBorderStyle(i),
          }}
          isActive={isActive}
        >
          <div
            data-cy="viewport-pane"
            className="flex h-full w-full min-w-[5px] flex-col"
          >
            <ViewportComponent
              displaySets={displaySets}
              viewportLabel={viewports.size > 1 ? viewportLabel : ''}
              viewportId={viewportId}
              dataSource={dataSource}
              viewportOptions={viewportOptions}
              displaySetOptions={displaySetOptions}
              needsRerendering={displaySetsNeedsRerendering}
              isHangingProtocolLayout={isHangingProtocolLayout}
              onElementEnabled={evt => {
                viewportGridService.setViewportIsReady(viewportId, true);
              }}
            />
          </div>
        </ViewportPane>
      );
    }

    return viewportPanes;
  }, [viewports, activeViewportId, viewportComponents, dataSource]);

  /**
   * Loading indicator until numCols and numRows are gotten from the HangingProtocolService
   */
  if (!numRows || !numCols) {
    return null;
  }

  return (
    <div className="border-input h-[calc(100%-0.25rem)] w-full border">
      <ViewportGrid
        numRows={numRows}
        numCols={numCols}
      >
        {getViewportPanes()}
      </ViewportGrid>
    </div>
  );
}

function _getViewportComponent(displaySets, viewportComponents, uiNotificationService) {
  if (!displaySets || !displaySets.length) {
    return { component: EmptyViewport, isReferenceViewable: () => false };
  }

  // Todo: Do we have a viewport that has two different SOPClassHandlerIds?
  const SOPClassHandlerId = displaySets[0].SOPClassHandlerId;

  for (let i = 0; i < viewportComponents.length; i++) {
    if (!viewportComponents[i]) {
      throw new Error('viewport components not defined');
    }
    if (!viewportComponents[i].displaySetsToDisplay) {
      throw new Error('displaySetsToDisplay is null');
    }
    if (viewportComponents[i].displaySetsToDisplay.includes(SOPClassHandlerId)) {
      const { component, isReferenceViewable } = viewportComponents[i];
      return { component, isReferenceViewable };
    }
  }

  console.log("Can't show displaySet", SOPClassHandlerId, displaySets[0]);
  uiNotificationService.show({
    title: 'Viewport Not Supported Yet',
    message: `Cannot display SOPClassUID of ${displaySets[0].SOPClassUID} yet`,
    type: 'error',
  });

  return { component: EmptyViewport, isReferenceViewable: () => false };
}

export default ViewerViewportGrid;
