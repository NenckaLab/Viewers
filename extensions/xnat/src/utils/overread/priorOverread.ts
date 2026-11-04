import {
  CustomFormData,
  CustomFormField,
  getOverreadFormData,
  getExperimentCustomFormData,
} from '../IO/customFormsApi';
import { SubjectExperiment, fetchSubjectExperiments } from './loadSubjectExperiments';

/** Saved with the current (follow-up) overread when a prior scan exists. */
export const NOTABLE_CHANGE_KEY = 'notableChange';
export const NOTABLE_CHANGE_NOTES_KEY = 'notableChangeNotes';

/** Previous storage keys; mapped on read so they do not appear in the UI. */
const LEGACY_NOTABLE_CHANGE_KEY = 'clinicallyMeaningfulChange';
const LEGACY_NOTABLE_CHANGE_NOTES_KEY = 'clinicallyMeaningfulChangeNotes';

export const NOTABLE_CHANGE_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'Unable to assess', value: 'unable_to_assess' },
] as const;

export type NotableChangeValue =
  (typeof NOTABLE_CHANGE_OPTIONS)[number]['value'];

export const NOTABLE_CHANGE_META_KEYS = new Set([
  NOTABLE_CHANGE_KEY,
  NOTABLE_CHANGE_NOTES_KEY,
  LEGACY_NOTABLE_CHANGE_KEY,
  LEGACY_NOTABLE_CHANGE_NOTES_KEY,
]);

export function migrateNotableChangeFields(
  data: { [fieldName: string]: any } | null
): { [fieldName: string]: any } | null {
  if (!data) {
    return data;
  }

  const next = { ...data };
  if (next[NOTABLE_CHANGE_KEY] == null && next[LEGACY_NOTABLE_CHANGE_KEY] != null) {
    next[NOTABLE_CHANGE_KEY] = next[LEGACY_NOTABLE_CHANGE_KEY];
  }
  if (
    next[NOTABLE_CHANGE_NOTES_KEY] == null &&
    next[LEGACY_NOTABLE_CHANGE_NOTES_KEY] != null
  ) {
    next[NOTABLE_CHANGE_NOTES_KEY] = next[LEGACY_NOTABLE_CHANGE_NOTES_KEY];
  }
  delete next[LEGACY_NOTABLE_CHANGE_KEY];
  delete next[LEGACY_NOTABLE_CHANGE_NOTES_KEY];
  return next;
}

export type PriorOverreadFinding = {
  experimentId: string;
  experimentLabel: string;
  date?: string;
  formData: { [fieldName: string]: any } | null;
  hasData: boolean;
};

/**
 * Experiments older than the current session, newest-first among priors.
 * Assumes `experiments` are already sorted newest-first.
 */
export function getPriorExperiments(
  experiments: SubjectExperiment[],
  currentExperimentId: string
): SubjectExperiment[] {
  if (!currentExperimentId || !experiments.length) {
    return [];
  }

  const currentIndex = experiments.findIndex(exp => exp.ID === currentExperimentId);
  if (currentIndex < 0) {
    // Current not in list: treat every experiment as a candidate prior (exclude current id).
    return experiments.filter(exp => exp.ID !== currentExperimentId);
  }

  // Newest-first list: items after currentIndex are older than current.
  return experiments.slice(currentIndex + 1);
}

/**
 * True when this subject has at least one scan older than the current experiment.
 */
export function isFollowUpScan(
  experiments: SubjectExperiment[],
  currentExperimentId: string
): boolean {
  return getPriorExperiments(experiments, currentExperimentId).length > 0;
}

/**
 * Extract field values from the various overread / custom-form response shapes.
 */
export function extractFormFieldData(
  data: CustomFormData | Record<string, any> | null | undefined,
  formUuid: string,
  options?: {
    currentUserId?: number | string | null;
    formFields?: CustomFormField[];
  }
): { [fieldName: string]: any } | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  let formData: any = null;
  const currentUserId = options?.currentUserId?.toString();

  if (data[formUuid]) {
    const formDataObj = data[formUuid];
    if (formDataObj && typeof formDataObj === 'object') {
      if (formDataObj['1'] && typeof formDataObj['1'] === 'object') {
        formData = formDataObj['1'];
      } else if (!Array.isArray(formDataObj)) {
        formData = formDataObj;
      }
    }
  }

  if (!formData && currentUserId && data[currentUserId]) {
    formData = data[currentUserId];
  } else if (!formData && data['1'] && typeof data['1'] === 'object') {
    formData = data['1'];
  }

  if (!formData && options?.formFields?.length) {
    const flattenedData: { [fieldName: string]: any } = {};
    let hasFlattenedData = false;

    options.formFields.forEach(field => {
      const flattenedKey = `${formUuid}_${field.key}`;
      if (data[flattenedKey] !== undefined) {
        flattenedData[field.key] = data[flattenedKey];
        hasFlattenedData = true;
      }
    });

    if (hasFlattenedData) {
      formData = flattenedData;
    }
  }

  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
    return null;
  }

  // Nested user payload: { "123": { field: value } }
  if (
    currentUserId &&
    formData[currentUserId] &&
    typeof formData[currentUserId] === 'object' &&
    !Array.isArray(formData[currentUserId])
  ) {
    return formData[currentUserId];
  }

  return formData;
}

/**
 * Load the current user's overread findings for a prior experiment.
 */
export async function loadPriorOverreadFinding(
  experiment: SubjectExperiment,
  formUuid: string,
  options?: {
    currentUserId?: number | string | null;
    formFields?: CustomFormField[];
  }
): Promise<PriorOverreadFinding> {
  const base: PriorOverreadFinding = {
    experimentId: experiment.ID,
    experimentLabel: String(experiment.label || experiment.ID),
    date: (experiment.date as string) || (experiment.insert_date as string) || undefined,
    formData: null,
    hasData: false,
  };

  if (!formUuid) {
    return base;
  }

  let data: CustomFormData = {};
  try {
    data = await getOverreadFormData(experiment.ID, formUuid);
    if (!data || Object.keys(data).length === 0) {
      data = await getExperimentCustomFormData(experiment.ID, formUuid);
    }
  } catch {
    try {
      data = await getExperimentCustomFormData(experiment.ID, formUuid);
    } catch {
      return base;
    }
  }

  const formData = migrateNotableChangeFields(
    extractFormFieldData(data, formUuid, options)
  );
  const meaningfulKeys = formData
    ? Object.keys(formData).filter(
      key =>
        key !== 'completedByUserId' &&
        key !== 'completedByUsername' &&
        key !== 'completedAt' &&
        !NOTABLE_CHANGE_META_KEYS.has(key) &&
        !key.startsWith('priorExperiment') &&
        formData[key] !== '' &&
        formData[key] !== null &&
        formData[key] !== undefined
    )
    : [];

  return {
    ...base,
    formData,
    hasData: meaningfulKeys.length > 0,
  };
}

/**
 * Fetch subject experiments and resolve the nearest prior overread finding.
 */
export async function resolveNearestPriorOverread(params: {
  projectId: string;
  subjectId: string;
  currentExperimentId: string;
  formUuid: string;
  currentUserId?: number | string | null;
  formFields?: CustomFormField[];
}): Promise<{
  subjectExperiments: SubjectExperiment[];
  priorExperiments: SubjectExperiment[];
  nearestPrior: PriorOverreadFinding | null;
}> {
  const subjectExperiments = await fetchSubjectExperiments(
    params.projectId,
    params.subjectId
  );
  const priorExperiments = getPriorExperiments(
    subjectExperiments,
    params.currentExperimentId
  );

  if (!priorExperiments.length || !params.formUuid) {
    return { subjectExperiments, priorExperiments, nearestPrior: null };
  }

  // Prefer the most recent prior that already has this user's findings;
  // otherwise fall back to the chronologically nearest prior.
  let nearestPrior: PriorOverreadFinding | null = null;
  for (const prior of priorExperiments) {
    const finding = await loadPriorOverreadFinding(prior, params.formUuid, {
      currentUserId: params.currentUserId,
      formFields: params.formFields,
    });
    if (!nearestPrior) {
      nearestPrior = finding;
    }
    if (finding.hasData) {
      nearestPrior = finding;
      break;
    }
  }

  return { subjectExperiments, priorExperiments, nearestPrior };
}

export function formatPriorFieldValue(value: any): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
