import * as fetchJSONModule from '../IO/fetchJSON';
import sessionMap from '../sessionMap';

// fetchJSON.js assigns its export conditionally, so TS cannot infer a type for the
// default binding; go through the module namespace and cast.
const fetchJSON = (fetchJSONModule as any).default as (
  route: string
) => { promise: Promise<any>; cancel: () => void };

export type SubjectExperiment = {
  ID: string;
  label: string;
  date?: string;
  insert_date?: string;
  project?: string;
  [key: string]: unknown;
};

export const COMPARISON_PROTOCOL_IDS = ['@ohif/mrSubjectComparison', '@ohif/hpCompare'];

export function isComparisonProtocolId(protocolId?: string | null): boolean {
  return !!protocolId && COMPARISON_PROTOCOL_IDS.includes(protocolId);
}

/** Normalize XNAT date / insert_date into a comparable string (YYYYMMDDHHmmss). */
function normalizeDateKey(value?: string): string {
  if (!value) {
    return '';
  }
  return String(value).replace(/[-:\s.T]/g, '').slice(0, 14);
}

/**
 * Sort experiments newest-first using session `date`, then `insert_date`.
 */
export function sortExperimentsByDateDesc(
  experiments: SubjectExperiment[]
): SubjectExperiment[] {
  return [...experiments].sort((a, b) => {
    const dateA = normalizeDateKey(a.date) || normalizeDateKey(a.insert_date);
    const dateB = normalizeDateKey(b.date) || normalizeDateKey(b.insert_date);
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    const insertA = a.insert_date || '';
    const insertB = b.insert_date || '';
    return String(insertB).localeCompare(String(insertA));
  });
}

/**
 * Fetch all experiments for a subject and return them newest-first.
 */
export async function fetchSubjectExperiments(
  projectId: string,
  subjectId: string
): Promise<SubjectExperiment[]> {
  if (!projectId || !subjectId) {
    return [];
  }

  if (!sessionMap.xnatRootUrl && typeof window !== 'undefined') {
    // sessionMap.js initializes xnatRootUrl as undefined, so TS infers type `undefined`.
    (sessionMap as { xnatRootUrl?: string }).xnatRootUrl = `${window.location.origin}/`;
  }

  const cancelable = fetchJSON(
    `data/archive/projects/${projectId}/subjects/${subjectId}/experiments?format=json`
  );
  const result = await cancelable.promise;
  const experiments = result?.ResultSet?.Result;

  if (!Array.isArray(experiments) || experiments.length === 0) {
    return [];
  }

  return sortExperimentsByDateDesc(experiments as SubjectExperiment[]);
}

export function buildSyntheticStudyUIDs(experimentIds: string[]): string[] {
  return experimentIds.map((expId, index) => `xnat_experiment_${index}_${expId}`);
}

export function buildStudyMappingsForExperiments(
  experimentIds: string[],
  projectId: string
): Record<string, { projectId: string; experimentId: string }> {
  const mappings: Record<string, { projectId: string; experimentId: string }> = {};
  experimentIds.forEach((experimentId, index) => {
    mappings[`xnat_experiment_${index}_${experimentId}`] = {
      projectId,
      experimentId,
    };
  });
  return mappings;
}
