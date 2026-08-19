/**
 * Prevents Cornerstone "Invalid VOI LUT function" crashes.
 *
 * dicom-image-loader createImage indexes `voiLUTFunction[0]`. wadouri metadata
 * supplies a string ("LINEAR"), so that becomes "L" and toLowHighRange throws
 * during StackViewport / loadImageToCanvas thumbnail render.
 *
 * Register from preRegistration so this runs before images load. Also wrap the
 * wadouri metadata provider and loadImage promise (legacy loaders) so the image
 * object itself is valid before any viewport copy sees it.
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

type CornerstoneCoreLike = {
  StackViewport?: { prototype?: object };
  eventTarget?: {
    addEventListener: (type: string, callback: (event: unknown) => void) => void;
  };
  metaData?: {
    addProvider: (
      provider: (type: string, imageId: string, options?: unknown) => unknown,
      priority?: number
    ) => void;
    removeProvider?: (
      provider: (type: string, imageId: string, options?: unknown) => unknown
    ) => void;
  };
  imageLoader?: {
    registerImageLoader: (
      scheme: string,
      loader: (imageId: string, options?: unknown) => unknown
    ) => void;
  };
  utilities?: {
    windowLevel?: {
      toLowHighRange?: (...args: unknown[]) => unknown;
      __xnatVoiLutPatched?: boolean;
    };
  };
  Enums?: { Events?: { IMAGE_LOADED?: string } };
};

type ExtensionManagerLike = {
  getModuleEntry?: (id: string) =>
    | {
        exports?: {
          getCornerstoneLibraries?: () => { cornerstone?: CornerstoneCoreLike };
        };
      }
    | undefined;
};

/** The @cornerstonejs/core instance the viewer actually renders with (not XNAT's 5.1.3 copy). */
export function getAppCornerstone(
  extensionManager?: ExtensionManagerLike
): CornerstoneCoreLike | undefined {
  return extensionManager
    ?.getModuleEntry?.('@ohif/extension-cornerstone.utilityModule.common')
    ?.exports?.getCornerstoneLibraries?.()?.cornerstone;
}

const VALID_VOI_LUT_FUNCTIONS = new Set(['LINEAR', 'SIGMOID', 'LINEAR_EXACT']);
const wrappedMetaDataProviders = new WeakMap<Function, Function>();

/** Normalize to a value toLowHighRange accepts, or undefined (defaults to LINEAR). */
export function normalizeVoiLUTFunction(value: unknown): string | undefined {
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

export function normalizeVoiLUTFunctionAsArray(value: unknown): string[] | undefined {
  const normalized = normalizeVoiLUTFunction(value);
  return normalized ? [normalized] : undefined;
}

export function normalizeVoiLutOnImage(image: { voiLUTFunction?: unknown } | null | undefined): void {
  if (!image || typeof image !== 'object') {
    return;
  }
  image.voiLUTFunction = normalizeVoiLUTFunction(image.voiLUTFunction);
}

/** Make wadouri voiLutModule return an array so createImage[0] is "LINEAR", not "L". */
export function wrapVoiLutMetaDataProvider(
  original: (type: string, imageId: string, options?: unknown) => any
): (type: string, imageId: string, options?: unknown) => any {
  const existing = wrappedMetaDataProviders.get(original);
  if (existing) {
    return existing as (type: string, imageId: string, options?: unknown) => any;
  }

  const wrapped = function wrappedVoiLutMetaDataProvider(
    type: string,
    imageId: string,
    options?: unknown
  ) {
    if (type !== 'voiLutModule') {
      return undefined;
    }
    const result = original(type, imageId, options);
    if (result && result.voiLUTFunction != null) {
      result.voiLUTFunction = normalizeVoiLUTFunctionAsArray(result.voiLUTFunction);
    }
    return result;
  };

  wrappedMetaDataProviders.set(original, wrapped);
  return wrapped;
}

/** Normalize voiLUTFunction on the image after decode, before thumbnail/viewport render. */
export function wrapLoadImageNormalizeVoiLut<T extends (imageId: string, options?: any) => any>(
  loadImageFn: T
): T {
  return function wrappedLoadImageNormalizeVoiLut(imageId: string, options?: any) {
    const loadObject = loadImageFn(imageId, options);
    if (!loadObject?.promise?.then) {
      return loadObject;
    }
    loadObject.promise = loadObject.promise.then((image: { voiLUTFunction?: unknown }) => {
      normalizeVoiLutOnImage(image);
      return image;
    });
    return loadObject;
  } as T;
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

function xnatVoiLutModuleProvider(type: string, imageId: string, _options?: unknown) {
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

function onImageLoaded(event: unknown) {
  const image = (event as { detail?: { image?: { voiLUTFunction?: unknown } } })?.detail?.image;
  normalizeVoiLutOnImage(image);
}

function patchStackViewportPrototype(StackViewportClass: { prototype?: object } | undefined): void {
  type ViewportProto = {
    __xnatVoiLutPatched?: boolean;
    _getVOIRangeForCurrentImage?: () => unknown;
    _updateActorToDisplayImageId?: (image?: { voiLUTFunction?: unknown }) => unknown;
    _getInitialVOIRange?: (image?: { voiLUTFunction?: unknown }) => unknown;
  };
  const proto = StackViewportClass?.prototype as ViewportProto | undefined;
  if (!proto || proto.__xnatVoiLutPatched) {
    return;
  }

  const originalGetVoiRange = proto._getVOIRangeForCurrentImage;
  if (typeof originalGetVoiRange === 'function') {
    proto._getVOIRangeForCurrentImage = function patchedGetVoiRangeForCurrentImage() {
      const viewport = this as { csImage?: { voiLUTFunction?: unknown } };
      normalizeVoiLutOnImage(viewport.csImage);
      try {
        return originalGetVoiRange.call(this);
      } catch {
        if (viewport.csImage) {
          viewport.csImage.voiLUTFunction = 'LINEAR';
        }
        return originalGetVoiRange.call(this);
      }
    };
  }

  const originalUpdateActor = proto._updateActorToDisplayImageId;
  if (typeof originalUpdateActor === 'function') {
    proto._updateActorToDisplayImageId = function patchedUpdateActorToDisplayImageId(image) {
      const viewport = this as { csImage?: { voiLUTFunction?: unknown } };
      normalizeVoiLutOnImage(image);
      normalizeVoiLutOnImage(viewport.csImage);
      return originalUpdateActor.call(this, image);
    };
  }

  const originalInitialVoi = proto._getInitialVOIRange;
  if (typeof originalInitialVoi === 'function') {
    proto._getInitialVOIRange = function patchedGetInitialVOIRange(image) {
      normalizeVoiLutOnImage(image);
      return originalInitialVoi.call(this, image);
    };
  }

  proto.__xnatVoiLutPatched = true;
}

function applyVoiLutPatches(core: CornerstoneCoreLike | undefined): void {
  if (!core) {
    return;
  }
  try {
    core.metaData?.addProvider(
      xnatVoiLutModuleProvider as (type: string, imageId: string, options?: unknown) => unknown,
      10002
    );
  } catch (error) {
    console.warn('XNAT: voiLutModule provider registration failed', error);
  }
  try {
    const imageLoaded = core.Enums?.Events?.IMAGE_LOADED ?? Enums.Events.IMAGE_LOADED;
    core.eventTarget?.addEventListener(imageLoaded, onImageLoaded);
  } catch (error) {
    console.warn('XNAT: IMAGE_LOADED listener registration failed', error);
  }
  try {
    patchStackViewportPrototype(core.StackViewport);
  } catch (error) {
    console.warn('XNAT: StackViewport VOI LUT patch failed', error);
  }
}

export type { CornerstoneCoreLike };

export function registerVoiLutModuleHandler(cs?: CornerstoneCoreLike): void {
  metadataProvider.addHandler('voiLutModule', buildVoiLutModule);

  applyVoiLutPatches({
    StackViewport,
    eventTarget,
    metaData,
    Enums,
  } as CornerstoneCoreLike);
  applyVoiLutPatches(cs);
}
