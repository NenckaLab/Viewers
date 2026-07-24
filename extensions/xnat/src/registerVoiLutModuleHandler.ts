/**
 * Prevents Cornerstone "Invalid VOI LUT function" crashes.
 *
 * dicom-image-loader createImage indexes `voiLUTFunction[0]`. When metadata
 * supplies a string ("LINEAR"), that becomes "L" and toLowHighRange throws.
 * Register from preRegistration so this runs before images load.
 */
import {
  Enums,
  StackViewport,
  eventTarget,
  metaData,
} from '@cornerstonejs/core';
import { classes, utils } from '@ohif/core';

const metadataProvider = classes.MetadataProvider;
const { toNumber } = utils;

const VALID_VOI_LUT_FUNCTIONS = new Set(['LINEAR', 'SIGMOID', 'LINEAR_EXACT']);

/** Normalize to a value toLowHighRange accepts, or undefined (defaults to LINEAR). */
function normalizeVoiLUTFunction(value: unknown): string | undefined {
  if (value == null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return normalizeVoiLUTFunction(value[0]);
  }

  if (typeof value !== 'string') {
    return 'LINEAR';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (VALID_VOI_LUT_FUNCTIONS.has(trimmed)) {
    return trimmed;
  }

  // createImage string-index bug: first character of the DICOM CS value
  if (trimmed === 'S') {
    return 'SIGMOID';
  }

  // 'L' may be LINEAR or LINEAR_EXACT — LINEAR is the safe default
  return 'LINEAR';
}

function normalizeVoiLUTFunctionAsArray(value: unknown): string[] | undefined {
  const normalized = normalizeVoiLUTFunction(value);
  return normalized ? [normalized] : undefined;
}

function buildVoiLutModule(instance: Record<string, unknown>) {
  const { WindowCenter, WindowWidth, VOILUTFunction } = instance;
  if (WindowCenter == null || WindowWidth == null) {
    return undefined;
  }

  const windowCenter = Array.isArray(WindowCenter) ? WindowCenter : [WindowCenter];
  const windowWidth = Array.isArray(WindowWidth) ? WindowWidth : [WindowWidth];

  return {
    windowCenter: toNumber(windowCenter),
    windowWidth: toNumber(windowWidth),
    voiLUTFunction: normalizeVoiLUTFunctionAsArray(VOILUTFunction),
  };
}

function xnatVoiLutModuleProvider(type: string, imageId: string) {
  if (type !== 'voiLutModule' || typeof imageId !== 'string' || !imageId) {
    return undefined;
  }

  const instance = metadataProvider.get('instance', imageId) as
    | Record<string, unknown>
    | undefined;
  if (!instance) {
    return undefined;
  }

  return buildVoiLutModule(instance);
}

function onImageLoaded(event: { detail?: { image?: { voiLUTFunction?: unknown } } }) {
  const image = event.detail?.image;
  if (!image || !('voiLUTFunction' in image)) {
    return;
  }
  image.voiLUTFunction = normalizeVoiLUTFunction(image.voiLUTFunction);
}

export function registerVoiLutModuleHandler(): void {
  metadataProvider.addHandler('voiLutModule', buildVoiLutModule);
  metaData.addProvider(xnatVoiLutModuleProvider, 10002);
  eventTarget.addEventListener(Enums.Events.IMAGE_LOADED, onImageLoaded);

  const proto = StackViewport.prototype as any;
  if (proto.__xnatVoiLutPatched) {
    return;
  }

  const originalGetVoiRange = proto._getVOIRangeForCurrentImage;
  if (typeof originalGetVoiRange === 'function') {
    proto._getVOIRangeForCurrentImage = function patchedGetVoiRangeForCurrentImage() {
      if (this.csImage) {
        this.csImage.voiLUTFunction = normalizeVoiLUTFunction(this.csImage.voiLUTFunction);
      }
      return originalGetVoiRange.call(this);
    };
  }

  proto.__xnatVoiLutPatched = true;
}
