/**
 * Study data management utilities
 * Extracted from PanelStudyBrowser.tsx
 */

import { useNavigate } from 'react-router-dom';
import { _mapDataSourceStudies } from './DataMappers';

/**
 * Fetches studies for a patient from the data source
 * @param {string} StudyInstanceUID - Study instance UID
 * @param {Object} dataSource - Data source object
 * @param {Function} getStudiesForPatientByMRN - Function to get studies by patient MRN
 * @param {Function} setStudyDisplayList - State setter for study display list
 * @param {Function} setExpandedStudyInstanceUIDs - State setter for expanded studies
 * @param {Function} navigate - Navigation function
 */
export async function fetchStudiesForPatient(
    StudyInstanceUID: string,
    dataSource: any,
    getStudiesForPatientByMRN: Function,
    setStudyDisplayList: Function,
    setExpandedStudyInstanceUIDs: Function,
    navigate: ReturnType<typeof useNavigate>,
    servicesManager?: any
) {
    // current study qido
    try {
        let qidoForStudyUID = [];
        if (dataSource && dataSource.query && typeof dataSource.query.studies?.search === 'function') {
            qidoForStudyUID = await dataSource.query.studies.search({
                studyInstanceUid: StudyInstanceUID,
            });
        } else {
            console.error('XNAT: dataSource.query.studies.search is not available');
            qidoForStudyUID = [];
        }

        if (!qidoForStudyUID?.length) {
            console.error('XNAT: Invalid study URL or no data returned for', StudyInstanceUID);
            // navigate('/notfoundstudy');
            throw new Error('Invalid study URL');
        }

        if (typeof dataSource.query.studies.processResults === 'function') {
            qidoForStudyUID = dataSource.query.studies.processResults(qidoForStudyUID);
        }

        let qidoStudiesForPatient = qidoForStudyUID;

        // try to fetch the prior studies based on the patientID if the
        // server can respond.
        try {
            if (typeof getStudiesForPatientByMRN === 'function') {
                qidoStudiesForPatient = await getStudiesForPatientByMRN(qidoForStudyUID);
            } else {
                console.warn('XNAT: getStudiesForPatientByMRN is not a function');
            }
        } catch (error) {
            console.warn('XNAT: Failed to get studies for patient by MRN:', error);
        }

        // If prior lookup returned DICOM-tag payloads, normalize again.
        if (
            qidoStudiesForPatient?.[0]?.['00100010'] != null &&
            typeof dataSource.query?.studies?.processResults === 'function'
        ) {
            qidoStudiesForPatient = dataSource.query.studies.processResults(qidoStudiesForPatient);
        }

        const mappedStudies = await _mapDataSourceStudies(qidoStudiesForPatient);

        // Force expand StudyInstanceUIDs when studies are loaded
        setExpandedStudyInstanceUIDs(prevExpanded => {
            const updated = [...prevExpanded];
            mappedStudies.forEach(study => {
                if (study.StudyInstanceUID && !updated.includes(study.StudyInstanceUID)) {
                    updated.push(study.StudyInstanceUID);
                }
            });
            return updated;
        });

        // Prefer PN already on display sets / metadata store when QIDO left it blank.
        const fallbackPatientName = (() => {
            try {
                const ds =
                    servicesManager?.services?.displaySetService?.getActiveDisplaySets?.()?.[0];
                const fromDs = ds?.PatientName || ds?.instances?.[0]?.PatientName;
                if (fromDs) {
                    return typeof fromDs === 'string' ? fromDs : fromDs?.Alphabetic || '';
                }
                const studyMeta = DicomMetadataStore.getStudy?.(StudyInstanceUID);
                const fromStore = studyMeta?.PatientName;
                if (fromStore) {
                    return typeof fromStore === 'string' ? fromStore : fromStore?.Alphabetic || '';
                }
            } catch {
                // ignore
            }
            return '';
        })();

        const actuallyMappedStudies = mappedStudies.map(qidoStudy => {
            const patientName =
                qidoStudy.displayPatientName ||
                qidoStudy.PatientName ||
                qidoStudy.patientName ||
                fallbackPatientName ||
                '';
            const study = {
                studyInstanceUid: qidoStudy.StudyInstanceUID,
                // StudyBrowser UI shows `date` as the primary accordion label — put PN there.
                date: patientName || qidoStudy.displayStudyDate || formatDate(qidoStudy.StudyDate) || '',
                description:
                    qidoStudy.StudyDescription ||
                    qidoStudy.displayStudyDescription ||
                    qidoStudy.displayStudyDate ||
                    formatDate(qidoStudy.StudyDate) ||
                    '',
                modalities: qidoStudy.ModalitiesInStudy,
                numInstances: qidoStudy.NumInstances,
                PatientName: patientName,
                displayStudyDate: qidoStudy.displayStudyDate || formatDate(qidoStudy.StudyDate),
                displayPatientName: patientName,
                displayStudyDescription: qidoStudy.displayStudyDescription || qidoStudy.StudyDescription
            };
            return study;
        });

        setStudyDisplayList(prevArray => {
            const ret = [...prevArray];
            for (const study of actuallyMappedStudies) {
                if (!prevArray.find(it => it.studyInstanceUid === study.studyInstanceUid)) {
                    ret.push(study);
                }
            }
            return ret;
        });
    } catch (error) {
        console.error('XNAT: Error fetching study data:', error);
    }
}

// Import formatDate from utils
import { utils, DicomMetadataStore } from '@ohif/core';
const { formatDate } = utils;
