import cloneDeep from 'lodash.clonedeep';

import { Types as OhifTypes, ServicesManager } from '@ohif/core';
import { PubSubService } from '../_shared/pubSubServiceInterface';
import {
  cache,
  Enums as csEnums,
  geometryLoader,
  eventTarget,
  getEnabledElementByIds,
  metaData,
  utilities as csUtils,
  volumeLoader,
} from '@cornerstonejs/core';
import {
  CONSTANTS as cstConstants,
  Enums as csToolsEnums,
  segmentation as cstSegmentation,
  Types as cstTypes,
  utilities as cstUtils,
} from '@cornerstonejs/tools';
import isEqual from 'lodash.isequal';
import { Types as ohifTypes } from '@ohif/core';
import { easeInOutBell, reverseEaseInOutBell } from '../../utils/transitions';
import {
  Segment,
  Segmentation,
  SegmentationConfig,
} from './SegmentationServiceTypes';
import { mapROIContoursToRTStructData } from './RTSTRUCT/mapROIContoursToRTStructData';

const { COLOR_LUT } = cstConstants;
const LABELMAP = csToolsEnums.SegmentationRepresentations.Labelmap;
const CONTOUR = csToolsEnums.SegmentationRepresentations.Contour;

const EVENTS = {
  // fired when the segmentation is updated (e.g. when a segment is added, removed, or modified, locked, visibility changed etc.)
  SEGMENTATION_UPDATED: 'event::segmentation_updated',
  // fired when the segmentation data (e.g., labelmap pixels) is modified
  SEGMENTATION_DATA_MODIFIED: 'event::segmentation_data_modified',
  // fired when the segmentation is added to the cornerstone
  SEGMENTATION_ADDED: 'event::segmentation_added',
  // fired when the segmentation is removed
  SEGMENTATION_REMOVED: 'event::segmentation_removed',
  // fired when the configuration for the segmentation is changed (e.g., brush size, render fill, outline thickness, etc.)
  SEGMENTATION_CONFIGURATION_CHANGED:
    'event::segmentation_configuration_changed',
  // fired when the active segment is loaded in SEG or RTSTRUCT
  SEGMENT_LOADING_COMPLETE: 'event::segment_loading_complete',
  // for all segments
  SEGMENTATION_LOADING_COMPLETE: 'event::segmentation_loading_complete',
};

const VALUE_TYPES = {};

const SEGMENT_CONSTANT = {
  opacity: 255,
  isVisible: true,
  isLocked: false,
};

const VOLUME_LOADER_SCHEME = 'cornerstoneStreamingImageVolume';

class SegmentationService extends PubSubService {
  static REGISTRATION = {
    name: 'segmentationService',
    altName: 'SegmentationService',
    create: ({
      servicesManager,
    }: OhifTypes.Extensions.ExtensionParams): SegmentationService => {
      return new SegmentationService({ servicesManager });
    },
  };

  segmentations: Record<string, Segmentation>;
  readonly servicesManager: ServicesManager;
  highlightIntervalId = null;
  readonly EVENTS = EVENTS;

  constructor({ servicesManager }) {
    super(EVENTS);
    this.segmentations = {};

    this.servicesManager = servicesManager;

    this._initSegmentationService();
  }

  public destroy = () => {
    eventTarget.removeEventListener(
      csToolsEnums.Events.SEGMENTATION_MODIFIED,
      this._onSegmentationModifiedFromSource
    );

    eventTarget.removeEventListener(
      csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
      this._onSegmentationDataModified
    );

    // remove the segmentations from the cornerstone
    Object.keys(this.segmentations).forEach(segmentationId => {
      this._removeSegmentationFromCornerstone(segmentationId);
    });

    this.segmentations = {};
    this.listeners = {};
  };

  /**
   * It adds a segment to a segmentation, basically just setting the properties for
   * the segment
   * @param segmentationId - The ID of the segmentation you want to add a
   * segment to.
   * @param segmentIndex - The index of the segment to add.
   * @param properties - The properties of the segment to add including
   * -- label: the label of the segment
   * -- color: the color of the segment
   * -- opacity: the opacity of the segment
   * -- visibility: the visibility of the segment (boolean)
   * -- isLocked: whether the segment is locked for editing
   * -- active: whether the segment is currently the active segment to be edited
   */
  public addSegment(
    segmentationId: string,
    segmentIndex: number,
    toolGroupId?: string,
    properties?: {
      label?: string;
      color?: ohifTypes.RGB;
      opacity?: number;
      visibility?: boolean;
      isLocked?: boolean;
      active?: boolean;
    }
  ): void {
    if (segmentIndex === 0) {
      throw new Error('Segment index 0 is reserved for "no label"');
    }

    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const {
      segmentationRepresentationUID,
      segmentation,
    } = this._getSegmentationInfo(segmentationId, toolGroupId);

    if (this._getSegmentInfo(segmentation, segmentIndex)) {
      throw new Error(`Segment ${segmentIndex} already exists`);
    }

    const rgbaColor = cstSegmentation.config.color.getColorForSegmentIndex(
      toolGroupId,
      segmentationRepresentationUID,
      segmentIndex
    );

    segmentation.segments[segmentIndex] = {
      label: properties.label,
      segmentIndex: segmentIndex,
      color: [rgbaColor[0], rgbaColor[1], rgbaColor[2]],
      opacity: rgbaColor[3],
      isVisible: true,
      isLocked: false,
    };

    segmentation.segmentCount++;

    const suppressEvents = true;
    if (properties !== undefined) {
      const {
        color: newColor,
        opacity,
        isLocked,
        visibility,
        active,
      } = properties;

      if (newColor !== undefined) {
        this._setSegmentColor(
          segmentationId,
          segmentIndex,
          newColor,
          toolGroupId,
          suppressEvents
        );
      }

      if (opacity !== undefined) {
        this._setSegmentOpacity(
          segmentationId,
          segmentIndex,
          opacity,
          toolGroupId,
          suppressEvents
        );
      }

      if (visibility !== undefined) {
        this._setSegmentVisibility(
          segmentationId,
          segmentIndex,
          visibility,
          toolGroupId,
          suppressEvents
        );
      }

      if (active !== undefined) {
        this._setActiveSegment(segmentationId, segmentIndex, suppressEvents);
      }

      if (isLocked !== undefined) {
        this._setSegmentLocked(
          segmentationId,
          segmentIndex,
          isLocked,
          suppressEvents
        );
      }
    }

    if (segmentation.activeSegmentIndex === null) {
      this._setActiveSegment(segmentationId, segmentIndex, suppressEvents);
    }

    // Todo: this includes non-hydrated segmentations which might not be
    // persisted in the store
    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  }

  public removeSegment(segmentationId: string, segmentIndex: number): void {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    if (segmentIndex === 0) {
      throw new Error('Segment index 0 is reserved for "no label"');
    }

    if (!this._getSegmentInfo(segmentation, segmentIndex)) {
      return;
    }

    segmentation.segmentCount--;

    segmentation.segments[segmentIndex] = null;

    // Get volume and delete the labels
    // Todo: handle other segmentations other than labelmap
    const labelmapVolume = this.getLabelmapVolume(segmentationId);

    const { dimensions } = labelmapVolume;
    const scalarData = labelmapVolume.getScalarData();

    // Set all values of this segment to zero and get which frames have been edited.
    const frameLength = dimensions[0] * dimensions[1];
    const numFrames = dimensions[2];

    let voxelIndex = 0;

    const modifiedFrames = new Set() as Set<number>;

    for (let frame = 0; frame < numFrames; frame++) {
      for (let p = 0; p < frameLength; p++) {
        if (scalarData[voxelIndex] === segmentIndex) {
          scalarData[voxelIndex] = 0;
          modifiedFrames.add(frame);
        }

        voxelIndex++;
      }
    }

    const modifiedFramesArray: number[] = Array.from(modifiedFrames);

    // Trigger texture update of modified segmentation frames.
    cstSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
      segmentationId,
      modifiedFramesArray
    );

    if (segmentation.activeSegmentIndex === segmentIndex) {
      const segmentIndices = Object.keys(segmentation.segments);

      const newActiveSegmentIndex = segmentIndices.length
        ? Number(segmentIndices[0])
        : 1;

      this._setActiveSegment(segmentationId, newActiveSegmentIndex, true);
    }

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  }

  public setSegmentVisibility(
    segmentationId: string,
    segmentIndex: number,
    isVisible: boolean,
    toolGroupId?: string,
    suppressEvents = false
  ): void {
    this._setSegmentVisibility(
      segmentationId,
      segmentIndex,
      isVisible,
      toolGroupId,
      suppressEvents
    );
  }

  public setSegmentLockedForSegmentation(
    segmentationId: string,
    segmentIndex: number,
    isLocked: boolean
  ): void {
    const suppressEvents = false;
    this._setSegmentLocked(
      segmentationId,
      segmentIndex,
      isLocked,
      suppressEvents
    );
  }

  public setSegmentLabel(
    segmentationId: string,
    segmentIndex: number,
    segmentLabel: string
  ): void {
    this._setSegmentLabel(segmentationId, segmentIndex, segmentLabel);
  }

  public setSegmentColor(
    segmentationId: string,
    segmentIndex: number,
    color: ohifTypes.RGB,
    toolGroupId?: string
  ): void {
    this._setSegmentColor(segmentationId, segmentIndex, color, toolGroupId);
  }

  public setSegmentRGBA = (
    segmentationId: string,
    segmentIndex: number,
    rgbaColor: cstTypes.Color,
    toolGroupId?: string
  ): void => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const suppressEvents = true;
    this._setSegmentOpacity(
      segmentationId,
      segmentIndex,
      rgbaColor[3],
      toolGroupId,
      suppressEvents
    );

    this._setSegmentColor(
      segmentationId,
      segmentIndex,
      [rgbaColor[0], rgbaColor[1], rgbaColor[2]],
      toolGroupId,
      suppressEvents
    );

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  };

  public setSegmentOpacity(
    segmentationId: string,
    segmentIndex: number,
    opacity: number,
    toolGroupId?: string
  ): void {
    this._setSegmentOpacity(segmentationId, segmentIndex, opacity, toolGroupId);
  }

  public setActiveSegmentationForToolGroup(
    segmentationId: string,
    toolGroupId?: string
  ): void {
    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const suppressEvents = false;
    this._setActiveSegmentationForToolGroup(
      segmentationId,
      toolGroupId,
      suppressEvents
    );
  }

  public setActiveSegmentForSegmentation(
    segmentationId: string,
    segmentIndex: number
  ): void {
    this._setActiveSegment(segmentationId, segmentIndex, false);
  }

  /**
   * Get all segmentations.
   *
   * * @param filterNonHydratedSegmentations - If true, only return hydrated segmentations
   * hydrated segmentations are those that have been loaded and persisted
   * in the state, but non hydrated segmentations are those that are
   * only created for the SEG displayset (SEG viewport) and the user might not
   * have loaded them yet fully.
   *

   * @return Array of segmentations
   */
  public getSegmentations(
    filterNonHydratedSegmentations = true
  ): Segmentation[] {
    const segmentations = this._getSegmentations();

    return (
      segmentations &&
      segmentations.filter(segmentation => {
        return !filterNonHydratedSegmentations || segmentation.hydrated;
      })
    );
  }

  private _getSegmentations(): Segmentation[] {
    const segmentations = this.arrayOfObjects(this.segmentations);
    return (
      segmentations &&
      segmentations.map(m => this.segmentations[Object.keys(m)[0]])
    );
  }

  /**
   * Get specific segmentation by its id.
   *
   * @param segmentationId If of the segmentation
   * @return segmentation instance
   */
  public getSegmentation(segmentationId: string): Segmentation {
    return this.segmentations[segmentationId];
  }

  public addOrUpdateSegmentation(
    segmentation: Segmentation,
    suppressEvents = false,
    notYetUpdatedAtSource = false
  ): string {
    const { id: segmentationId } = segmentation;
    let cachedSegmentation = this.segmentations[segmentationId];
    if (cachedSegmentation) {
      // Update the segmentation (mostly for assigning metadata/labels)
      Object.assign(cachedSegmentation, segmentation);

      this._updateCornerstoneSegmentations({
        segmentationId,
        notYetUpdatedAtSource,
      });

      if (!suppressEvents) {
        this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
          segmentation: cachedSegmentation,
        });
      }

      return segmentationId;
    }

    const representationType = segmentation.type;
    const representationData =
      segmentation.representationData[representationType];
    cstSegmentation.addSegmentations([
      {
        segmentationId,
        representation: {
          type: representationType,
          data: {
            ...representationData,
          },
        },
      },
    ]);

    // Define a new color LUT and associate it with this segmentation.
    // Todo: need to be generalized to accept custom color LUTs
    const newColorLUT = this.generateNewColorLUT();
    const newColorLUTIndex = this.getNextColorLUTIndex();

    cstSegmentation.config.color.addColorLUT(newColorLUT, newColorLUTIndex);

    this.segmentations[segmentationId] = {
      ...segmentation,
      label: segmentation.label || '',
      segments: segmentation.segments || [null],
      activeSegmentIndex: segmentation.activeSegmentIndex ?? null,
      segmentCount: segmentation.segmentCount ?? 0,
      isActive: false,
      colorLUTIndex: newColorLUTIndex,
      isVisible: true,
    };

    cachedSegmentation = this.segmentations[segmentationId];

    this._updateCornerstoneSegmentations({
      segmentationId,
      notYetUpdatedAtSource: true,
    });

    if (!suppressEvents) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_ADDED, {
        segmentation: cachedSegmentation,
      });
    }

    return cachedSegmentation.id;
  }

  public async createSegmentationForSEGDisplaySet(
    segDisplaySet,
    segmentationId?: string,
    suppressEvents = false
  ): Promise<string> {
    // Todo: we only support creating labelmap for SEG displaySets for now
    const representationType = LABELMAP;

    segmentationId = segmentationId ?? segDisplaySet.displaySetInstanceUID;

    const defaultScheme = this._getDefaultSegmentationScheme();

    const segmentation: Segmentation = {
      ...defaultScheme,
      id: segmentationId,
      displaySetInstanceUID: segDisplaySet.displaySetInstanceUID,
      type: representationType,
      representationData: {
        [LABELMAP]: {
          volumeId: segmentationId,
          referencedVolumeId: segDisplaySet.referencedVolumeId,
        },
      },
    };

    const labelmap = this.getLabelmapVolume(segmentationId);
    const cachedSegmentation = this.getSegmentation(segmentationId);
    if (labelmap && cachedSegmentation) {
      // if the labelmap with the same segmentationId already exists, we can
      // just assume that the segmentation is already created and move on with
      // updating the state
      return this.addOrUpdateSegmentation(
        Object.assign(segmentation, cachedSegmentation),
        suppressEvents
      );
    }

    const { segments, referencedVolumeId } = segDisplaySet;

    if (!segments || !referencedVolumeId) {
      throw new Error(
        'To create the segmentation from SEG displaySet, the displaySet should be loaded first, you can perform segDisplaySet.load() before calling this method.'
      );
    }

    // if the labelmap doesn't exist, we need to create it first from the
    // DICOM SEG displaySet data
    const referencedVolume = cache.getVolume(referencedVolumeId);

    if (!referencedVolume) {
      throw new Error(
        `No volume found for referencedVolumeId: ${referencedVolumeId}`
      );
    }

    // Force use of a Uint8Array SharedArrayBuffer for the segmentation to save space and so
    // it is easily compressible in worker thread.
    const derivedVolume = await volumeLoader.createAndCacheDerivedVolume(
      referencedVolumeId,
      {
        volumeId: segmentationId,
        targetBuffer: {
          type: 'Uint8Array',
          sharedArrayBuffer: true,
        },
      }
    );
    const [rows, columns] = derivedVolume.dimensions;
    const derivedVolumeScalarData = derivedVolume.getScalarData();

    const { imageIds } = referencedVolume;
    const sopUIDImageIdIndexMap = imageIds.reduce((acc, imageId, index) => {
      const { sopInstanceUid } = metaData.get('generalImageModule', imageId);
      acc[sopInstanceUid] = index;
      return acc;
    }, {} as { [sopUID: string]: number });

    const numSegments = Object.keys(segments).length;
    // Note: ideally we could use the TypedArray set method, but since each
    // slice can have multiple segments, we need to loop over each slice and
    // set the segment value for each segment.
    let overlappingSegments = false;

    const _segmentInfoUpdate = (segmentInfo, segmentIndex) => {
      const { pixelData: segPixelData } = segmentInfo;

      let segmentX = 0;
      let segmentY = 0;
      let segmentZ = 0;
      let count = 0;

      for (const [
        functionalGroupIndex,
        functionalGroup,
      ] of segmentInfo.functionalGroups.entries()) {
        const {
          ReferencedSOPInstanceUID,
        } = functionalGroup.DerivationImageSequence.SourceImageSequence;

        const imageIdIndex = sopUIDImageIdIndexMap[ReferencedSOPInstanceUID];

        if (imageIdIndex === -1) {
          return;
        }

        const step = rows * columns;

        // we need a faster way to get the pixel data for the current
        // functional group, which we use typed array view

        const functionGroupPixelData = new Uint8Array(
          segPixelData.buffer,
          functionalGroupIndex * step,
          step
        );

        const functionalGroupStartIndex = imageIdIndex * step;
        const functionalGroupEndIndex = (imageIdIndex + 1) * step;

        // Note: this for loop is not optimized, since DICOM SEG stores
        // each segment as a separate labelmap so if there is a slice
        // that has multiple segments, we will have to loop over each
        // segment and we cannot use the TypedArray set method.
        for (
          let i = functionalGroupStartIndex, j = 0;
          i < functionalGroupEndIndex;
          i++, j++
        ) {
          if (functionGroupPixelData[j] !== 0) {
            if (derivedVolumeScalarData[i] !== 0) {
              overlappingSegments = true;
            }

            derivedVolumeScalarData[i] = segmentIndex;

            // centroid calculations
            segmentX += i % columns;
            segmentY += Math.floor(i / columns) % rows;
            segmentZ += Math.floor(i / (columns * rows));
            count++;
          }
        }
      }

      // centroid calculations
      const x = Math.floor(segmentX / count);
      const y = Math.floor(segmentY / count);
      const z = Math.floor(segmentZ / count);

      const centerWorld = derivedVolume.imageData.indexToWorld([x, y, z]);

      segmentation.cachedStats = {
        ...segmentation.cachedStats,
        segmentCenter: {
          ...segmentation.cachedStats.segmentCenter,
          [segmentIndex]: {
            center: {
              image: [x, y, z],
              world: centerWorld,
            },
            modifiedTime: segDisplaySet.SeriesDate,
          },
        },
      };

      const numInitialized = Object.keys(segmentation.cachedStats.segmentCenter)
        .length;

      // Calculate percentage completed
      const percentComplete = Math.round((numInitialized / numSegments) * 100);

      this._broadcastEvent(EVENTS.SEGMENT_LOADING_COMPLETE, {
        percentComplete,
        numSegments: numSegments,
      });
    };

    const promiseArray = [];

    for (const segmentIndex in segments) {
      const segmentInfo = segments[segmentIndex];

      // Important: we need a non-blocking way to update the segmentation
      // state, otherwise the UI will freeze and the user will not be able
      // to interact with the app or progress bars will not be updated.
      const promise = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          _segmentInfoUpdate(segmentInfo, segmentIndex);
          resolve();
        }, 0);
      });

      promiseArray.push(promise);
    }

    await Promise.all(promiseArray);

    segmentation.segmentCount = Object.keys(segments).length;
    segmentation.segments = [null]; // segment 0

    Object.keys(segments).forEach(segmentIndex => {
      const segmentInfo = segments[segmentIndex];
      const segIndex = Number(segmentIndex);

      segmentation.segments[segIndex] = {
        label: segmentInfo.label || `Segment ${segIndex}`,
        segmentIndex: Number(segmentIndex),
        color: [
          segmentInfo.color[0],
          segmentInfo.color[1],
          segmentInfo.color[2],
        ],
        opacity: segmentInfo.color[3],
        isVisible: true,
        isLocked: false,
      };
    });

    segDisplaySet.isLoaded = true;

    this._broadcastEvent(EVENTS.SEGMENTATION_LOADING_COMPLETE, {
      segmentationId,
      segDisplaySet,
      overlappingSegments,
    });

    return this.addOrUpdateSegmentation(segmentation, suppressEvents);
  }

  public async createSegmentationForRTDisplaySet(
    rtDisplaySet,
    segmentationId?: string,
    suppressEvents = false
  ): Promise<string> {
    // Todo: we currently only have support for contour representation for initial
    // RT display
    const representationType = CONTOUR;
    segmentationId = segmentationId ?? rtDisplaySet.displaySetInstanceUID;
    const { structureSet } = rtDisplaySet;

    if (!structureSet) {
      throw new Error(
        'To create the contours from RT displaySet, the displaySet should be loaded first, you can perform rtDisplaySet.load() before calling this method.'
      );
    }

    const defaultScheme = this._getDefaultSegmentationScheme();
    const rtDisplaySetUID = rtDisplaySet.displaySetInstanceUID;

    const allRTStructData = mapROIContoursToRTStructData(
      structureSet,
      rtDisplaySetUID
    );

    // sort by segmentIndex
    allRTStructData.sort((a, b) => a.segmentIndex - b.segmentIndex);

    const geometryIds = allRTStructData.map(({ geometryId }) => geometryId);

    const segmentation: Segmentation = {
      ...defaultScheme,
      id: segmentationId,
      displaySetInstanceUID: rtDisplaySetUID,
      type: representationType,
      representationData: {
        [CONTOUR]: {
          geometryIds,
        },
      },
    };

    const cachedSegmentation = this.getSegmentation(segmentationId);

    if (cachedSegmentation) {
      // if the labelmap with the same segmentationId already exists, we can
      // just assume that the segmentation is already created and move on with
      // updating the state
      return this.addOrUpdateSegmentation(
        Object.assign(segmentation, cachedSegmentation),
        suppressEvents
      );
    }

    if (!structureSet.ROIContours?.length) {
      throw new Error(
        'The structureSet does not contain any ROIContours. Please ensure the structureSet is loaded first.'
      );
    }
    const segmentsCachedStats = {};
    const initializeContour = async rtStructData => {
      const { data, id, color, segmentIndex, geometryId } = rtStructData;
      const geometry = await geometryLoader.createAndCacheGeometry(geometryId, {
        geometryData: {
          data,
          id,
          color,
          frameOfReferenceUID: structureSet.frameOfReferenceUID,
          segmentIndex,
        },
        type: csEnums.GeometryType.CONTOUR,
      });

      const contourSet = geometry.data;
      const centroid = contourSet.getCentroid();

      segmentsCachedStats[segmentIndex] = {
        center: { world: centroid },
        modifiedTime: rtDisplaySet.SeriesDate, // we use the SeriesDate as the modifiedTime since this is the first time we are creating the segmentation
      };

      segmentation.segments[segmentIndex] = {
        label: id,
        segmentIndex,
        color,
        ...SEGMENT_CONSTANT,
      };

      const numInitialized = Object.keys(segmentsCachedStats).length;

      // Calculate percentage completed
      const percentComplete = Math.round(
        (numInitialized / allRTStructData.length) * 100
      );

      this._broadcastEvent(EVENTS.SEGMENT_LOADING_COMPLETE, {
        percentComplete,
        // Note: this is not the geometryIds length since there might be
        // some missing ROINumbers
        numSegments: allRTStructData.length,
      });
    };

    const promiseArray = [];

    for (let i = 0; i < allRTStructData.length; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          initializeContour(allRTStructData[i]).then(() => {
            resolve();
          });
        }, 0);
      });

      promiseArray.push(promise);
    }

    await Promise.all(promiseArray);

    segmentation.segmentCount = allRTStructData.length;
    rtDisplaySet.isLoaded = true;

    segmentation.cachedStats = {
      ...segmentation.cachedStats,
      segmentCenter: {
        ...segmentation.cachedStats.segmentCenter,
        ...segmentsCachedStats,
      },
    };

    this._broadcastEvent(EVENTS.SEGMENTATION_LOADING_COMPLETE, {
      segmentationId,
      rtDisplaySet,
    });

    return this.addOrUpdateSegmentation(segmentation, suppressEvents);
  }

  public jumpToSegmentCenter(
    segmentationId: string,
    segmentIndex: number,
    toolGroupId?: string,
    highlightAlpha = 0.9,
    highlightSegment = true,
    animationLength = 750,
    highlightHideOthers = false,
    highlightFunctionType = 'ease-in-out' // todo: make animation functions configurable from outside
  ): void {
    const { toolGroupService } = this.servicesManager.services;
    const center = this._getSegmentCenter(segmentationId, segmentIndex);

    const { world } = center;

    // todo: generalize
    toolGroupId =
      toolGroupId || this._getToolGroupIdsWithSegmentation(segmentationId);

    const toolGroups = [];

    if (Array.isArray(toolGroupId)) {
      toolGroupId.forEach(toolGroup => {
        toolGroups.push(toolGroupService.getToolGroup(toolGroup));
      });
    } else {
      toolGroups.push(toolGroupService.getToolGroup(toolGroupId));
    }

    toolGroups.forEach(toolGroup => {
      const viewportsInfo = toolGroup.getViewportsInfo();

      // @ts-ignore
      for (const { viewportId, renderingEngineId } of viewportsInfo) {
        const { viewport } = getEnabledElementByIds(
          viewportId,
          renderingEngineId
        );
        cstUtils.viewport.jumpToWorld(viewport, world);
      }

      if (highlightSegment) {
        this.highlightSegment(
          segmentationId,
          segmentIndex,
          toolGroup.id,
          highlightAlpha,
          animationLength,
          highlightHideOthers,
          highlightFunctionType
        );
      }
    });
  }

  public highlightSegment(
    segmentationId: string,
    segmentIndex: number,
    toolGroupId?: string,
    alpha = 0.9,
    animationLength = 750,
    hideOthers = true,
    highlightFunctionType = 'ease-in-out'
  ): void {
    if (this.highlightIntervalId) {
      clearInterval(this.highlightIntervalId);
    }

    const segmentation = this.getSegmentation(segmentationId);
    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      toolGroupId
    );

    const { type } = segmentationRepresentation;
    const { segments } = segmentation;

    const highlightFn =
      type === LABELMAP
        ? this._highlightLabelmap.bind(this)
        : this._highlightContour.bind(this);

    const adjustedAlpha = type === LABELMAP ? alpha : 1 - alpha;

    highlightFn(
      segmentIndex,
      adjustedAlpha,
      hideOthers,
      segments,
      toolGroupId,
      animationLength,
      segmentationRepresentation
    );
  }

  public createLabelmapForDisplaySet = async (
    displaySetInstanceUID: string,
    options?: {
      segmentationId: string;
      label: string;
    }
  ): Promise<string> => {
    const { displaySetService } = this.servicesManager.services;

    const displaySet = displaySetService.getDisplaySetByUID(
      displaySetInstanceUID
    );

    // Todo: we currently only support labelmap for segmentation for a displaySet
    const representationType = LABELMAP;

    const volumeId = this._getVolumeIdForDisplaySet(displaySet);

    const segmentationId = options?.segmentationId ?? `${csUtils.uuidv4()}`;

    // Force use of a Uint8Array SharedArrayBuffer for the segmentation to save space and so
    // it is easily compressible in worker thread.
    await volumeLoader.createAndCacheDerivedVolume(volumeId, {
      volumeId: segmentationId,
      targetBuffer: {
        type: 'Uint8Array',
        sharedArrayBuffer: true,
      },
    });

    const defaultScheme = this._getDefaultSegmentationScheme();

    const segmentation: Segmentation = {
      ...defaultScheme,
      id: segmentationId,
      displaySetInstanceUID,
      label: options?.label,
      // We should set it as active by default, as it created for display
      isActive: true,
      type: representationType,
      representationData: {
        LABELMAP: {
          volumeId: segmentationId,
          referencedVolumeId: volumeId, // Todo: this is so ugly
        },
      },
    };

    this.addOrUpdateSegmentation(segmentation);

    return segmentationId;
  };

  /**
   * Toggles the visibility of a segmentation in the state, and broadcasts the event.
   * Note: this method does not update the segmentation state in the source. It only
   * updates the state, and there should be separate listeners for that.
   * @param ids segmentation ids
   */
  public toggleSegmentationVisibility = (segmentationId: string): void => {
    this._toggleSegmentationVisibility(segmentationId, false);
  };

  public addSegmentationRepresentationToToolGroup = async (
    toolGroupId: string,
    segmentationId: string,
    hydrateSegmentation = false,
    representationType = csToolsEnums.SegmentationRepresentations.Labelmap
  ): Promise<void> => {
    const segmentation = this.getSegmentation(segmentationId);

    if (!segmentation) {
      throw new Error(
        `Segmentation with segmentationId ${segmentationId} not found.`
      );
    }

    if (hydrateSegmentation) {
      // hydrate the segmentation if it's not hydrated yet
      segmentation.hydrated = true;
    }

    const { colorLUTIndex } = segmentation;

    // Based on the segmentationId, set the colorLUTIndex.
    const segmentationRepresentationUIDs = await cstSegmentation.addSegmentationRepresentations(
      toolGroupId,
      [
        {
          segmentationId,
          type: representationType,
        },
      ]
    );

    // set the latest segmentation representation as active one
    this._setActiveSegmentationForToolGroup(
      segmentationId,
      toolGroupId,
      segmentationRepresentationUIDs[0]
    );

    cstSegmentation.config.color.setColorLUT(
      toolGroupId,
      segmentationRepresentationUIDs[0],
      colorLUTIndex
    );

    // add the segmentation segments properly
    for (const segment of segmentation.segments) {
      if (segment === null || segment === undefined) {
        continue;
      }

      const {
        segmentIndex,
        color,
        isLocked,
        isVisible: visibility,
        opacity,
      } = segment;

      const suppressEvents = true;

      if (color !== undefined) {
        this._setSegmentColor(
          segmentationId,
          segmentIndex,
          color,
          toolGroupId,
          suppressEvents
        );
      }

      if (opacity !== undefined) {
        this._setSegmentOpacity(
          segmentationId,
          segmentIndex,
          opacity,
          toolGroupId,
          suppressEvents
        );
      }

      if (visibility !== undefined) {
        this._setSegmentVisibility(
          segmentationId,
          segmentIndex,
          visibility,
          toolGroupId,
          suppressEvents
        );
      }

      if (isLocked !== undefined) {
        this._setSegmentLocked(
          segmentationId,
          segmentIndex,
          isLocked,
          suppressEvents
        );
      }
    }
  };

  public setSegmentRGBAColorForSegmentation = (
    segmentationId: string,
    segmentIndex: number,
    rgbaColor,
    toolGroupId?: string
  ) => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    this._setSegmentOpacity(
      segmentationId,
      segmentIndex,
      rgbaColor[3],
      toolGroupId, // toolGroupId
      true
    );
    this._setSegmentColor(
      segmentationId,
      segmentIndex,
      [rgbaColor[0], rgbaColor[1], rgbaColor[2]],
      toolGroupId, // toolGroupId
      true
    );

    this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
      segmentation,
    });
  };

  public getToolGroupIdsWithSegmentation = (
    segmentationId: string
  ): string[] => {
    const toolGroupIds = cstSegmentation.state.getToolGroupIdsWithSegmentation(
      segmentationId
    );
    return toolGroupIds;
  };

  public hydrateSegmentation = (
    segmentationId: string,
    suppressEvents = false
  ): void => {
    const segmentation = this.getSegmentation(segmentationId);

    if (!segmentation) {
      throw new Error(
        `Segmentation with segmentationId ${segmentationId} not found.`
      );
    }

    segmentation.hydrated = true;

    if (!suppressEvents) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _highlightLabelmap(
    segmentIndex: number,
    alpha: number,
    hideOthers: boolean,
    segments: Segment[],
    toolGroupId: string,
    animationLength: number,
    segmentationRepresentation: cstTypes.ToolGroupSpecificRepresentation
  ) {
    const newSegmentSpecificConfig = {
      [segmentIndex]: {
        LABELMAP: {
          fillAlpha: alpha,
        },
      },
    };

    if (hideOthers) {
      for (let i = 0; i < segments.length; i++) {
        if (i !== segmentIndex) {
          newSegmentSpecificConfig[i] = {
            LABELMAP: {
              fillAlpha: 0,
            },
          };
        }
      }
    }

    const { fillAlpha } = this.getConfiguration(toolGroupId);

    let startTime: number = null;
    const animation = (timestamp: number) => {
      if (startTime === null) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / animationLength, 1);

      cstSegmentation.config.setSegmentSpecificConfig(
        toolGroupId,
        segmentationRepresentation.segmentationRepresentationUID,
        {
          [segmentIndex]: {
            LABELMAP: {
              fillAlpha: easeInOutBell(progress, fillAlpha),
            },
          },
        }
      );

      if (progress < 1) {
        requestAnimationFrame(animation);
      } else {
        cstSegmentation.config.setSegmentSpecificConfig(
          toolGroupId,
          segmentationRepresentation.segmentationRepresentationUID,
          {}
        );
      }
    };

    requestAnimationFrame(animation);
  }

  private _highlightContour(
    segmentIndex: number,
    alpha: number,
    hideOthers: boolean,
    segments: Segment[],
    toolGroupId: string,
    animationLength: number,
    segmentationRepresentation: cstTypes.ToolGroupSpecificRepresentation
  ) {
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const progress = (currentTime - startTime) / animationLength;
      if (progress >= 1) {
        cstSegmentation.config.setSegmentSpecificConfig(
          toolGroupId,
          segmentationRepresentation.segmentationRepresentationUID,
          {}
        );
        return;
      }

      const reversedProgress = reverseEaseInOutBell(progress, 0.1);
      cstSegmentation.config.setSegmentSpecificConfig(
        toolGroupId,
        segmentationRepresentation.segmentationRepresentationUID,
        {
          [segmentIndex]: {
            CONTOUR: {
              fillAlpha: reversedProgress,
            },
          },
        }
      );

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }

  public removeSegmentationRepresentationFromToolGroup(
    toolGroupId: string,
    segmentationRepresentationUIDsIds?: string[]
  ): void {
    const uids = segmentationRepresentationUIDsIds || [];
    if (!uids.length) {
      const representations = cstSegmentation.state.getSegmentationRepresentations(
        toolGroupId
      );

      if (!representations || !representations.length) {
        return;
      }

      uids.push(
        ...representations.map(rep => rep.segmentationRepresentationUID)
      );
    }

    cstSegmentation.removeSegmentationsFromToolGroup(toolGroupId, uids);
  }

  /**
   * Removes a segmentation and broadcasts the removed event.
   *
   * @param {string} segmentationId The segmentation id
   */
  public remove(segmentationId: string): void {
    const segmentation = this.segmentations[segmentationId];
    const wasActive = segmentation.isActive;

    if (!segmentationId || !segmentation) {
      console.warn(
        `No segmentationId provided, or unable to find segmentation by id.`
      );
      return;
    }

    const { colorLUTIndex } = segmentation;

    this._removeSegmentationFromCornerstone(segmentationId);

    // Delete associated colormap
    // Todo: bring this back
    cstSegmentation.state.removeColorLUT(colorLUTIndex);

    delete this.segmentations[segmentationId];

    // If this segmentation was active, and there is another segmentation, set another one active.

    if (wasActive) {
      const remainingSegmentations = this._getSegmentations();

      if (remainingSegmentations.length) {
        const { id } = remainingSegmentations[0];

        this._setActiveSegmentationForToolGroup(
          id,
          this._getFirstToolGroupId(),
          false
        );
      }
    }

    this._broadcastEvent(this.EVENTS.SEGMENTATION_REMOVED, {
      segmentationId,
    });
  }

  public getConfiguration = (toolGroupId?: string): SegmentationConfig => {
    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const brushSize = 1;
    // const brushSize = cstUtils.segmentation.getBrushSizeForToolGroup(
    //   toolGroupId
    // );

    const brushThresholdGate = 1;
    // const brushThresholdGate = cstUtils.segmentation.getBrushThresholdForToolGroup(
    //   toolGroupId
    // );

    const segmentationRepresentations = this.getSegmentationRepresentationsForToolGroup(
      toolGroupId
    );

    const typeToUse = segmentationRepresentations?.[0]?.type || LABELMAP;

    const config = cstSegmentation.config.getGlobalConfig();
    const { renderInactiveSegmentations } = config;

    const representation = config.representations[typeToUse];

    const {
      renderOutline,
      outlineWidthActive,
      renderFill,
      fillAlpha,
      fillAlphaInactive,
      outlineOpacity,
      outlineOpacityInactive,
    } = representation;

    return {
      brushSize,
      brushThresholdGate,
      fillAlpha,
      fillAlphaInactive,
      outlineWidthActive,
      renderFill,
      renderInactiveSegmentations,
      renderOutline,
      outlineOpacity,
      outlineOpacityInactive,
    };
  };

  public setConfiguration = (configuration: SegmentationConfig): void => {
    const {
      brushSize,
      brushThresholdGate,
      fillAlpha,
      fillAlphaInactive,
      outlineWidthActive,
      outlineOpacity,
      renderFill,
      renderInactiveSegmentations,
      renderOutline,
    } = configuration;

    const setConfigValueIfDefined = (key, value, transformFn = null) => {
      if (value !== undefined) {
        const transformedValue = transformFn ? transformFn(value) : value;
        this._setSegmentationConfig(key, transformedValue);
      }
    };

    setConfigValueIfDefined('renderOutline', renderOutline);
    setConfigValueIfDefined('outlineWidthActive', outlineWidthActive);
    setConfigValueIfDefined('outlineOpacity', outlineOpacity, v => v / 100);
    setConfigValueIfDefined('fillAlpha', fillAlpha, v => v / 100);
    setConfigValueIfDefined('renderFill', renderFill);
    setConfigValueIfDefined(
      'fillAlphaInactive',
      fillAlphaInactive,
      v => v / 100
    );
    setConfigValueIfDefined('outlineOpacityInactive', fillAlphaInactive, v =>
      Math.max(0.75, v / 100)
    );

    if (renderInactiveSegmentations !== undefined) {
      const config = cstSegmentation.config.getGlobalConfig();
      config.renderInactiveSegmentations = renderInactiveSegmentations;
      cstSegmentation.config.setGlobalConfig(config);
    }

    // if (brushSize !== undefined) {
    //   const { toolGroupService } = this.servicesManager.services;

    //   const toolGroupIds = toolGroupService.getToolGroupIds();

    //   toolGroupIds.forEach(toolGroupId => {
    //     cstUtils.segmentation.setBrushSizeForToolGroup(toolGroupId, brushSize);
    //   });
    // }

    // if (brushThresholdGate !== undefined) {
    //   const { toolGroupService } = this.servicesManager.services;

    //   const toolGroupIds = toolGroupService.getFirstToolGroupIds();

    //   toolGroupIds.forEach(toolGroupId => {
    //     cstUtils.segmentation.setBrushThresholdForToolGroup(
    //       toolGroupId,
    //       brushThresholdGate
    //     );
    //   });
    // }

    this._broadcastEvent(
      this.EVENTS.SEGMENTATION_CONFIGURATION_CHANGED,
      this.getConfiguration()
    );
  };

  public getLabelmapVolume = (segmentationId: string) => {
    return cache.getVolume(segmentationId);
  };

  public getSegmentationRepresentationsForToolGroup = toolGroupId => {
    return cstSegmentation.state.getSegmentationRepresentations(toolGroupId);
  };

  public setSegmentLabelForSegmentation(
    segmentationId: string,
    segmentIndex: number,
    label: string
  ) {
    this._setSegmentLabelForSegmentation(segmentationId, segmentIndex, label);
  }

  private _setSegmentLabelForSegmentation(
    segmentationId: string,
    segmentIndex: number,
    label: string,
    suppressEvents = false
  ) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = segmentation.segments[segmentIndex];

    if (segmentInfo === undefined) {
      throw new Error(
        `Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`
      );
    }

    segmentInfo.label = label;

    if (suppressEvents === false) {
      // this._setSegmentationModified(segmentationId);
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  public shouldRenderSegmentation(
    viewportDisplaySetInstanceUIDs,
    segDisplaySetInstanceUID
  ) {
    if (
      !viewportDisplaySetInstanceUIDs ||
      !viewportDisplaySetInstanceUIDs.length
    ) {
      return false;
    }

    const { displaySetService } = this.servicesManager.services;

    let shouldDisplaySeg = false;

    const segDisplaySet = displaySetService.getDisplaySetByUID(
      segDisplaySetInstanceUID
    );

    const segFrameOfReferenceUID = this._getFrameOfReferenceUIDForSeg(
      segDisplaySet
    );

    // check if the displaySet is sharing the same frameOfReferenceUID
    // with the new segmentation
    for (const displaySetInstanceUID of viewportDisplaySetInstanceUIDs) {
      const displaySet = displaySetService.getDisplaySetByUID(
        displaySetInstanceUID
      );

      // Todo: this might not be ideal for use cases such as 4D, since we
      // don't want to show the segmentation for all the frames
      if (
        displaySet.isReconstructable &&
        displaySet?.images?.[0]?.FrameOfReferenceUID === segFrameOfReferenceUID
      ) {
        shouldDisplaySeg = true;
        break;
      }
    }

    return shouldDisplaySeg;
  }

  private _getDefaultSegmentationScheme() {
    return {
      activeSegmentIndex: 1,
      cachedStats: {},
      label: '',
      segmentsLocked: [],
      displayText: [],
      hydrated: false, // by default we don't hydrate the segmentation for SEG displaySets
      segmentCount: 0,
      segments: [],
      isVisible: true,
      isActive: false,
      colorLUTIndex: 0,
    };
  }

  private _setActiveSegmentationForToolGroup(
    segmentationId: string,
    toolGroupId: string,
    suppressEvents = false
  ) {
    const segmentations = this._getSegmentations();
    const targetSegmentation = this.getSegmentation(segmentationId);

    if (targetSegmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    segmentations.forEach(segmentation => {
      segmentation.isActive = segmentation.id === segmentationId;
    });

    const representation = this._getSegmentationRepresentation(
      segmentationId,
      toolGroupId
    );

    cstSegmentation.activeSegmentation.setActiveSegmentationRepresentation(
      toolGroupId,
      representation.segmentationRepresentationUID
    );

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation: targetSegmentation,
      });
    }
  }

  private _toggleSegmentationVisibility = (
    segmentationId: string,
    suppressEvents = false
  ) => {
    const segmentation = this.segmentations[segmentationId];

    if (!segmentation) {
      throw new Error(
        `Segmentation with segmentationId ${segmentationId} not found.`
      );
    }

    segmentation.isVisible = !segmentation.isVisible;

    this._updateCornerstoneSegmentationVisibility(segmentationId);

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _setActiveSegment(
    segmentationId: string,
    segmentIndex: number,
    suppressEvents = false
  ) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    cstSegmentation.segmentIndex.setActiveSegmentIndex(
      segmentationId,
      segmentIndex
    );

    segmentation.activeSegmentIndex = segmentIndex;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _getSegmentInfo(segmentation: Segmentation, segmentIndex: number) {
    const segments = segmentation.segments;

    if (!segments) {
      return;
    }

    if (segments && segments.length > 0) {
      return segments[segmentIndex];
    }
  }

  private _getVolumeIdForDisplaySet(displaySet) {
    const volumeLoaderSchema =
      displaySet.volumeLoaderSchema ?? VOLUME_LOADER_SCHEME;

    return `${volumeLoaderSchema}:${displaySet.displaySetInstanceUID}`;
  }

  private _setSegmentColor = (
    segmentationId: string,
    segmentIndex: number,
    color: ohifTypes.RGB,
    toolGroupId?: string,
    suppressEvents = false
  ) => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(
        `Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`
      );
    }

    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      toolGroupId
    );

    if (!segmentationRepresentation) {
      throw new Error(
        'Must add representation to toolgroup before setting segments'
      );
    }
    const { segmentationRepresentationUID } = segmentationRepresentation;

    const rgbaColor = cstSegmentation.config.color.getColorForSegmentIndex(
      toolGroupId,
      segmentationRepresentationUID,
      segmentIndex
    );

    cstSegmentation.config.color.setColorForSegmentIndex(
      toolGroupId,
      segmentationRepresentationUID,
      segmentIndex,
      [...color, rgbaColor[3]]
    );

    segmentInfo.color = color;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _getSegmentCenter(segmentationId, segmentIndex) {
    const segmentation = this.getSegmentation(segmentationId);

    if (!segmentation) {
      return;
    }

    const { cachedStats } = segmentation;

    if (!cachedStats) {
      return;
    }

    const { segmentCenter } = cachedStats;

    if (!segmentCenter) {
      return;
    }

    const { center } = segmentCenter[segmentIndex];

    return center;
  }

  private _setSegmentLocked(
    segmentationId: string,
    segmentIndex: number,
    isLocked: boolean,
    suppressEvents = false
  ) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(
        `Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`
      );
    }

    segmentInfo.isLocked = isLocked;

    cstSegmentation.segmentLocking.setSegmentIndexLocked(
      segmentationId,
      segmentIndex,
      isLocked
    );

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _setSegmentVisibility(
    segmentationId: string,
    segmentIndex: number,
    isVisible: boolean,
    toolGroupId?: string,
    suppressEvents = false
  ) {
    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const {
      segmentationRepresentationUID,
      segmentation,
    } = this._getSegmentationInfo(segmentationId, toolGroupId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(
        `Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`
      );
    }

    segmentInfo.isVisible = isVisible;

    cstSegmentation.config.visibility.setSegmentVisibility(
      toolGroupId,
      segmentationRepresentationUID,
      segmentIndex,
      isVisible
    );

    // make sure to update the isVisible flag on the segmentation
    // if a segment becomes invisible then the segmentation should be invisible
    // in the status as well, and show correct icon
    segmentation.isVisible = segmentation.segments
      .filter(Boolean)
      .every(segment => segment.isVisible);

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _setSegmentOpacity = (
    segmentationId: string,
    segmentIndex: number,
    opacity: number,
    toolGroupId?: string,
    suppressEvents = false
  ) => {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(
        `Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`
      );
    }

    toolGroupId = toolGroupId ?? this._getFirstToolGroupId();

    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      toolGroupId
    );

    if (!segmentationRepresentation) {
      throw new Error(
        'Must add representation to toolgroup before setting segments'
      );
    }
    const { segmentationRepresentationUID } = segmentationRepresentation;

    const rgbaColor = cstSegmentation.config.color.getColorForSegmentIndex(
      toolGroupId,
      segmentationRepresentationUID,
      segmentIndex
    );

    cstSegmentation.config.color.setColorForSegmentIndex(
      toolGroupId,
      segmentationRepresentationUID,
      segmentIndex,
      [rgbaColor[0], rgbaColor[1], rgbaColor[2], opacity]
    );

    segmentInfo.opacity = opacity;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  };

  private _setSegmentLabel(
    segmentationId: string,
    segmentIndex: number,
    segmentLabel: string,
    suppressEvents = false
  ) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }

    const segmentInfo = this._getSegmentInfo(segmentation, segmentIndex);

    if (segmentInfo === undefined) {
      throw new Error(
        `Segment ${segmentIndex} not yet added to segmentation: ${segmentationId}`
      );
    }

    segmentInfo.label = segmentLabel;

    if (suppressEvents === false) {
      this._broadcastEvent(this.EVENTS.SEGMENTATION_UPDATED, {
        segmentation,
      });
    }
  }

  private _getSegmentationRepresentation(segmentationId, toolGroupId) {
    const segmentationRepresentations = this.getSegmentationRepresentationsForToolGroup(
      toolGroupId
    );

    if (segmentationRepresentations.length === 0) {
      return;
    }

    // Todo: this finds the first segmentation representation that matches the segmentationId
    // If there are two labelmap representations from the same segmentation, this will not work
    const representation = segmentationRepresentations.find(
      representation => representation.segmentationId === segmentationId
    );

    return representation;
  }

  private _setSegmentationConfig = (property, value) => {
    // Todo: currently we only support global config, and we get the type
    // from the first segmentation
    const typeToUse = this.getSegmentations()[0].type;

    const { cornerstoneViewportService } = this.servicesManager.services;

    const config = cstSegmentation.config.getGlobalConfig();

    config.representations[typeToUse][property] = value;

    // Todo: add non global (representation specific config as well)
    cstSegmentation.config.setGlobalConfig(config);

    const renderingEngine = cornerstoneViewportService.getRenderingEngine();
    const viewportIds = cornerstoneViewportService.getViewportIds();

    renderingEngine.renderViewports(viewportIds);
  };

  private _initSegmentationService() {
    // Connect Segmentation Service to Cornerstone3D.
    eventTarget.addEventListener(
      csToolsEnums.Events.SEGMENTATION_MODIFIED,
      this._onSegmentationModifiedFromSource
    );

    eventTarget.addEventListener(
      csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
      this._onSegmentationDataModified
    );
  }

  private _onSegmentationDataModified = evt => {
    const { segmentationId } = evt.detail;

    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      // Part of add operation, not update operation, exit early.
      return;
    }

    this._broadcastEvent(this.EVENTS.SEGMENTATION_DATA_MODIFIED, {
      segmentation,
    });
  };

  private _onSegmentationModifiedFromSource = evt => {
    const { segmentationId } = evt.detail;

    const segmentation = this.segmentations[segmentationId];

    if (segmentation === undefined) {
      // Part of add operation, not update operation, exit early.
      return;
    }

    const segmentationState = cstSegmentation.state.getSegmentation(
      segmentationId
    );

    if (!segmentationState) {
      return;
    }

    const {
      activeSegmentIndex,
      cachedStats,
      segmentsLocked,
      label,
      type,
    } = segmentationState;

    if (![LABELMAP, CONTOUR].includes(type)) {
      throw new Error(
        `Unsupported segmentation type: ${type}. Only ${LABELMAP} and ${CONTOUR} are supported.`
      );
    }

    const representationData = segmentationState.representationData[type];

    // TODO: handle other representations when available in cornerstone3D
    const segmentationSchema = {
      ...segmentation,
      activeSegmentIndex,
      cachedStats,
      displayText: [],
      id: segmentationId,
      label,
      segmentsLocked,
      type,
      representationData: {
        [type]: {
          ...representationData,
        },
      },
    };

    try {
      this.addOrUpdateSegmentation(segmentationSchema);
    } catch (error) {
      console.warn(
        `Failed to add/update segmentation ${segmentationId}`,
        error
      );
    }
  };

  private _getSegmentationInfo(segmentationId: string, toolGroupId: string) {
    const segmentation = this.getSegmentation(segmentationId);

    if (segmentation === undefined) {
      throw new Error(`no segmentation for segmentationId: ${segmentationId}`);
    }
    const segmentationRepresentation = this._getSegmentationRepresentation(
      segmentationId,
      toolGroupId
    );

    if (!segmentationRepresentation) {
      throw new Error(
        'Must add representation to toolgroup before setting segments'
      );
    }

    const { segmentationRepresentationUID } = segmentationRepresentation;

    return { segmentationRepresentationUID, segmentation };
  }

  private _removeSegmentationFromCornerstone(segmentationId: string) {
    // TODO: This should be from the configuration
    const removeFromCache = true;
    const segmentationState = cstSegmentation.state;
    const sourceSegState = segmentationState.getSegmentation(segmentationId);

    if (!sourceSegState) {
      return;
    }

    const toolGroupIds = segmentationState.getToolGroupIdsWithSegmentation(
      segmentationId
    );

    toolGroupIds.forEach(toolGroupId => {
      const segmentationRepresentations = segmentationState.getSegmentationRepresentations(
        toolGroupId
      );

      const UIDsToRemove = [];
      segmentationRepresentations.forEach(representation => {
        if (representation.segmentationId === segmentationId) {
          UIDsToRemove.push(representation.segmentationRepresentationUID);
        }
      });

      // remove segmentation representations
      cstSegmentation.removeSegmentationsFromToolGroup(
        toolGroupId,
        UIDsToRemove,
        true // immediate
      );
    });

    // cleanup the segmentation state too
    segmentationState.removeSegmentation(segmentationId);

    if (removeFromCache && cache.getVolumeLoadObject(segmentationId)) {
      cache.removeVolumeLoadObject(segmentationId);
    }
  }

  private _updateCornerstoneSegmentations({
    segmentationId,
    notYetUpdatedAtSource,
  }) {
    if (notYetUpdatedAtSource === false) {
      return;
    }
    const segmentationState = cstSegmentation.state;
    const sourceSegmentation = segmentationState.getSegmentation(
      segmentationId
    );
    const segmentation = this.segmentations[segmentationId];
    const { label, cachedStats } = segmentation;

    // Update the label in the source if necessary
    if (sourceSegmentation.label !== label) {
      sourceSegmentation.label = label;
    }

    if (!isEqual(sourceSegmentation.cachedStats, cachedStats)) {
      sourceSegmentation.cachedStats = cachedStats;
    }
  }

  private _updateCornerstoneSegmentationVisibility = segmentationId => {
    const segmentationState = cstSegmentation.state;
    const toolGroupIds = segmentationState.getToolGroupIdsWithSegmentation(
      segmentationId
    );

    toolGroupIds.forEach(toolGroupId => {
      const segmentationRepresentations = cstSegmentation.state.getSegmentationRepresentations(
        toolGroupId
      );

      if (segmentationRepresentations.length === 0) {
        return;
      }

      // Todo: this finds the first segmentation representation that matches the segmentationId
      // If there are two labelmap representations from the same segmentation, this will not work
      const representation = segmentationRepresentations.find(
        representation => representation.segmentationId === segmentationId
      );

      const { segmentsHidden } = representation;

      const currentVisibility = segmentsHidden.size === 0 ? true : false;
      const newVisibility = !currentVisibility;

      cstSegmentation.config.visibility.setSegmentationVisibility(
        toolGroupId,
        representation.segmentationRepresentationUID,
        newVisibility
      );

      // update segments visibility
      const { segmentation } = this._getSegmentationInfo(
        segmentationId,
        toolGroupId
      );

      const segments = segmentation.segments.filter(Boolean);

      segments.forEach(segment => {
        segment.isVisible = newVisibility;
      });
    });
  };

  private _getToolGroupIdsWithSegmentation(segmentationId: string) {
    const segmentationState = cstSegmentation.state;
    const toolGroupIds = segmentationState.getToolGroupIdsWithSegmentation(
      segmentationId
    );

    return toolGroupIds;
  }

  private _getFrameOfReferenceUIDForSeg(displaySet) {
    const frameOfReferenceUID = displaySet.instance?.FrameOfReferenceUID;

    if (frameOfReferenceUID) {
      return frameOfReferenceUID;
    }

    // if not found we should try the ReferencedFrameOfReferenceSequence
    const referencedFrameOfReferenceSequence =
      displaySet.instance?.ReferencedFrameOfReferenceSequence;

    if (referencedFrameOfReferenceSequence) {
      return referencedFrameOfReferenceSequence.FrameOfReferenceUID;
    }
  }

  private _getFirstToolGroupId = () => {
    const { toolGroupService } = this.servicesManager.services;
    const toolGroupIds = toolGroupService.getToolGroupIds();

    return toolGroupIds[0];
  };

  private getNextColorLUTIndex = (): number => {
    let i = 0;
    while (true) {
      if (cstSegmentation.state.getColorLUT(i) === undefined) {
        return i;
      }

      i++;
    }
  };

  private generateNewColorLUT() {
    const newColorLUT = cloneDeep(COLOR_LUT);

    return newColorLUT;
  }

  /**
   * Converts object of objects to array.
   *
   * @return {Array} Array of objects
   */
  private arrayOfObjects = obj => {
    return Object.entries(obj).map(e => ({ [e[0]]: e[1] }));
  };
}

export default SegmentationService;
export { EVENTS, VALUE_TYPES };
