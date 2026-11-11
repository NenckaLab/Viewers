import React, { useEffect, useState, useRef } from 'react';
import PropTypes from 'prop-types';
import XNATStudyBrowser from '../xnat-components/XNATStudyBrowser/XNATStudyBrowser';
import { useViewportGrid } from '@ohif/ui-next';
import { DicomMetadataStore } from '@ohif/core';
import sessionMap from '../utils/sessionMap';
import getImageSrcFromImageId from '../../../../extensions/default/src/Panels/getImageSrcFromImageId';
import { normalizePatientName } from '../XNATDataSource/Utils/DataSourceUtils';

declare global {
  interface Window {
    AppContext?: {
      xnatSeriesMetadata?: Record<string, any>;
      [key: string]: any;
    };
  }
}

interface ThumbnailData {
  displaySetInstanceUID: string;
  SeriesDescription: string;
  SeriesNumber: string | number;
  modality: string;
  numImageFrames: number;
  imageId?: string;
  imageSrc?: string | null;
}

interface StudyData {
  StudyInstanceUID: string;
  StudyDescription: string;
  PatientName?: string;
  PatientID?: string;
  StudyDate?: string;
  session?: {
    experimentId: string;
    projectId: string;
    subjectId: string;
  };
  thumbnails: ThumbnailData[];
}

const THUMBNAIL_RETRY_DELAY_MS = 750;
const THUMBNAIL_MAX_RETRIES = 4;
const THUMBNAIL_NO_IMAGE_MODALITIES = ['SR', 'SEG', 'SM', 'RTSTRUCT', 'RTPLAN', 'RTDOSE'];

function resolveThumbnailImageId(displaySet: any, dataSource: any): string | undefined {
  if (!displaySet) {
    return undefined;
  }

  if (Array.isArray(displaySet.imageIds) && displaySet.imageIds.length > 0) {
    return displaySet.imageIds[Math.floor(displaySet.imageIds.length / 2)];
  }

  if (dataSource && typeof dataSource.getImageIdsForDisplaySet === 'function') {
    const imageIds = dataSource.getImageIdsForDisplaySet(displaySet);
    if (Array.isArray(imageIds) && imageIds.length > 0) {
      return imageIds[Math.floor(imageIds.length / 2)];
    }
  }

  const instances = displaySet.instances || displaySet.images;
  if (Array.isArray(instances) && instances.length > 0) {
    return instances[Math.floor(instances.length / 2)]?.imageId;
  }

  return undefined;
}

function buildSessionForStudy(StudyInstanceUID: string) {
  let mappedExperimentId = '';
  let mappedProjectId = '';
  try {
    const cachedMappings = sessionStorage.getItem('xnat_studyMappings');
    if (cachedMappings) {
      const mapped = JSON.parse(cachedMappings)?.[StudyInstanceUID];
      mappedExperimentId = mapped?.experimentId || '';
      mappedProjectId = mapped?.projectId || '';
    }
  } catch (_e) {
    // ignore invalid cached mappings
  }

  return {
    experimentId:
      mappedExperimentId ||
      sessionMap.getExperimentID?.() ||
      sessionStorage.getItem('xnat_experimentId') ||
      '',
    projectId:
      mappedProjectId ||
      sessionMap.getProject?.() ||
      sessionStorage.getItem('xnat_projectId') ||
      '',
    subjectId:
      sessionMap.getSubject?.() ||
      sessionStorage.getItem('xnat_subjectId') ||
      '',
  };
}

function buildStudyBrowserStructure(displaySets: any[]): StudyData[] {
  const studyDisplaySetsMap: Record<string, StudyData> = {};
  const studyUIDs = Array.from(new Set(displaySets.map(ds => ds.StudyInstanceUID).filter(Boolean)));
  const dicomStudies = studyUIDs
    .map(uid => {
      const study = DicomMetadataStore.getStudy(uid);
      return study ? { ...study, StudyInstanceUID: uid, wadoRoot: study.wadoRoot } : null;
    })
    .filter(Boolean);

  displaySets.forEach(displaySet => {
    const {
      StudyInstanceUID,
      displaySetInstanceUID,
      SeriesDescription,
      SeriesNumber,
      Modality,
      numImageFrames,
    } = displaySet;

    if (!StudyInstanceUID || !displaySetInstanceUID) {
      return;
    }

    if (!studyDisplaySetsMap[StudyInstanceUID]) {
      const dicomStudy = dicomStudies.find(study => study?.StudyInstanceUID === StudyInstanceUID);
      const fromDisplaySet = normalizePatientName(
        displaySet?.PatientName || displaySet?.instances?.[0]?.PatientName
      );
      const fromStore = normalizePatientName(dicomStudy?.PatientName);
      studyDisplaySetsMap[StudyInstanceUID] = {
        StudyInstanceUID,
        StudyDescription:
          dicomStudy?.StudyDescription || displaySet?.StudyDescription || 'No description',
        PatientName: fromDisplaySet || fromStore || '',
        PatientID: normalizePatientName(
          displaySet?.PatientID || displaySet?.instances?.[0]?.PatientID || dicomStudy?.PatientID
        ),
        StudyDate: dicomStudy?.StudyDate || displaySet?.StudyDate || '',
        session: buildSessionForStudy(StudyInstanceUID),
        thumbnails: [],
      };
    }

    studyDisplaySetsMap[StudyInstanceUID].thumbnails.push({
      displaySetInstanceUID,
      SeriesDescription: SeriesDescription || 'No description',
      SeriesNumber: SeriesNumber || '',
      modality: Modality || '',
      numImageFrames: numImageFrames || 0,
      imageSrc: null,
    });
  });

  return Object.values(studyDisplaySetsMap);
}

function mergePreservedImageSrcs(studies: StudyData[], previous: StudyData[]): StudyData[] {
  const previousSrcByUid: Record<string, { imageSrc?: string | null; imageId?: string }> = {};
  previous.forEach(study => {
    study.thumbnails.forEach(thumb => {
      if (thumb.imageSrc) {
        previousSrcByUid[thumb.displaySetInstanceUID] = {
          imageSrc: thumb.imageSrc,
          imageId: thumb.imageId,
        };
      }
    });
  });

  return studies.map(study => ({
    ...study,
    thumbnails: study.thumbnails.map(thumb => {
      const preserved = previousSrcByUid[thumb.displaySetInstanceUID];
      if (!preserved) {
        return thumb;
      }
      return {
        ...thumb,
        imageSrc: preserved.imageSrc,
        imageId: preserved.imageId,
      };
    }),
  }));
}

function patchThumbnailImageSrc(
  studies: StudyData[],
  displaySetInstanceUID: string,
  imageId: string | undefined,
  imageSrc: string | null
): StudyData[] {
  return studies.map(study => ({
    ...study,
    thumbnails: study.thumbnails.map(thumb =>
      thumb.displaySetInstanceUID === displaySetInstanceUID
        ? { ...thumb, imageId, imageSrc }
        : thumb
    ),
  }));
}

/**
 * Wraps the XNATStudyBrowser and provides services
 */
function WrappedXNATStudyBrowserPanel({ extensionManager, servicesManager, commandsManager }) {
  const [dataSource] = extensionManager.getActiveDataSource();
  const { displaySetService, hangingProtocolService } = servicesManager.services as {
    displaySetService: any;
    hangingProtocolService: any;
  };

  const [{ activeViewportId, isHangingProtocolLayout }, viewportGridService] = useViewportGrid();

  const [studyBrowserData, setStudyBrowserData] = useState<StudyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const processGenerationRef = useRef(0);
  const inFlightThumbnailUidsRef = useRef<Set<string>>(new Set());
  const retryAttemptByUidRef = useRef<Record<string, number>>({});
  const studyBrowserDataRef = useRef<StudyData[]>([]);
  const getImageSrcRef = useRef<(imageId: string) => Promise<string | null>>(async () => null);

  useEffect(() => {
    studyBrowserDataRef.current = studyBrowserData;
  }, [studyBrowserData]);

  useEffect(() => {
    getImageSrcRef.current = async (imageId: string) => {
      const utilities = extensionManager.getModuleEntry(
        '@ohif/extension-cornerstone.utilityModule.common'
      );
      if (!utilities) {
        return null;
      }
      try {
        const { cornerstone } = utilities.exports.getCornerstoneLibraries();
        if (!cornerstone) {
          return null;
        }
        return await getImageSrcFromImageId(cornerstone, imageId);
      } catch (_ex) {
        return null;
      }
    };
  }, [extensionManager]);

  const loadThumbnailForDisplaySet = async (displaySetInstanceUID: string) => {
    if (!isMountedRef.current || inFlightThumbnailUidsRef.current.has(displaySetInstanceUID)) {
      return;
    }

    const existing = studyBrowserDataRef.current
      .flatMap(study => study.thumbnails)
      .find(thumb => thumb.displaySetInstanceUID === displaySetInstanceUID);
    if (existing?.imageSrc) {
      return;
    }

    const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (
      !displaySet ||
      displaySet.unsupported ||
      THUMBNAIL_NO_IMAGE_MODALITIES.includes(displaySet.Modality)
    ) {
      retryAttemptByUidRef.current[displaySetInstanceUID] = THUMBNAIL_MAX_RETRIES;
      return;
    }

    inFlightThumbnailUidsRef.current.add(displaySetInstanceUID);

    try {
      let imageSrc: string | null = displaySet.thumbnailSrc || null;
      const imageId = resolveThumbnailImageId(displaySet, dataSource);

      if (!imageSrc && typeof displaySet.getThumbnailSrc === 'function') {
        try {
          imageSrc =
            (await displaySet.getThumbnailSrc({
              getImageSrc: (id: string) => getImageSrcRef.current(id),
            })) || null;
        } catch (_error) {
          imageSrc = null;
        }
      }

      if (!imageSrc && imageId) {
        try {
          imageSrc = (await getImageSrcRef.current(imageId)) || null;
        } catch (_error) {
          imageSrc = null;
        }
      }

      if (imageSrc) {
        displaySet.thumbnailSrc = imageSrc;
        retryAttemptByUidRef.current[displaySetInstanceUID] = 0;
      }

      if (!isMountedRef.current) {
        return;
      }

      setStudyBrowserData(prev =>
        patchThumbnailImageSrc(prev, displaySetInstanceUID, imageId, imageSrc)
      );
    } finally {
      inFlightThumbnailUidsRef.current.delete(displaySetInstanceUID);
    }
  };

  const scheduleThumbnailRetries = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
    }

    retryTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) {
        return;
      }

      const missingUids = studyBrowserDataRef.current
        .flatMap(study => study.thumbnails)
        .filter(thumb => !thumb.imageSrc)
        .map(thumb => thumb.displaySetInstanceUID)
        .filter(uid => {
          if (inFlightThumbnailUidsRef.current.has(uid)) {
            return false;
          }
          const attempts = retryAttemptByUidRef.current[uid] || 0;
          return attempts < THUMBNAIL_MAX_RETRIES;
        });

      missingUids.forEach(uid => {
        retryAttemptByUidRef.current[uid] = (retryAttemptByUidRef.current[uid] || 0) + 1;
        loadThumbnailForDisplaySet(uid);
      });

      const stillWaiting = studyBrowserDataRef.current
        .flatMap(study => study.thumbnails)
        .some(thumb => {
          if (thumb.imageSrc) {
            return false;
          }
          if (inFlightThumbnailUidsRef.current.has(thumb.displaySetInstanceUID)) {
            return true;
          }
          return (retryAttemptByUidRef.current[thumb.displaySetInstanceUID] || 0) < THUMBNAIL_MAX_RETRIES;
        });

      if (stillWaiting) {
        scheduleThumbnailRetries();
      }
    }, THUMBNAIL_RETRY_DELAY_MS);
  };

  const refreshStudyBrowser = () => {
    if (!isMountedRef.current) {
      return;
    }

    const generation = ++processGenerationRef.current;
    const currentDisplaySets = displaySetService.activeDisplaySets || [];

    if (currentDisplaySets.length === 0) {
      if (studyBrowserDataRef.current.length > 0) {
        setStudyBrowserData([]);
      }
      setIsLoading(true);
      return;
    }

    // Keep existing thumbnails visible while refreshing — remounting the list
    // was part of why late-arriving imageSrcs looked blank until panel reopen.
    if (studyBrowserDataRef.current.length === 0) {
      setIsLoading(true);
    }

    const nextStructure = mergePreservedImageSrcs(
      buildStudyBrowserStructure(currentDisplaySets),
      studyBrowserDataRef.current
    );

    if (generation !== processGenerationRef.current || !isMountedRef.current) {
      return;
    }

    setStudyBrowserData(nextStructure);
    setIsLoading(false);

    const pendingUids = nextStructure
      .flatMap(study => study.thumbnails)
      .filter(thumb => !thumb.imageSrc)
      .map(thumb => thumb.displaySetInstanceUID);

    pendingUids.forEach(uid => {
      loadThumbnailForDisplaySet(uid);
    });

    if (pendingUids.length > 0) {
      scheduleThumbnailRetries();
    }
  };

  const debouncedRefreshStudyBrowser = () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      refreshStudyBrowser();
    }, 100);
  };

  useEffect(() => {
    isMountedRef.current = true;
    debouncedRefreshStudyBrowser();

    let addedSubscription = { unsubscribe: () => {} };
    let changedSubscription = { unsubscribe: () => {} };

    if (
      displaySetService?.EVENTS?.DISPLAY_SETS_ADDED &&
      displaySetService?.EVENTS?.DISPLAY_SETS_CHANGED
    ) {
      addedSubscription = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_ADDED,
        debouncedRefreshStudyBrowser
      );
      changedSubscription = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
        debouncedRefreshStudyBrowser
      );
    } else {
      console.warn('XNAT: DisplaySetService EVENTS (ADDED/CHANGED) not ready yet, skipping subscription.');
    }

    return () => {
      isMountedRef.current = false;
      addedSubscription.unsubscribe();
      changedSubscription.unsubscribe();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      inFlightThumbnailUidsRef.current.clear();
    };
  }, [displaySetService, dataSource, extensionManager]);

  const onThumbnailClick = (_displaySetInstanceUID, _event) => {
    // No action for single click currently
  };

  const onThumbnailDoubleClick = displaySetInstanceUID => {
    try {
      const updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
        activeViewportId,
        displaySetInstanceUID,
        isHangingProtocolLayout
      );
      viewportGridService.setDisplaySetsForViewports(updatedViewports);
    } catch (error) {
      console.error('XNAT: Error setting viewport display sets:', error);
    }
  };

  if (isLoading && studyBrowserData.length === 0) {
    return (
      <div className="h-full overflow-y-auto overflow-x-hidden p-4">
        <div className="text-sm text-muted-foreground">Loading studies...</div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {studyBrowserData.length === 0 ? (
        <div className="h-full overflow-y-auto overflow-x-hidden p-4">
          <div className="text-sm text-muted-foreground">No studies available</div>
        </div>
      ) : (
        <XNATStudyBrowser
          studies={studyBrowserData}
          onThumbnailClick={onThumbnailClick}
          onThumbnailDoubleClick={onThumbnailDoubleClick}
          supportsDrag
        />
      )}
    </div>
  );
}

WrappedXNATStudyBrowserPanel.propTypes = {
  extensionManager: PropTypes.object.isRequired,
  servicesManager: PropTypes.object.isRequired,
  commandsManager: PropTypes.object.isRequired,
};

export default WrappedXNATStudyBrowserPanel;
