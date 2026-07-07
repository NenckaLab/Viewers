import { utils } from '@ohif/core';
import { getSOPClassUIDForModality } from '../XNATDataSource/Utils/SOPUtils';

const { isImage } = utils;

export const MAX_OVERREAD_ACQUISITION_IMAGES = 2500;

export function isOverreadModeActive(
  servicesManager?: { services?: { isOverreadMode?: boolean } }
): boolean {
  if (servicesManager?.services?.isOverreadMode === true) {
    return true;
  }

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    return params.get('overreadMode') === 'true';
  }

  return false;
}

export function countImagesInXnatSeries(
  xnatInstances: any[],
  seriesModality?: string
): number {
  return xnatInstances.reduce((sum, xnatInstance) => {
    const meta = xnatInstance.metadata || {};
    const sopClassUID =
      meta.SOPClassUID ||
      (seriesModality ? getSOPClassUIDForModality(seriesModality) : undefined);

    if (!isImage(sopClassUID) && !meta.Rows) {
      return sum;
    }

    return sum + (Number(meta.NumberOfFrames) || 1);
  }, 0);
}

export function shouldSkipAcquisitionInOverreadMode(
  xnatInstances: any[],
  seriesModality: string | undefined,
  servicesManager?: { services?: { isOverreadMode?: boolean } }
): boolean {
  if (!isOverreadModeActive(servicesManager)) {
    return false;
  }

  return countImagesInXnatSeries(xnatInstances, seriesModality) > MAX_OVERREAD_ACQUISITION_IMAGES;
}
