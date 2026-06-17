import { DicomMetadataStore } from '@ohif/core';
import {
  getPerFrameImagePositionPatient,
  getPixelSpacingFromMetadata,
  getSliceThicknessFromMetadata,
  getSpacingBetweenSlicesFromMetadata,
  normalizeImageOrientationPatient,
  normalizeImagePositionPatient,
} from './XNATDataSource/Utils/dicomMultiValue';

function firstSequenceItem<T>(seq: T | T[] | undefined | null): T | undefined {
  if (seq == null) {
    return undefined;
  }
  return Array.isArray(seq) ? seq[0] : seq;
}

function toNumber(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(v => (v !== undefined ? Number(v) : v));
  }
  return val !== undefined ? Number(val) : val;
}

export function getCombinedInstanceForFrame(
  instance: Record<string, unknown>,
  frameNumber: number
): Record<string, unknown> | null {
  const numFrames = Number(instance.NumberOfFrames) || 1;
  if (numFrames < 2) {
    return instance;
  }

  const perFrame = (instance.PerFrameFunctionalGroupsSequence as Record<string, unknown>[])?.[
    frameNumber - 1
  ];
  const shared = firstSequenceItem(instance.SharedFunctionalGroupsSequence as unknown[]);

  const effectiveShared =
    shared ??
    ({
      PixelMeasuresSequence: [
        {
          PixelSpacing: getPixelSpacingFromMetadata(instance),
          SliceThickness:
            getSliceThicknessFromMetadata(instance) ?? instance.SliceThickness,
          SpacingBetweenSlices:
            getSpacingBetweenSlicesFromMetadata(instance) ?? instance.SpacingBetweenSlices,
        },
      ],
      PlaneOrientationSequence: [
        {
          ImageOrientationPatient: normalizeImageOrientationPatient(
            instance.ImageOrientationPatient
          ),
        },
      ],
    } as Record<string, unknown>);

  if (!perFrame) {
    return instance;
  }

  const pixelMeasures = firstSequenceItem(
    (effectiveShared as Record<string, unknown>).PixelMeasuresSequence as unknown[]
  );
  const planeOrient = firstSequenceItem(
    (effectiveShared as Record<string, unknown>).PlaneOrientationSequence as unknown[]
  );
  const imagePositionPatient =
    getPerFrameImagePositionPatient(instance, frameNumber - 1) ??
    normalizeImagePositionPatient(instance.ImagePositionPatient);
  const imageOrientationPatient =
    normalizeImageOrientationPatient(
      (planeOrient as Record<string, unknown>)?.ImageOrientationPatient
    ) ?? normalizeImageOrientationPatient(instance.ImageOrientationPatient);
  const pixelSpacing = getPixelSpacingFromMetadata({
    ...instance,
    PixelSpacing:
      (pixelMeasures as Record<string, unknown>)?.PixelSpacing ?? instance.PixelSpacing,
    SharedFunctionalGroupsSequence: instance.SharedFunctionalGroupsSequence,
    PerFrameFunctionalGroupsSequence: instance.PerFrameFunctionalGroupsSequence,
  });

  return {
    ...instance,
    ImagePositionPatient: imagePositionPatient,
    ImageOrientationPatient: imageOrientationPatient,
    PixelSpacing: pixelSpacing,
    FrameOfReferenceUID: instance.FrameOfReferenceUID,
    SpacingBetweenSlices:
      (pixelMeasures as Record<string, unknown>)?.SpacingBetweenSlices ??
      (pixelMeasures as Record<string, unknown>)?.SliceThickness ??
      getSpacingBetweenSlicesFromMetadata(instance) ??
      instance.SpacingBetweenSlices ??
      getSliceThicknessFromMetadata(instance) ??
      instance.SliceThickness,
  };
}

export function buildImagePlaneModuleFromInstance(
  instance: Record<string, unknown>
): Record<string, unknown> {
  const ImagePositionPatient =
    normalizeImagePositionPatient(instance.ImagePositionPatient) || [0, 0, 0];
  const ImageOrientationPatient =
    normalizeImageOrientationPatient(instance.ImageOrientationPatient) || [1, 0, 0, 0, 1, 0];
  const PixelSpacing = getPixelSpacingFromMetadata(instance);
  const rowCosines = ImageOrientationPatient.slice(0, 3);
  const columnCosines = ImageOrientationPatient.slice(3, 6);

  return {
    frameOfReferenceUID: instance.FrameOfReferenceUID ?? '',
    rows: Number(instance.Rows) || 512,
    columns: Number(instance.Columns) || 512,
    spacingBetweenSlices:
      Number(
        instance.SpacingBetweenSlices ??
          getSpacingBetweenSlicesFromMetadata(instance) ??
          instance.SliceThickness ??
          getSliceThicknessFromMetadata(instance)
      ) || 1,
    imageOrientationPatient: toNumber(ImageOrientationPatient),
    rowCosines,
    columnCosines,
    isDefaultValueSetForRowCosine: false,
    isDefaultValueSetForColumnCosine: false,
    imagePositionPatient: toNumber(ImagePositionPatient),
    sliceThickness:
      Number(getSliceThicknessFromMetadata(instance) ?? instance.SliceThickness) || 1,
    sliceLocation: instance.SliceLocation != null ? Number(instance.SliceLocation) : undefined,
    pixelSpacing: toNumber(PixelSpacing),
    rowPixelSpacing: PixelSpacing[0] != null ? Number(PixelSpacing[0]) : null,
    columnPixelSpacing: PixelSpacing[1] != null ? Number(PixelSpacing[1]) : null,
    usingDefaultValues: false,
  };
}

export function getImagePlaneModuleForImageId(imageId: string): Record<string, unknown> | undefined {
  if (!imageId) {
    return undefined;
  }

  let frameNumber = 1;
  const frameMatch = imageId.match(/[?&]frame=(\d+)/);
  if (frameMatch) {
    frameNumber = parseInt(frameMatch[1], 10) || 1;
  }

  const studyUIDs = DicomMetadataStore.getStudyInstanceUIDs?.() || [];
  for (const studyUID of studyUIDs) {
    const study = DicomMetadataStore.getStudy(studyUID);
    if (!study?.series) {
      continue;
    }

    for (const series of study.series) {
      const seriesData = DicomMetadataStore.getSeries(studyUID, series.SeriesInstanceUID);
      for (const instance of seriesData?.instances || []) {
        const url = String(instance.url || instance.imageId || '');
        const bareUrl = url.replace(/^dicomweb:/, '');
        if (!url && !instance.imageId) {
          continue;
        }
        if (
          imageId === instance.imageId ||
          imageId === url ||
          imageId.includes(bareUrl) ||
          (bareUrl && imageId.includes(bareUrl))
        ) {
          const combined = getCombinedInstanceForFrame(instance as Record<string, unknown>, frameNumber);
          if (combined) {
            return buildImagePlaneModuleFromInstance(combined);
          }
        }
      }
    }
  }

  return undefined;
}
