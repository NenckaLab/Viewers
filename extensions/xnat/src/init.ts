import { DicomMetadataStore, classes } from '@ohif/core';
import { calculateSUVScalingFactors } from '@cornerstonejs/calculate-suv';
import { initXNATDicomLoader } from './XNATDicomLoader';
import { registerXnatMetadataFallback } from './metadataProviderFallback';
import { registerXnatImageGeometryCalibration } from './xnatImageGeometryCalibration';
import { getAppCornerstone, registerVoiLutModuleHandler } from './registerVoiLutModuleHandler';
import { registerLegacyWadoUriLoaders } from './registerLegacyWadoUriLoaders';

import getPTImageIdInstanceMetadata from './getPTImageIdInstanceMetadata';
import { registerHangingProtocolAttributes } from './hangingprotocols';
import { registerVolumeRenderingErrorHandler } from './utils/volumeRenderingErrorHandler';

const metadataProvider = classes.MetadataProvider;

// Define window type to include cornerstoneWADOImageLoader
declare global {
  interface Window {
    cornerstoneWADOImageLoader?: any;
  }
}

// Extend ServicesManager type to include subscribe
interface ExtendedServicesManager {
  services: Record<string, any>;
  subscribe?: (serviceName: string, callback: () => void) => void;
}

/**
 *
 * @param {Object} servicesManager
 * @param {Object} configuration
 */
export default function init({
  servicesManager,
  commandsManager,
  configuration = {},
}: {
  servicesManager: any;
  commandsManager: any;
  configuration?: any;
}): void {
  const {
    toolbarService,
    cineService,
    viewportGridService,
    cornerstoneViewportService,
    toolGroupService,
  } = servicesManager.services;

  registerXnatMetadataFallback();
  registerXnatImageGeometryCalibration();
  registerVoiLutModuleHandler();
  registerLegacyWadoUriLoaders();

  // Initialize XNAT DICOM loader with the configuration, returning a standard promise
  const initializeXNATLoader = async () => {
    try {
      // Pass the configuration to the XNAT DICOM loader
      // Make sure we properly handle the promise returned by initXNATDicomLoader
      const loaderPromise = initXNATDicomLoader(configuration);

      // Don't try to call start() on the promise, just use standard then/catch
      return loaderPromise
        .then(() => {
          console.log('XNAT Extension: XNAT DICOM loader initialized successfully');
        })
        .catch(error => {
          console.error('XNAT Extension: Failed to initialize XNAT DICOM loader:', error);

          // For other errors, we can still let them propagate
          return Promise.reject(error);
        });
    } catch (error) {
      console.error('XNAT Extension: Error in initializeXNATLoader:', error);
      return Promise.reject(error);
    }
  };

  // Call the initialization function right away. 
  // It will handle waiting for Cornerstone internally.
  initializeXNATLoader();

  // Subscribe to DicomMetadataStore events to know when instances are added
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.INSTANCES_ADDED, (event) => {
  });

  toolbarService.registerEventForToolbarUpdate(cineService, [
    cineService.EVENTS.CINE_STATE_CHANGED,
  ]);

  if (toolGroupService?.EVENTS?.VIEWPORT_ADDED) {
    toolbarService.registerEventForToolbarUpdate(toolGroupService, [
      toolGroupService.EVENTS.VIEWPORT_ADDED,
    ]);
  }

  // Add
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.INSTANCES_ADDED, handlePETImageMetadata);

  // If the metadata for PET has changed by the user (e.g. manually changing the PatientWeight)
  // we need to recalculate the SUV Scaling Factors
  DicomMetadataStore.subscribe(DicomMetadataStore.EVENTS.SERIES_UPDATED, handlePETImageMetadata);

  // Adds extra custom attributes for use by hanging protocols
  registerHangingProtocolAttributes({ servicesManager });
}

const handlePETImageMetadata = ({ SeriesInstanceUID, StudyInstanceUID }) => {
  const { instances } = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);

  if (!instances?.length) {
    return;
  }

  const modality = instances[0].Modality;

  if (!modality || modality !== 'PT') {
    return;
  }

  const imageIds = instances.map(instance => instance.imageId);
  const instanceMetadataArray = [];
  // try except block to prevent errors when the metadata is not correct
  try {
    imageIds.forEach(imageId => {
      const instanceMetadata = getPTImageIdInstanceMetadata(imageId);
      if (instanceMetadata) {
        instanceMetadataArray.push(instanceMetadata);
      }
    });

    if (!instanceMetadataArray.length) {
      return;
    }

    const suvScalingFactors = calculateSUVScalingFactors(instanceMetadataArray);
    instanceMetadataArray.forEach((instanceMetadata, index) => {
      metadataProvider.addCustomMetadata(
        imageIds[index],
        'scalingModule',
        suvScalingFactors[index]
      );
    });
  } catch (error) {
    console.log(error);
  }
};

/**
 * Pre-registration hook for XNAT extension.
 * Runs when the extension is registered (before modes load).
 * Registers metadata fallback so it's available before any viewport loads.
 */
export function preRegistration({
  servicesManager,
  commandsManager,
  configuration = {},
  extensionManager,
}) {
  const cs = getAppCornerstone(extensionManager);
  registerXnatMetadataFallback();
  registerXnatImageGeometryCalibration();
  registerVoiLutModuleHandler(cs);
  // After cornerstone registers naturalized loaders; onModeEnter re-applies if needed.
  registerLegacyWadoUriLoaders(cs);

  registerVolumeRenderingErrorHandler({ servicesManager, commandsManager });
}
