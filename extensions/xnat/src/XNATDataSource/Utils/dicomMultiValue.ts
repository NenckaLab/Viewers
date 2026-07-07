export const ENHANCED_MR_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.4.1';

function firstSequenceItem<T>(seq: T | T[] | undefined | null): T | undefined {
  if (seq == null) {
    return undefined;
  }
  return Array.isArray(seq) ? seq[0] : seq;
}

function getSharedPixelMeasures(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const shared = firstSequenceItem(meta.SharedFunctionalGroupsSequence as unknown[]);
  return firstSequenceItem(
    (shared as Record<string, unknown>)?.PixelMeasuresSequence as unknown[]
  ) as Record<string, unknown> | undefined;
}

/**
 * Normalize DICOM multi-value DS fields that may arrive as arrays, backslash-separated
 * strings, or single numbers from the XNAT JSON API.
 */
export function normalizeDicomMultiValue(
  raw: unknown,
  expectedLength?: number
): number[] | undefined {
  if (raw == null) {
    return undefined;
  }

  let values: number[];
  if (typeof raw === 'string') {
    values = raw.split('\\').map(v => Number(v.trim()));
  } else if (Array.isArray(raw)) {
    values = raw.map(v => Number(v));
  } else if (typeof raw === 'number') {
    values = [raw];
  } else {
    return undefined;
  }

  values = values.filter(v => !Number.isNaN(v));
  if (values.length === 0) {
    return undefined;
  }
  if (expectedLength != null && values.length !== expectedLength) {
    return undefined;
  }
  return values;
}

function readPixelSpacingFromFunctionalGroups(meta: Record<string, unknown>): number[] | undefined {
  const sharedMeasures = getSharedPixelMeasures(meta);
  const fromShared = normalizeDicomMultiValue(sharedMeasures?.PixelSpacing, 2);
  if (fromShared) {
    return fromShared;
  }

  const perFrame = (meta.PerFrameFunctionalGroupsSequence as Record<string, unknown>[])?.[0];
  const perFrameMeasures = firstSequenceItem(perFrame?.PixelMeasuresSequence as unknown[]);
  return normalizeDicomMultiValue(
    (perFrameMeasures as Record<string, unknown>)?.PixelSpacing,
    2
  );
}

/**
 * Resolve in-plane pixel spacing from instance metadata, including Enhanced MR
 * functional groups when the top-level tag is absent.
 */
export function getPixelSpacingFromMetadata(
  meta: Record<string, unknown> | undefined,
  fallback: number[] = [1, 1]
): number[] {
  if (!meta) {
    return fallback;
  }

  return (
    normalizeDicomMultiValue(meta.PixelSpacing, 2) ||
    readPixelSpacingFromFunctionalGroups(meta) ||
    fallback
  );
}

export function normalizeImagePositionPatient(raw: unknown): number[] | undefined {
  return normalizeDicomMultiValue(raw, 3);
}

export function normalizeImageOrientationPatient(raw: unknown): number[] | undefined {
  const values = normalizeDicomMultiValue(raw, 6);
  if (!values) {
    return undefined;
  }

  return values.map(v => {
    if (Math.abs(v) < 1e-12) {
      return 0;
    }
    return Math.round(v * 1e5) / 1e5;
  });
}

export function getSliceThicknessFromMetadata(
  meta: Record<string, unknown> | undefined
): number | undefined {
  if (!meta) {
    return undefined;
  }
  const topLevel = meta.SliceThickness;
  if (topLevel != null && !Number.isNaN(Number(topLevel)) && Number(topLevel) > 0) {
    return Number(topLevel);
  }
  const sharedMeasures = getSharedPixelMeasures(meta);
  const fromShared = sharedMeasures?.SliceThickness;
  if (fromShared != null && !Number.isNaN(Number(fromShared)) && Number(fromShared) > 0) {
    return Number(fromShared);
  }
  return undefined;
}

export function getSpacingBetweenSlicesFromMetadata(
  meta: Record<string, unknown> | undefined
): number | undefined {
  if (!meta) {
    return undefined;
  }
  const topLevel = meta.SpacingBetweenSlices;
  if (topLevel != null && !Number.isNaN(Number(topLevel)) && Number(topLevel) > 0) {
    return Number(topLevel);
  }
  const sharedMeasures = getSharedPixelMeasures(meta);
  const fromShared =
    sharedMeasures?.SpacingBetweenSlices ?? sharedMeasures?.SliceThickness;
  if (fromShared != null && !Number.isNaN(Number(fromShared)) && Number(fromShared) > 0) {
    return Number(fromShared);
  }
  return getSliceThicknessFromMetadata(meta);
}

export function getPerFrameImagePositionPatient(
  meta: Record<string, unknown>,
  frameIndex: number
): number[] | undefined {
  const perFrame = (meta.PerFrameFunctionalGroupsSequence as Record<string, unknown>[])?.[
    frameIndex
  ];
  if (!perFrame) {
    return undefined;
  }
  const planePos = firstSequenceItem(perFrame.PlanePositionSequence as unknown[]);
  return normalizeImagePositionPatient(
    (planePos as Record<string, unknown>)?.ImagePositionPatient
  );
}

/** Mean distance between first and last frame IPPs divided by (frames - 1). */
export function computeMeanSliceSpacingFromPerFrameGroups(
  meta: Record<string, unknown>
): number | undefined {
  const numFrames = Number(meta.NumberOfFrames) || 0;
  const perFrame = meta.PerFrameFunctionalGroupsSequence as unknown[] | undefined;
  if (!perFrame || perFrame.length < 2 || numFrames < 2) {
    return undefined;
  }

  const first = getPerFrameImagePositionPatient(meta, 0);
  const lastIndex = Math.min(numFrames, perFrame.length) - 1;
  const last = getPerFrameImagePositionPatient(meta, lastIndex);
  if (!first || !last || lastIndex < 1) {
    return undefined;
  }

  const distance = Math.hypot(
    last[0] - first[0],
    last[1] - first[1],
    last[2] - first[2]
  );
  return distance / lastIndex;
}

export function isEnhancedMultiFrameInstance(meta: Record<string, unknown>): boolean {
  const numFrames = Number(meta.NumberOfFrames) || 1;
  if (numFrames < 2) {
    return false;
  }
  const sopClassUID = String(meta.SOPClassUID || '');
  if (sopClassUID === ENHANCED_MR_SOP_CLASS_UID) {
    return true;
  }
  return String(meta.Modality || meta.modality || '') === 'MR';
}

/**
 * Detect per-frame positions generated by the inPlaneSpacing * 2.5 fallback
 * (e.g. 1.2 * 2.5 = 3 mm) instead of real DICOM functional groups.
 */
export function isLikelySyntheticPerFrameGeometry(meta: Record<string, unknown>): boolean {
  const computed = computeMeanSliceSpacingFromPerFrameGroups(meta);
  if (computed == null) {
    return false;
  }

  const pixelSpacing = getPixelSpacingFromMetadata(meta);
  const inPlaneSpacing = Math.max(Number(pixelSpacing[0]) || 1, Number(pixelSpacing[1]) || 1);
  const syntheticGuess = inPlaneSpacing * 2.5;
  if (Math.abs(computed - syntheticGuess) < 0.05) {
    return true;
  }

  const expected =
    getSpacingBetweenSlicesFromMetadata(meta) ?? getSliceThicknessFromMetadata(meta);
  if (expected != null && expected > 0) {
    const ratio = computed / expected;
    return ratio < 0.75 || ratio > 1.25;
  }

  return false;
}

/**
 * Resolve through-plane spacing for multiframe volumes. Rejects the Java/session JSON
 * placeholder of 1.0 mm when in-plane spacing indicates thicker slices (common for DWI).
 */
export function resolveThroughPlaneSpacing(meta: Record<string, unknown>): number {
  const pixelSpacing = getPixelSpacingFromMetadata(meta);
  const inPlaneSpacing = Math.max(Number(pixelSpacing[0]) || 1, Number(pixelSpacing[1]) || 1);
  const sliceThickness =
    getSliceThicknessFromMetadata(meta) ??
    (meta.SliceThickness != null ? Number(meta.SliceThickness) : 0);
  const spacingBetweenSlices =
    getSpacingBetweenSlicesFromMetadata(meta) ??
    (meta.SpacingBetweenSlices != null ? Number(meta.SpacingBetweenSlices) : undefined);

  const candidate =
    spacingBetweenSlices != null && spacingBetweenSlices > 0
      ? spacingBetweenSlices
      : sliceThickness > 0
        ? sliceThickness
        : undefined;

  if (candidate != null && candidate > 0) {
    // Session JSON defaults to 1.0 when DICOM functional groups are not exported.
    if (candidate <= 1.01 && inPlaneSpacing > candidate * 1.5) {
      return inPlaneSpacing * 2.5;
    }
    if (candidate >= inPlaneSpacing * 0.5) {
      return candidate;
    }
  }

  return inPlaneSpacing * 2.5;
}

export function buildSyntheticPerFrameFunctionalGroups(meta: Record<string, unknown>): {
  perFrame: Record<string, unknown>[];
  shared: Record<string, unknown>[];
} {
  const numFrames = Number(meta.NumberOfFrames) || 1;
  const origin = normalizeImagePositionPatient(meta.ImagePositionPatient) || [0, 0, 0];
  const orientation =
    normalizeImageOrientationPatient(meta.ImageOrientationPatient) || [1, 0, 0, 0, 1, 0];
  const pixelSpacing = getPixelSpacingFromMetadata(meta);
  const spacing = resolveThroughPlaneSpacing(meta);

  const rowDir = orientation.slice(0, 3);
  const colDir = orientation.slice(3, 6);
  const normal = [
    rowDir[1] * colDir[2] - rowDir[2] * colDir[1],
    rowDir[2] * colDir[0] - rowDir[0] * colDir[2],
    rowDir[0] * colDir[1] - rowDir[1] * colDir[0],
  ];
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

  const perFrame: Record<string, unknown>[] = [];
  for (let f = 0; f < numFrames; f++) {
    perFrame.push({
      PlanePositionSequence: [
        {
          ImagePositionPatient: [
            round6(origin[0] + normal[0] * spacing * f),
            round6(origin[1] + normal[1] * spacing * f),
            round6(origin[2] + normal[2] * spacing * f),
          ],
        },
      ],
    });
  }

  const shared = [
    {
      PixelMeasuresSequence: [
        {
          PixelSpacing: pixelSpacing,
          SliceThickness: spacing,
          SpacingBetweenSlices: spacing,
        },
      ],
      PlaneOrientationSequence: [{ ImageOrientationPatient: orientation }],
    },
  ];

  return { perFrame, shared };
}

/**
 * True when per-frame functional groups are present and their mean spacing
 * matches session/header spacing (not a synthetic repair guess).
 */
export function hasValidMultiframePerFrameGeometry(meta: Record<string, unknown>): boolean {
  if (!meta.PerFrameFunctionalGroupsSequence) {
    return false;
  }

  const computed = computeMeanSliceSpacingFromPerFrameGroups(meta);
  if (computed == null || computed <= 0 || Number.isNaN(computed)) {
    return false;
  }

  return !isLikelySyntheticPerFrameGeometry(meta);
}

/**
 * True when XNAT session JSON already has plausible through-plane spacing
 * (not the default 1.0 mm placeholder on thick-slice acquisitions).
 */
export function hasTrustworthySessionMultiframeSpacing(
  meta: Record<string, unknown> | undefined
): boolean {
  if (!meta) {
    return false;
  }

  const numFrames = Number(meta.NumberOfFrames) || 1;
  const sopClassUID = String(meta.SOPClassUID || '');
  if (numFrames > 1 && sopClassUID === ENHANCED_MR_SOP_CLASS_UID) {
    // Enhanced MR slice positions live in per-frame groups; top-level spacing alone
    // is not enough to trust without validated per-frame geometry.
    if (!hasValidMultiframePerFrameGeometry(meta)) {
      return false;
    }
  }

  const pixelSpacing = getPixelSpacingFromMetadata(meta);
  const inPlaneSpacing = Math.max(Number(pixelSpacing[0]) || 1, Number(pixelSpacing[1]) || 1);
  const spacing =
    getSpacingBetweenSlicesFromMetadata(meta) ??
    getSliceThicknessFromMetadata(meta) ??
    (meta.SpacingBetweenSlices != null ? Number(meta.SpacingBetweenSlices) : undefined) ??
    (meta.SliceThickness != null ? Number(meta.SliceThickness) : undefined);

  if (spacing == null || spacing <= 0 || Number.isNaN(spacing)) {
    return false;
  }

  if (spacing <= 1.01 && inPlaneSpacing > spacing * 1.5) {
    return false;
  }

  return spacing >= inPlaneSpacing * 0.5;
}

/**
 * Whether to download a DICOM file prefix to read functional groups.
 * Skipped when session JSON (or an existing per-frame sequence) is already sufficient.
 */
export function shouldFetchEnhancedMrHeaderGeometry(meta: Record<string, unknown>): boolean {
  const numFrames = Number(meta.NumberOfFrames) || 1;
  if (numFrames < 2) {
    return false;
  }

  if (hasValidMultiframePerFrameGeometry(meta)) {
    return false;
  }

  const sopClassUID = String(meta.SOPClassUID || '');
  if (sopClassUID === ENHANCED_MR_SOP_CLASS_UID) {
    return true;
  }

  return !hasTrustworthySessionMultiframeSpacing(meta);
}

export function needsMultiframeGeometryRepair(meta: Record<string, unknown>): boolean {
  const numFrames = Number(meta.NumberOfFrames) || 1;
  if (numFrames < 2) {
    return false;
  }

  if (!meta.PerFrameFunctionalGroupsSequence) {
    return true;
  }

  const computed = computeMeanSliceSpacingFromPerFrameGroups(meta);
  if (computed == null) {
    return true;
  }

  if (isLikelySyntheticPerFrameGeometry(meta)) {
    return true;
  }

  const expected = resolveThroughPlaneSpacing(meta);
  if (expected > 1.5 && computed <= 1.01) {
    return true;
  }

  return false;
}
