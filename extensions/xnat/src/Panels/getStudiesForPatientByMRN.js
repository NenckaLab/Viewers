/**
 * Prior-study lookup by PatientID/MRN.
 * On XNAT this re-search returns denaturalized DICOM-tag objects and would
 * overwrite the already-processed study list (wiping patientName). Only run it
 * for data sources that return processResults-shaped rows.
 */
async function getStudiesForPatientByMRN(dataSource, qidoForStudyUID) {
  if (!qidoForStudyUID?.length || !qidoForStudyUID[0].mrn) {
    return qidoForStudyUID;
  }

  // XNAT session search is experiment-scoped; keep the processed current study.
  const sourceName =
    dataSource?.sourceName ||
    dataSource?.name ||
    dataSource?.id ||
    dataSource?.configuration?.name ||
    '';
  if (String(sourceName).toLowerCase().includes('xnat')) {
    return qidoForStudyUID;
  }

  const results = await dataSource.query.studies.search({
    patientId: qidoForStudyUID[0].mrn,
    disableWildcard: true,
  });

  if (!results?.length) {
    return qidoForStudyUID;
  }

  // Ensure same shape as the first search (processed QIDO rows).
  if (
    results[0]?.['00100010'] != null &&
    typeof dataSource.query?.studies?.processResults === 'function'
  ) {
    return dataSource.query.studies.processResults(results);
  }

  return results;
}

export default getStudiesForPatientByMRN;
