function requestDisplaySetCreationForStudy(
    dataSource,
    displaySetService,
    StudyInstanceUID,
    madeInClient
) {

    // Try to get StudyInstanceUID from sessionStorage if it's not provided
    if (!StudyInstanceUID) {
        // Use xnat_studyInstanceUID instead of lastSelectedStudyInstanceUID
        const storedUID = sessionStorage.getItem('xnat_studyInstanceUID');
        if (storedUID) {
            StudyInstanceUID = storedUID;
        } else {
            console.error('XNAT: No StudyInstanceUID provided for display set creation and none found in sessionStorage');
            return;
        }
    }

    // Check if we have the dataSource and displaySetService
    if (!dataSource || !displaySetService) {
        console.error('XNAT: Missing required services for display set creation');
        console.error('   dataSource:', dataSource);
        console.error('   displaySetService:', displaySetService);
        return;
    }

    // Check if display sets already exist for this study
    const existingDisplaySets = displaySetService.activeDisplaySets.filter(
        displaySet => displaySet.StudyInstanceUID === StudyInstanceUID
    );

    if (existingDisplaySets.length > 0) {
        return;
    }

    // If we get here, we need to create display sets for this study
    return dataSource.retrieve.series.metadata({ StudyInstanceUID, madeInClient });
}

export default requestDisplaySetCreationForStudy;