import { DicomMetadataStore, Types } from '@ohif/core';

type StudyMetadata = Types.StudyMetadata;

/**
 * Compare function for sorting
 *
 * @param a - some simple value (string, number, timestamp)
 * @param b - some simple value
 * @param defaultCompare - default return value as a fallback when a===b
 * @returns - compare a and b, returning 1 if a<b -1 if a>b and defaultCompare otherwise
 */
const compare = (a, b, defaultCompare = 0): number => {
  if (a === b) {
    return defaultCompare;
  }
  if (a < b) {
    return 1;
  }
  return -1;
};

/**
 * The studies from display sets gets the studies in study date
 * order or in study instance UID order - not very useful, but
 * if not specifically specified then at least making it consistent is useful.
 */
const getStudiesfromDisplaySets = (displaysets): StudyMetadata[] => {
  const studyMap = {};

  const ret = displaysets.reduce((prev, curr, index) => {
    const { StudyInstanceUID } = curr;
    if (StudyInstanceUID && !studyMap[StudyInstanceUID]) {
      let study = DicomMetadataStore.getStudy(StudyInstanceUID);
      // If study not found in store, create a minimal placeholder
      if (!study) {
        console.warn(`Study ${StudyInstanceUID} not found in DicomMetadataStore, creating placeholder from display set`);
        study = {
          StudyInstanceUID,
          studyInstanceUIDsIndex: index, // Add index for hanging protocol matching
          StudyDate: curr.StudyDate || '',
          StudyTime: curr.StudyTime || '',
          AccessionNumber: curr.AccessionNumber || '',
          PatientName: curr.PatientName || '',
          PatientID: curr.PatientID || '',
          PatientBirthDate: curr.PatientBirthDate || '',
          PatientSex: curr.PatientSex || '',
          StudyDescription: curr.StudyDescription || '',
          NumberOfStudyRelatedSeries: 1,
          NumberOfStudyRelatedInstances: curr.numImageFrames || 1,
          ModalitiesInStudy: curr.Modality ? [curr.Modality] : [],
          series: [],
        };
      } else if (typeof study.studyInstanceUIDsIndex === 'undefined') {
        // Add index to existing study if not present
        study.studyInstanceUIDsIndex = index;
      }
      studyMap[StudyInstanceUID] = study;
      prev.push(study);
    }
    return prev;
  }, []);
  // Return the sorted studies, first on study date and second on study instance UID
  ret.sort((a, b) => {
    return compare(a.StudyDate, b.StudyDate, compare(a.StudyInstanceUID, b.StudyInstanceUID));
  });
  return ret;
};

/**
 * The studies retrieve from the Uids is faster and gets the studies
 * in the original order, as specified.
 */
const getStudiesFromUIDs = (studyUids: string[]): StudyMetadata[] => {
  if (!studyUids?.length) {
    return;
  }
  const result = studyUids.map((uid, index) => {
    const study = DicomMetadataStore.getStudy(uid);
    // If study not found in store, create a minimal placeholder
    if (!study) {
      console.warn(`Study ${uid} not found in DicomMetadataStore, creating placeholder`);
      return {
        StudyInstanceUID: uid,
        studyInstanceUIDsIndex: index, // Add index for hanging protocol matching
        StudyDate: '',
        StudyTime: '',
        AccessionNumber: '',
        PatientName: '',
        PatientID: '',
        PatientBirthDate: '',
        PatientSex: '',
        StudyDescription: '',
        NumberOfStudyRelatedSeries: 0,
        NumberOfStudyRelatedInstances: 0,
        ModalitiesInStudy: [],
        series: [],
      };
    }
    // Add index to existing study if not present
    if (study && typeof study.studyInstanceUIDsIndex === 'undefined') {
      study.studyInstanceUIDsIndex = index;
    }
    return study;
  });

  return result;
};

/** Gets the array of studies */
const getStudies = (studyUids?: string[], displaySets): StudyMetadata[] => {
  const fromUIDs = getStudiesFromUIDs(studyUids);

  if (fromUIDs) {
    return fromUIDs;
  }

  const fromDisplaySets = getStudiesfromDisplaySets(displaySets);
  return fromDisplaySets;
};

export default getStudies;

export { getStudies, getStudiesFromUIDs, getStudiesfromDisplaySets, compare };
