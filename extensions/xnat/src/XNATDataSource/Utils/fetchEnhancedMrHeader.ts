import dcmjs from 'dcmjs';
import {
  computeMeanSliceSpacingFromPerFrameGroups,
} from './dicomMultiValue';

const { DicomMetaDictionary } = dcmjs.data;

type CornerstoneWadoWindow = Window & {
  cornerstoneWADOImageLoader?: {
    wadouri?: {
      loadFileRequest: (imageId: string) => Promise<ArrayBuffer>;
    };
  };
};

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

/** Match XNATDataSource imageId URL construction: wadoRoot + instance.url */
export function buildAbsoluteDicomInstanceUrl(instanceUrl: string, wadoRoot: string): string {
  if (/^https?:\/\//i.test(instanceUrl)) {
    return instanceUrl;
  }

  const base =
    wadoRoot || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const baseTrimmed = base.replace(/\/$/, '');
  const path = instanceUrl.startsWith('/') ? instanceUrl : `/${instanceUrl}`;
  return `${baseTrimmed}${path}`;
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

async function fetchDicomHeaderPrefix(
  absoluteUrl: string,
  requestHeaders: Record<string, string>
): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = {
    Accept: 'application/octet-stream,*/*',
    ...requestHeaders,
  };
  delete headers.Range;

  let response = await fetch(absoluteUrl, {
    method: 'GET',
    headers: { ...headers, Range: 'bytes=0-4194303' },
    credentials: 'include',
  });

  if (!response.ok && response.status !== 206) {
    response = await fetch(absoluteUrl, {
      method: 'GET',
      headers,
      credentials: 'include',
    });
  }

  if (!response.ok) {
    console.warn(
      `XNAT: DICOM header fetch failed HTTP ${response.status} ${response.statusText} for ${absoluteUrl}`
    );
    return null;
  }

  return response.arrayBuffer();
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

  const absoluteUrl = buildAbsoluteDicomInstanceUrl(instanceUrl, wadoRoot);
  const imageId = absoluteUrl.startsWith('dicomweb:') ? absoluteUrl : `dicomweb:${absoluteUrl}`;

  try {
    let buffer = await fetchDicomHeaderPrefix(absoluteUrl, requestHeaders);

    if (!buffer) {
      const loader = (typeof window !== 'undefined'
        ? (window as CornerstoneWadoWindow).cornerstoneWADOImageLoader
        : undefined)?.wadouri;
      if (loader?.loadFileRequest) {
        try {
          buffer = await loader.loadFileRequest(imageId);
        } catch (wadoError) {
          console.warn(`XNAT: wadouri header fallback failed for ${imageId}`, wadoError);
        }
      }
    }

    if (!buffer || buffer.byteLength === 0) {
      return null;
    }

    const dicomData = dcmjs.data.DicomMessage.readFile(new Uint8Array(buffer), {
      untilTag: '7FE00010',
    });
    const dataset = DicomMetaDictionary.naturalizeDataset(dicomData.dict) as Record<
      string,
      unknown
    >;

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
      console.warn(`XNAT: DICOM header parsed but no functional groups at ${absoluteUrl}`);
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
  } catch (error) {
    console.warn(`XNAT: DICOM header parse failed for ${absoluteUrl}`, error);
    return null;
  }
}
