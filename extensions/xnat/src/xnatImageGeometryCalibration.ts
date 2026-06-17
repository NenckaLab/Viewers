import { Enums, eventTarget, metaData, utilities } from '@cornerstonejs/core';
import { getImagePlaneModuleForImageId } from './xnatImagePlaneModule';

const { MetadataModules } = Enums;

function isXnatImageId(imageId: string): boolean {
  return (
    typeof imageId === 'string' &&
    (imageId.includes('dicomweb:') ||
      imageId.includes('&frame=') ||
      imageId.includes('/data/projects/') ||
      imageId.includes('/experiments/'))
  );
}

function getSamplesPerPixel(image: Record<string, unknown>): number {
  const numberOfComponents = Number(image.numberOfComponents);
  if (numberOfComponents > 0) {
    return numberOfComponents;
  }
  const pixelData = typeof image.getPixelData === 'function' ? image.getPixelData() : null;
  const rows = Number(image.rows) || 0;
  const columns = Number(image.columns) || 0;
  if (pixelData && rows > 0 && columns > 0) {
    const denom = rows * columns;
    if (denom > 0 && pixelData.length % denom === 0) {
      return pixelData.length / denom;
    }
  }
  return 1;
}

function recreateVoxelManager(image: Record<string, any>, width: number, height: number): void {
  if (typeof image.getPixelData !== 'function' || !utilities?.VoxelManager?.createImageVoxelManager) {
    return;
  }

  const scalarData = image.getPixelData();
  if (!scalarData) {
    return;
  }

  image.voxelManager = utilities.VoxelManager.createImageVoxelManager({
    scalarData,
    width,
    height,
    numberOfComponents: getSamplesPerPixel(image),
  });
  image.getPixelData = () => image.voxelManager.getScalarData();
  if (image.imageFrame) {
    delete image.imageFrame.pixelData;
  }
}

/**
 * OHIF/Cornerstone can decode Enhanced MR frames with row/column metadata that does not
 * match the DICOM store. Other viewers read the file directly; we align the cached image
 * with the resolved imagePlaneModule used by the tag browser.
 */
export function applyImagePlaneModuleToLoadedImage(image: Record<string, any>): boolean {
  const imageId = image?.imageId;
  if (!imageId || !isXnatImageId(imageId)) {
    return false;
  }

  const imagePlaneModule =
    metaData.get(MetadataModules.IMAGE_PLANE, imageId) ||
    metaData.get('imagePlaneModule', imageId) ||
    getImagePlaneModuleForImageId(imageId);

  if (!imagePlaneModule || imagePlaneModule.usingDefaultValues) {
    return false;
  }

  const rows = Number(imagePlaneModule.rows);
  const columns = Number(imagePlaneModule.columns);
  const rowPixelSpacing = Number(imagePlaneModule.rowPixelSpacing);
  const columnPixelSpacing = Number(imagePlaneModule.columnPixelSpacing);

  if (!(rows > 0 && columns > 0)) {
    return false;
  }

  let changed = false;

  if (rowPixelSpacing > 0 && image.rowPixelSpacing !== rowPixelSpacing) {
    image.rowPixelSpacing = rowPixelSpacing;
    changed = true;
  }
  if (columnPixelSpacing > 0 && image.columnPixelSpacing !== columnPixelSpacing) {
    image.columnPixelSpacing = columnPixelSpacing;
    changed = true;
  }

  const pixelData = typeof image.getPixelData === 'function' ? image.getPixelData() : null;
  const samplesPerPixel = getSamplesPerPixel(image);
  const expectedLength = rows * columns * samplesPerPixel;
  const canResize =
    !pixelData || pixelData.length === expectedLength || pixelData.length === columns * rows * samplesPerPixel;

  if (!canResize) {
    return changed;
  }

  if (image.rows !== rows || image.columns !== columns) {
    image.rows = rows;
    image.columns = columns;
    changed = true;
  }

  if (image.width !== columns || image.height !== rows) {
    image.width = columns;
    image.height = rows;
    recreateVoxelManager(image, columns, rows);
    changed = true;
  }

  return changed;
}

export function registerXnatImageGeometryCalibration(): () => void {
  const onImageLoaded = (evt: CustomEvent<{ image?: Record<string, any> }>) => {
    const image = evt.detail?.image;
    if (!image) {
      return;
    }
    applyImagePlaneModuleToLoadedImage(image);
  };

  eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, onImageLoaded as EventListener);

  return () => {
    eventTarget.removeEventListener(Enums.Events.IMAGE_LOADED, onImageLoaded as EventListener);
  };
}
