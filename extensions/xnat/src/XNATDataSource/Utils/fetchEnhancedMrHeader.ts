import dcmjs from 'dcmjs';
import { computeMeanSliceSpacingFromPerFrameGroups } from './dicomMultiValue';

const { DicomMetaDictionary } = dcmjs.data;

/** Enough for functional groups + tags before pixel data (7FE00010). */
const HEADER_PREFIX_BYTES = 4 * 1024 * 1024;

type EnhancedMrHeaderGeometry = {
  PerFrameFunctionalGroupsSequence?: unknown[];
  SharedFunctionalGroupsSequence?: unknown[];
  PixelSpacing?: number[];
  SpacingBetweenSlices?: number;
  SliceThickness?: number;
  ImageOrientationPatient?: number[];
  ImagePositionPatient?: number[];
  Rows?: number;
  Columns?: number;
};

/** Normalize XNAT instance.url to a site-relative path (/data/experiments/...). */
export function getInstanceResourcePath(instanceUrl: string): string {
  if (!instanceUrl) {
    return '';
  }
  if (instanceUrl.startsWith('/')) {
    return instanceUrl;
  }
  if (/^https?:\/\//i.test(instanceUrl)) {
    try {
      return new URL(instanceUrl).pathname;
    } catch {
      return instanceUrl;
    }
  }
  return `/${instanceUrl}`;
}

/** Match XNATDataSource imageId URL construction: wadoRoot + instance.url */
export function buildAbsoluteDicomInstanceUrl(instanceUrl: string, wadoRoot: string): string {
  if (/^https?:\/\//i.test(instanceUrl)) {
    return instanceUrl;
  }

  const base =
    wadoRoot || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const baseTrimmed = base.replace(/\/$/, '');
  const path = getInstanceResourcePath(instanceUrl);
  return `${baseTrimmed}${path}`;
}

/** Same imageId string used for cornerstone WADO loading in XNATDataSource/index.ts */
export function buildDicomImageId(instanceUrl: string, wadoRoot: string): string {
  const combined = /^https?:\/\//i.test(instanceUrl)
    ? instanceUrl
    : `${(wadoRoot || '').replace(/\/$/, '')}${getInstanceResourcePath(instanceUrl)}`;
  return combined.startsWith('dicomweb:') ? combined : `dicomweb:${combined}`;
}

function sanitizeAuthHeaders(requestHeaders: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  Object.entries(requestHeaders).forEach(([key, value]) => {
    const lower = key.toLowerCase();
    if (
      lower === 'accept' ||
      lower === 'range' ||
      lower === 'content-type' ||
      lower === 'withcredentials'
    ) {
      return;
    }
    if (value == null || value === '') {
      return;
    }
    headers[key] = String(value);
  });

  if (!headers['X-XNAT-CSRF'] && typeof document !== 'undefined') {
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    if (match?.[1]) {
      headers['X-XNAT-CSRF'] = decodeURIComponent(match[1]);
    }
  }

  return headers;
}

function loadArrayBufferViaXhr(
  url: string,
  authHeaders: Record<string, string>,
  useRange: boolean,
  options: { quiet?: boolean } = {}
): Promise<ArrayBuffer | null> {
  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.withCredentials = true;
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Accept', 'application/octet-stream,*/*');
    if (useRange) {
      xhr.setRequestHeader('Range', `bytes=0-${HEADER_PREFIX_BYTES - 1}`);
    }
    Object.entries(authHeaders).forEach(([key, value]) => {
      try {
        xhr.setRequestHeader(key, value);
      } catch {
        // Ignore forbidden or duplicate headers.
      }
    });

    xhr.onload = () => {
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 206) {
        resolve(xhr.response);
        return;
      }
      if (!options.quiet) {
        console.warn(`XNAT: XHR DICOM header fetch HTTP ${xhr.status} for ${url}`);
      }
      resolve(null);
    };
    xhr.onerror = () => {
      if (!options.quiet) {
        console.warn(`XNAT: XHR DICOM header fetch network error for ${url}`);
      }
      resolve(null);
    };
    xhr.send();
  });
}

function trimToHeaderPrefix(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength <= HEADER_PREFIX_BYTES) {
    return buffer;
  }
  return buffer.slice(0, HEADER_PREFIX_BYTES);
}

type CornerstoneWadoWindow = Window & {
  cornerstoneWADOImageLoader?: {
    wadouri?: {
      loadFileRequest: (imageId: string) => Promise<ArrayBuffer>;
    };
  };
};

async function loadDicomHeaderBuffer(
  instanceUrl: string,
  wadoRoot: string,
  requestHeaders: Record<string, string>
): Promise<ArrayBuffer | null> {
  const authHeaders = sanitizeAuthHeaders(requestHeaders);
  const resourcePath = getInstanceResourcePath(instanceUrl);
  const absoluteUrl = buildAbsoluteDicomInstanceUrl(instanceUrl, wadoRoot);
  const imageId = buildDicomImageId(instanceUrl, wadoRoot);

  const xhrUrls = [absoluteUrl, resourcePath].filter(
    (url, index, all) => url && all.indexOf(url) === index
  );

  const failedAttempts: string[] = [];

  for (const url of xhrUrls) {
    for (const useRange of [false, true]) {
      const label = `${url}${useRange ? ' [range]' : ''}`;
      const buffer = await loadArrayBufferViaXhr(url, authHeaders, useRange, { quiet: true });
      if (buffer?.byteLength) {
        return trimToHeaderPrefix(buffer);
      }
      failedAttempts.push(label);
    }
  }

  const loader = (typeof window !== 'undefined'
    ? (window as CornerstoneWadoWindow).cornerstoneWADOImageLoader
    : undefined)?.wadouri;
  if (loader?.loadFileRequest) {
    for (const candidateId of [imageId, `dicomweb:${resourcePath}`]) {
      try {
        const buffer = await loader.loadFileRequest(candidateId);
        if (buffer?.byteLength) {
          return trimToHeaderPrefix(buffer);
        }
        failedAttempts.push(`wadouri:${candidateId}`);
      } catch {
        failedAttempts.push(`wadouri:${candidateId}`);
      }
    }
  }

  try {
    const response = await fetch(absoluteUrl, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream,*/*', ...authHeaders },
      credentials: 'include',
    });
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength) {
        return trimToHeaderPrefix(buffer);
      }
    }
    failedAttempts.push(`fetch HTTP ${response.status}`);
  } catch {
    failedAttempts.push('fetch network error');
  }

  console.warn(
    `XNAT: could not fetch DICOM header prefix for ${resourcePath || instanceUrl} (${failedAttempts.join('; ')})`
  );
  return null;
}

function readPixelSpacingFromFunctionalGroups(meta: Record<string, unknown>): number[] | undefined {
  const shared = (meta.SharedFunctionalGroupsSequence as Record<string, unknown>[])?.[0];
  const sharedMeasures = (shared?.PixelMeasuresSequence as Record<string, unknown>[])?.[0];
  const pixelSpacing = sharedMeasures?.PixelSpacing;
  if (Array.isArray(pixelSpacing) && pixelSpacing.length === 2) {
    return pixelSpacing.map(Number);
  }

  const perFrame = (meta.PerFrameFunctionalGroupsSequence as Record<string, unknown>[])?.[0];
  const perFrameMeasures = (perFrame?.PixelMeasuresSequence as Record<string, unknown>[])?.[0];
  const perFrameSpacing = perFrameMeasures?.PixelSpacing;
  if (Array.isArray(perFrameSpacing) && perFrameSpacing.length === 2) {
    return perFrameSpacing.map(Number);
  }

  return undefined;
}

function parseDicomHeaderGeometry(
  buffer: ArrayBuffer,
  sourceLabel: string
): EnhancedMrHeaderGeometry | null {
  const dicomData = dcmjs.data.DicomMessage.readFile(new Uint8Array(buffer), {
    untilTag: '7FE00010',
  });
  const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict) as Record<string, unknown>;

  const pixelSpacing = readPixelSpacingFromFunctionalGroups(dataset);
  const shared = (dataset.SharedFunctionalGroupsSequence as Record<string, unknown>[])?.[0];
  const sharedMeasures = (shared?.PixelMeasuresSequence as Record<string, unknown>[])?.[0];
  const planeOrientation = (shared?.PlaneOrientationSequence as Record<string, unknown>[])?.[0];
  const firstFrame = (dataset.PerFrameFunctionalGroupsSequence as Record<string, unknown>[])?.[0];
  const planePosition = (firstFrame?.PlanePositionSequence as Record<string, unknown>[])?.[0];

  let spacingBetweenSlices =
    sharedMeasures?.SpacingBetweenSlices != null
      ? Number(sharedMeasures.SpacingBetweenSlices)
      : sharedMeasures?.SliceThickness != null
        ? Number(sharedMeasures.SliceThickness)
        : undefined;

  const computedSpacing = computeMeanSliceSpacingFromPerFrameGroups({
    NumberOfFrames: dataset.NumberOfFrames,
    PerFrameFunctionalGroupsSequence: dataset.PerFrameFunctionalGroupsSequence,
  });
  if (computedSpacing != null && computedSpacing > 0) {
    spacingBetweenSlices = computedSpacing;
  }

  const perFrameGroups = dataset.PerFrameFunctionalGroupsSequence as unknown[] | undefined;
  if (!perFrameGroups?.length && !pixelSpacing) {
    console.warn(`XNAT: DICOM header parsed but no functional groups at ${sourceLabel}`);
    return null;
  }

  return {
    PerFrameFunctionalGroupsSequence: perFrameGroups,
    SharedFunctionalGroupsSequence: dataset.SharedFunctionalGroupsSequence as unknown[],
    PixelSpacing: pixelSpacing,
    SpacingBetweenSlices: spacingBetweenSlices,
    SliceThickness:
      sharedMeasures?.SliceThickness != null
        ? Number(sharedMeasures.SliceThickness)
        : computedSpacing,
    ImageOrientationPatient: Array.isArray(planeOrientation?.ImageOrientationPatient)
      ? (planeOrientation.ImageOrientationPatient as number[]).map(Number)
      : undefined,
    ImagePositionPatient: Array.isArray(planePosition?.ImagePositionPatient)
      ? (planePosition.ImagePositionPatient as number[]).map(Number)
      : undefined,
    Rows: dataset.Rows != null ? Number(dataset.Rows) : undefined,
    Columns: dataset.Columns != null ? Number(dataset.Columns) : undefined,
  };
}

/**
 * Read Enhanced MR geometry from the DICOM header prefix (before pixel data).
 * Used when XNAT JSON metadata lacks functional groups or has placeholder spacing.
 */
export async function fetchEnhancedMrHeaderGeometry(
  instanceUrl: string,
  wadoRoot: string,
  requestHeaders: Record<string, string> = {}
): Promise<EnhancedMrHeaderGeometry | null> {
  if (!instanceUrl) {
    return null;
  }

  const sourceLabel = getInstanceResourcePath(instanceUrl) || instanceUrl;

  const buffer = await loadDicomHeaderBuffer(instanceUrl, wadoRoot, requestHeaders);
  if (!buffer?.byteLength) {
    return null;
  }

  try {
    return parseDicomHeaderGeometry(buffer, sourceLabel);
  } catch (error) {
    console.warn(`XNAT: DICOM header parse failed for ${sourceLabel}`, error);
    return null;
  }
}
