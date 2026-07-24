/**
 * Re-register wadouri/dicomweb loaders onto the legacy dicomParser path.
 *
 * Cornerstone 5.x defaults to loadImageFromNaturalizedMetadata, which parses
 * Part 10 via dcmjs AsyncDicomReader. That reader hits EOF inside sequences
 * ("Finding view is past end of input") on many XNAT-served instances and
 * fails every thumbnail/image load.
 *
 * The legacy loadImage path uses dicom-parser and is what worked previously.
 */
import { imageLoader, metaData } from '@cornerstonejs/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

const SCHEMES = ['dicomweb', 'wadouri', 'dicomfile'] as const;

export function registerLegacyWadoUriLoaders(): void {
  const wadouri = dicomImageLoader?.wadouri;
  const loadImage = wadouri?.loadImage;
  const metaDataProvider = wadouri?.metaData?.metaDataProvider;

  if (typeof loadImage !== 'function') {
    console.warn('XNAT: legacy wadouri.loadImage unavailable; cannot leave naturalized loader');
    return;
  }

  for (const scheme of SCHEMES) {
    imageLoader.registerImageLoader(scheme, loadImage);
  }

  if (typeof metaDataProvider === 'function') {
    metaData.addProvider(metaDataProvider);
  }

  console.info(
    'XNAT: registered legacy wadouri/dicomweb image loaders (dicomParser; skips AsyncDicomReader)'
  );
}
