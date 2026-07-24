import { useState, useEffect, useCallback } from 'react';
import { utils } from '@ohif/core';

const { formatPN, formatDate } = utils;

function usePatientInfo(servicesManager: AppTypes.ServicesManager) {
  const { displaySetService } = servicesManager.services;

  const [patientInfo, setPatientInfo] = useState({
    PatientName: '',
    PatientID: '',
    PatientSex: '',
    PatientDOB: '',
  });
  const [isMixedPatients, setIsMixedPatients] = useState(false);

  const checkMixedPatients = useCallback(
    (PatientID: string) => {
      const displaySets = displaySetService.getActiveDisplaySets();
      let mixed = false;
      displaySets.forEach(displaySet => {
        const instance = displaySet?.instances?.[0] || displaySet?.instance;
        if (!instance) {
          return;
        }
        if (instance.PatientID !== PatientID) {
          mixed = true;
        }
      });
      setIsMixedPatients(mixed);
    },
    [displaySetService]
  );

  const applyFromInstance = useCallback(
    (instanceOrDisplaySet: any) => {
      if (!instanceOrDisplaySet) {
        return;
      }
      // Prefer instance tags; ImageSet also carries top-level PatientName from DisplaySetFactory.
      const instance =
        instanceOrDisplaySet?.instances?.[0] ||
        instanceOrDisplaySet?.instance ||
        instanceOrDisplaySet;
      const patientName = instance?.PatientName ?? instanceOrDisplaySet?.PatientName;
      const patientId = instance?.PatientID ?? instanceOrDisplaySet?.PatientID;
      if (!patientName && !patientId) {
        return;
      }
      setPatientInfo({
        PatientID: patientId || null,
        PatientName: patientName ? formatPN(patientName) : null,
        PatientSex: instance?.PatientSex || null,
        PatientDOB: formatDate(instance?.PatientBirthDate) || null,
      });
      checkMixedPatients(patientId || null);
    },
    [checkMixedPatients]
  );

  const updatePatientInfo = useCallback(
    ({ displaySetsAdded }) => {
      if (!displaySetsAdded?.length) {
        return;
      }
      applyFromInstance(displaySetsAdded[0]);
    },
    [applyFromInstance]
  );

  useEffect(() => {
    // Header often mounts after DISPLAY_SETS_ADDED has already fired — seed from actives.
    const existing = displaySetService.getActiveDisplaySets?.() || [];
    if (existing.length) {
      applyFromInstance(existing[0]);
    }

    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      props => updatePatientInfo(props)
    );
    return () => subscription.unsubscribe();
  }, [displaySetService, applyFromInstance, updatePatientInfo]);

  return { patientInfo, isMixedPatients };
}

export default usePatientInfo;
