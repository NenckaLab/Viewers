/**
 * Re-register wadouri/dicomweb loaders onto the legacy dicomParser path.
 *
 * Cornerstone 5.x defaults to loadImageFromNaturalizedMetadata, which parses
 * Part 10 via dcmjs AsyncDicomReader. That reader hits EOF inside sequences
 * ("Finding view is past end of input") on many XNAT-served instances and
 * fails every thumbnail/image load.
 *
 * The legacy loadImage path uses dicom-parser and is what worked previously.
 *
 * Do not register this module's wadouri.loadImage onto the viewer's
 * imageLoader. XNAT depends on @cornerstonejs/core 5.1.3 while the app uses
 * 5.6.12; that loadImage decodes via getWebWorkerManager() from the 5.1 copy,
 * where the 'dicomImageLoader' worker was never registered. The viewer already
 * inits its own dicom-image-loader with useLegacyMetadataProvider.
 */
import { imageLoader, metaData } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import {
  wrapLoadImageNormalizeVoiLut,
  wrapVoiLutMetaDataProvider,
  type CornerstoneCoreLike,
} from './registerVoiLutModuleHandler';

const SCHEMES = ['dicomweb', 'wadouri', 'dicomfile'] as const;

type ParsedImageId = {
  scheme: string;
  url: string;
  frame?: number;
  pixelDataFrame?: number;
};

type WadoUriNamespace = {
  loadImage: (imageId: string, options?: any) => any;
  loadImageFromPromise?: (
    dataSetPromise: any,
    imageId: string,
    frame?: number,
    sharedCacheKey?: string,
    options?: any,
    callbacks?: any
  ) => any;
  parseImageId?: (imageId: string) => ParsedImageId;
  dataSetCacheManager?: {
    isLoaded: (uri: string) => boolean;
    load: (uri: string, loader: any, imageId: string) => Promise<unknown>;
    get: (uri: string, loader?: any, imageId?: string) => unknown;
    unload: (uri: string) => void;
  };
  getLoaderForScheme?: (scheme: string) => any;
};

/**
 * Work around an upstream bug in @cornerstonejs/dicom-image-loader (2.x):
 * wadouri loadImage passes the raw 1-based `frame` from `&frame=N` to
 * getPixelData (which expects a 0-based index) on the uncached path.
 * The cached path correctly uses `pixelDataFrame`.
 *
 * Fix by mirroring stock loadImage but always passing the 0-based index —
 * same network/parse cost as upstream, no extra pre-load hop.
 */
export function wrapWadoUriLoadImage(wadouri: WadoUriNamespace) {
  const {
    loadImage,
    loadImageFromPromise,
    parseImageId,
    dataSetCacheManager,
    getLoaderForScheme,
  } = wadouri;

  if (!parseImageId || !dataSetCacheManager || !getLoaderForScheme || !loadImageFromPromise) {
    return loadImage;
  }

  return function frameSafeLoadImage(imageId: string, options: any = {}) {
    let parsed: ParsedImageId;
    try {
      parsed = parseImageId(imageId);
    } catch {
      return loadImage(imageId, options);
    }

    const opts = { ...options };
    delete opts.loader;

    const schemeLoader = getLoaderForScheme(parsed.scheme);
    // pixelDataFrame is already 0-based; single-frame imageIds leave it undefined.
    const frameIndex =
      typeof parsed.pixelDataFrame === 'number' && !Number.isNaN(parsed.pixelDataFrame)
        ? parsed.pixelDataFrame
        : 0;

    if (dataSetCacheManager.isLoaded(parsed.url)) {
      // Cached path in stock loadImage already uses pixelDataFrame.
      return loadImage(imageId, options);
    }

    const dataSetPromise = dataSetCacheManager.load(parsed.url, schemeLoader, imageId);
    return loadImageFromPromise(dataSetPromise, imageId, frameIndex, parsed.url, opts);
  };
}

export function registerLegacyWadoUriLoaders(cs?: CornerstoneCoreLike): void {
  const wadouri = dicomImageLoader?.wadouri;
  const loadImage = wadouri?.loadImage;
  const metaDataProvider = wadouri?.metaData?.metaDataProvider;
  if (typeof loadImage !== 'function') {
    console.warn('XNAT: legacy wadouri.loadImage unavailable; cannot leave naturalized loader');
    return;
  }

  const frameSafeLoadImage = wrapLoadImageNormalizeVoiLut(
    wrapWadoUriLoadImage(wadouri as WadoUriNamespace)
  );

  const httpLoadImage = (imageId: string, options?: any) =>
    frameSafeLoadImage(`dicomweb:${imageId}`, options);

  const voiSafeMetaDataProvider =
    typeof metaDataProvider === 'function'
      ? wrapVoiLutMetaDataProvider(metaDataProvider)
      : undefined;

  const targets: Array<{
    imageLoaderNs: { registerImageLoader: (scheme: string, loader: typeof frameSafeLoadImage) => void };
    metaDataNs: {
      addProvider: (provider: typeof voiSafeMetaDataProvider, priority?: number) => void;
      removeProvider?: (provider: typeof voiSafeMetaDataProvider) => void;
    };
  }> = [
    {
      imageLoaderNs: imageLoader as { registerImageLoader: (scheme: string, loader: typeof frameSafeLoadImage) => void },
      metaDataNs: metaData as {
        addProvider: (provider: typeof voiSafeMetaDataProvider, priority?: number) => void;
        removeProvider?: (provider: typeof voiSafeMetaDataProvider) => void;
      },
    },
  ];

  // Same-module only. Installing this wadouri.loadImage on the viewer's
  // imageLoader makes createImage/decodeImageFrame use a worker manager that
  // never registered 'dicomImageLoader' (executeTask requestFn throws).
  if (cs?.imageLoader && cs.imageLoader === imageLoader) {
    targets.push({
      imageLoaderNs: cs.imageLoader as (typeof targets)[number]['imageLoaderNs'],
      metaDataNs: (cs.metaData ?? metaData) as (typeof targets)[number]['metaDataNs'],
    });
  } else if (cs?.metaData && voiSafeMetaDataProvider && typeof metaDataProvider === 'function') {
    cs.metaData.removeProvider?.(voiSafeMetaDataProvider);
    cs.metaData.addProvider(voiSafeMetaDataProvider, 10003);
  }

  for (const { imageLoaderNs, metaDataNs } of targets) {
    for (const scheme of SCHEMES) {
      imageLoaderNs.registerImageLoader(scheme, frameSafeLoadImage);
    }
    // Safety net: some XNAT metadata paths store scheme-less http(s) URLs that can
    // leak into imageIds (e.g. volume VOI computation loading the middle slice).
    imageLoaderNs.registerImageLoader('http', httpLoadImage);
    imageLoaderNs.registerImageLoader('https', httpLoadImage);

    if (voiSafeMetaDataProvider && typeof metaDataProvider === 'function') {
      metaDataNs.removeProvider?.(voiSafeMetaDataProvider);
      // voiLutModule only — do not shadow imagePlaneModule / frame providers.
      metaDataNs.addProvider(voiSafeMetaDataProvider, 10003);
      metaDataNs.addProvider(metaDataProvider);
    }
  }

  console.info(
    'XNAT: registered legacy wadouri/dicomweb image loaders (dicomParser; skips AsyncDicomReader)'
  );
}
