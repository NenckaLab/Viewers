import React, { useEffect, useCallback, useState, ReactElement } from 'react';
import PropTypes from 'prop-types';
import debounce from 'lodash.debounce';
import { ServicesManager } from '@ohif/core';
import { WindowLevel } from '@ohif/ui';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import { Enums, eventTarget, cache as cs3DCache, utilities as csUtils } from '@cornerstonejs/core';

const { Events } = Enums;

const calcHistogram = (data, options) => {
  if (options === undefined) {
    options = {};
  }
  const histogram = {
    numBins: options.numBins || 256,
    range: { min: 0, max: 0 },
    bins: new Int32Array(1),
    maxBin: 0,
    maxBinValue: 0,
  };

  let minToUse = options.min;
  let maxToUse = options.max;

  if (minToUse === undefined || maxToUse === undefined) {
    let min = Infinity;
    let max = -Infinity;
    let index = data.length;

    while (index--) {
      const value = data[index];
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }

    minToUse = min;
    maxToUse = max;
  }

  histogram.range = { min: minToUse, max: maxToUse };

  const bins = new Int32Array(histogram.numBins);
  const binScale = histogram.numBins / (maxToUse - minToUse);

  for (let index = 0; index < data.length; index++) {
    const value = data[index];
    if (value < minToUse) {
      continue;
    }
    if (value > maxToUse) {
      continue;
    }
    const bin = Math.floor((value - minToUse) * binScale);
    bins[bin] += 1;
  }

  histogram.bins = bins;
  histogram.maxBin = 0;
  histogram.maxBinValue = 0;

  for (let bin = 0; bin < histogram.numBins; bin++) {
    if (histogram.bins[bin] > histogram.maxBinValue) {
      histogram.maxBin = bin;
      histogram.maxBinValue = histogram.bins[bin];
    }
  }

  return histogram;
};

const ViewportWindowLevel = ({
  servicesManager,
  viewportId,
}: {
  servicesManager: ServicesManager;
  viewportId: number;
}): ReactElement => {
  const { cornerstoneViewportService } = servicesManager.services;
  const [windowLevels, setWindowLevels] = useState([]);
  const [cachedHistograms, setCachedHistograms] = useState({});

  const getViewportVolumeHistogram = useCallback((viewport, volume, options?) => {
    if (!volume?.loadStatus.loaded) {
      return undefined;
    }

    const volumeImageData = viewport.getImageData(volume.volumeId);

    if (!volumeImageData) {
      return undefined;
    }

    const { scalarData, imageData } = volumeImageData;
    const range = imageData.computeHistogram(imageData.getBounds());
    const { minimum: min, maximum: max } = range;
    const calcHistOptions = {
      numBins: 256,
      min: Math.max(min, options?.min ?? min),
      max: Math.min(max, options?.max ?? max),
    };

    return calcHistogram(scalarData, calcHistOptions);
  }, []);

  /**
   * Looks for all viewports that has exaclty all volumeIds passed as parameter.
   */
  const getViewportsWithVolumeIds = useCallback(
    (volumeIds: string[]) => {
      const renderingEngine = cornerstoneViewportService.getRenderingEngine();
      const viewports = renderingEngine.getVolumeViewports();

      return viewports.filter(vp => {
        const viewportVolumeIds = vp.getActors().map(actor => actor.uid);

        return (
          volumeIds.length === viewportVolumeIds.length &&
          volumeIds.every(volumeId => viewportVolumeIds.includes(volumeId))
        );
      });
    },
    [cornerstoneViewportService]
  );

  const getNodeOpacity = (volumeActor, nodeIndex) => {
    const volumeOpacity = volumeActor.getProperty().getScalarOpacity(0);
    const nodeValue = [];

    volumeOpacity.getNodeValue(nodeIndex, nodeValue);

    return nodeValue[1];
  };

  /**
   * Checks if the opacity applied to the PET volume is something like
   * [{x: 0, y: 0}, {x: 0.1, y: [C]}, {x: [ANY], y: [C]}] where C is a
   * constant opacity value for all x's greater than 0.1
   */
  const isPetVolumeWithDefaultOpacity = (volumeId, volumeActor) => {
    const volume = cs3DCache.getVolume(volumeId);

    if (!volume) {
      return false;
    }

    const modality = volume.metadata.Modality;

    if (modality !== 'PT') {
      return false;
    }

    const volumeOpacity = volumeActor.getProperty().getScalarOpacity(0);

    // It must have at least two points (0 and 0.1)
    if (volumeOpacity.getSize() < 2) {
      return false;
    }

    const node1Value = [];
    const node2Value = [];

    volumeOpacity.getNodeValue(0, node1Value);
    volumeOpacity.getNodeValue(1, node2Value);

    // First node must be (x:0, y:0} and the second one {x:0.1, y:any}
    if (node1Value[0] !== 0 || node1Value[1] !== 0 || node2Value[0] !== 0.1) {
      return false;
    }

    const expectedOpacity = node2Value[1];
    const opacitySize = volumeOpacity.getSize();
    const currentNodeValue = [];

    // Any point after 0.1 must have the same opacity
    for (let i = 2; i < opacitySize; i++) {
      volumeOpacity.getNodeValue(i, currentNodeValue);

      if (currentNodeValue[1] !== expectedOpacity) {
        return false;
      }
    }

    return true;
  };

  /**
   * Checks if the opacity function has a constance opacity value for all x's
   */
  const isVolumeWithConstantOpacity = volumeActor => {
    const volumeOpacity = volumeActor.getProperty().getScalarOpacity(0);
    const opacitySize = volumeOpacity.getSize();
    const firstNodeValue = [];

    volumeOpacity.getNodeValue(0, firstNodeValue);

    const firstNodeOpacity = firstNodeValue[1];

    for (let i = 0; i < opacitySize; i++) {
      const currentNodeValue = [];

      volumeOpacity.getNodeValue(0, currentNodeValue);

      if (currentNodeValue[1] !== firstNodeOpacity) {
        return false;
      }
    }

    return true;
  };

  const getVolumeOpacity = useCallback((viewport, volumeId) => {
    const volumeActor = viewport.getActor(volumeId).actor;

    if (isPetVolumeWithDefaultOpacity(volumeId, volumeActor)) {
      // Get the opacity from the second node at 0.1
      return getNodeOpacity(volumeActor, 1);
    } else if (isVolumeWithConstantOpacity(volumeActor)) {
      return getNodeOpacity(volumeActor, 0);
    }

    return undefined;
  }, []);

  const getWindowLevelsData = useCallback(
    (viewportId: number) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      if (!viewport) {
        return [];
      }

      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);

      const volumeIds = viewport.getActors().map(actor => actor.uid);
      const viewportProperties = viewport.getProperties();
      const { voiRange } = viewportProperties;
      const viewportVoi = voiRange
        ? {
          windowWidth: voiRange.upper - voiRange.lower,
          windowCenter: voiRange.lower + (voiRange.upper - voiRange.lower) / 2,
        }
        : undefined;

      const windowLevels = volumeIds
        .map((volumeId, volumeIndex) => {
          const volume = cs3DCache.getVolume(volumeId);

          if (!volume) {
            return null;
          }

          const opacity = getVolumeOpacity(viewport, volumeId);
          const { metadata, scaling } = volume;
          const modality = metadata.Modality;

          // TODO: find a proper way to fix the histogram
          const options = {
            min: modality === 'PT' ? 0.1 : -999,
            max: modality === 'PT' ? 5 : 2000,
          };

          const histogram =
            cachedHistograms[volumeId] ?? getViewportVolumeHistogram(viewport, volume, options);
          const { voi: displaySetVOI, colormap: displaySetColormap } =
            viewportInfo.displaySetOptions[volumeIndex];
          let colormap;

          if (displaySetColormap) {
            colormap =
              csUtils.colormap.getColormap(displaySetColormap.name) ??
              vtkColorMaps.getPresetByName(displaySetColormap.name);
          }

          const voi = !volumeIndex ? viewportVoi ?? displaySetVOI : displaySetVOI;

          return {
            viewportId,
            modality,
            volumeId,
            volumeIndex,
            voi,
            histogram,
            colormap,
            step: scaling?.PT ? 0.05 : 1,
            opacity,
            // showOpacitySlider: volumeIndex === 1 && opacity !== undefined,
            showOpacitySlider: true,
          };
        })
        .filter(windowLevel => !!windowLevel?.histogram);

      return windowLevels;
    },
    [cachedHistograms, cornerstoneViewportService, getVolumeOpacity, getViewportVolumeHistogram]
  );

  const updateViewportHistograms = useCallback(() => {
    setWindowLevels(() => getWindowLevelsData(viewportId));
  }, [viewportId, getWindowLevelsData]);

  const handleCornerstoneVOIModified = useCallback(
    e => {
      const { detail } = e;
      const { volumeId, range } = detail;
      const oldWindowLevel = windowLevels.find(wl => wl.volumeId === volumeId);

      if (!oldWindowLevel) {
        return;
      }

      const oldVOI = oldWindowLevel.voi;
      const windowWidth = range.upper - range.lower;
      const windowCenter = range.lower + windowWidth / 2;

      if (windowWidth === oldVOI.windowWidth && windowCenter === oldVOI.windowCenter) {
        return;
      }

      const newWindowLevel = {
        ...oldWindowLevel,
        voi: {
          windowWidth,
          windowCenter,
        },
      };

      setWindowLevels(
        windowLevels.map(windowLevel =>
          windowLevel === oldWindowLevel ? newWindowLevel : windowLevel
        )
      );
    },
    [windowLevels]
  );

  const debouncedHandleCornerstoneVOIModified = useCallback(
    debounce(handleCornerstoneVOIModified, 100),
    [handleCornerstoneVOIModified]
  );

  const handleVOIChange = useCallback(
    (volumeId, voi) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      const newRange = {
        lower: voi.windowCenter - voi.windowWidth / 2,
        upper: voi.windowCenter + voi.windowWidth / 2,
      };

      viewport.setProperties({ voiRange: newRange }, volumeId);
      viewport.render();
    },
    [cornerstoneViewportService, viewportId]
  );

  const handleOpacityChange = useCallback(
    (viewportId, _volumeIndex, volumeId, opacity) => {
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      if (!viewport) {
        return;
      }

      const viewportVolumeIds = viewport.getActors().map(actor => actor.uid);
      const viewports = getViewportsWithVolumeIds(viewportVolumeIds);

      viewports.forEach(vp => {
        vp.setProperties({ colormap: { opacity } }, volumeId);
        vp.render();
      });
    },
    [getViewportsWithVolumeIds, cornerstoneViewportService]
  );

  // Listen to windowLevels changes and caches all the new ones
  useEffect(() => {
    const newVolumeHistograms = windowLevels
      .filter(windowLevel => !cachedHistograms[windowLevel.volumeId])
      .reduce((volumeHistograms, windowLevel) => {
        volumeHistograms[windowLevel.volumeId] = windowLevel.histogram;

        return volumeHistograms;
      }, {});

    if (Object.keys(newVolumeHistograms).length) {
      setCachedHistograms({ ...cachedHistograms, ...newVolumeHistograms });
    }
  }, [windowLevels, cachedHistograms]);

  // Updates the histogram when the viewport index prop has changed
  useEffect(() => updateViewportHistograms(), [viewportId, updateViewportHistograms]);

  // Listen to cornerstone events on "eventTarget" and at the document level
  useEffect(() => {
    eventTarget.addEventListener(Events.IMAGE_VOLUME_LOADING_COMPLETED, updateViewportHistograms);

    document.addEventListener(Events.VOI_MODIFIED, debouncedHandleCornerstoneVOIModified, true);

    return () => {
      eventTarget.removeEventListener(
        Events.IMAGE_VOLUME_LOADING_COMPLETED,
        updateViewportHistograms
      );

      document.removeEventListener(
        Events.VOI_MODIFIED,
        debouncedHandleCornerstoneVOIModified,
        true
      );
    };
  }, [updateViewportHistograms, debouncedHandleCornerstoneVOIModified]);

  // Updates the viewport when the context of the viewport has changed. This is
  // necessary when moving across different stages because the viewport index
  // may not change but the volumes loaded on it may change.
  useEffect(() => {
    const { unsubscribe } = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_VOLUMES_CHANGED,
      ({ viewportInfo }) => {
        if (viewportInfo.viewportId === viewportId) {
          updateViewportHistograms();
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [viewportId, cornerstoneViewportService, updateViewportHistograms]);

  return (
    <>
      {windowLevels.map((windowLevel, i) => (
        <WindowLevel
          key={windowLevel.volumeId}
          title={`Winddow Level (${windowLevel.modality})`}
          histogram={windowLevel.histogram}
          voi={windowLevel.voi}
          step={windowLevel.step}
          showOpacitySlider={windowLevel.showOpacitySlider}
          colormap={windowLevel.colormap}
          onVOIChange={voi => handleVOIChange(windowLevel.volumeId, voi)}
          opacity={windowLevel.opacity}
          onOpacityChange={opacity =>
            handleOpacityChange(windowLevel.viewportId, i, windowLevel.volumeId, opacity)
          }
        />
      ))}
    </>
  );
};

ViewportWindowLevel.propTypes = {
  servicesManager: PropTypes.instanceOf(ServicesManager),
  viewportId: PropTypes.number.isRequired,
};

export default ViewportWindowLevel;
