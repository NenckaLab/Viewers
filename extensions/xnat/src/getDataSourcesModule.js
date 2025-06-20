// TODO: Pull in IWebClientApi from @ohif/core
// TODO: Use constructor to create an instance of IWebClientApi
// TODO: Use existing DICOMWeb configuration (previously, appConfig, to configure instance)

import { createDicomWebApi } from './DicomWebDataSource/index';
import { createDicomJSONApi } from './DicomJSONDataSource/index';
import { createDicomLocalApi } from './DicomLocalDataSource/index';
import { createDicomWebProxyApi } from './DicomWebProxyDataSource/index';
import { createDataSource } from './XNATDataSource/index';

/**
 * Data sources module that creates and registers the available data sources for OHIF
 * with the data source manager.
 */
function getDataSourcesModule() {
    return [{
            name: 'xnat', // Primary data source name
            type: 'webApi',
            createDataSource: createDataSource,
        },
        {
            name: 'dicomwebproxy',
            type: 'webApi',
            createDataSource: createDicomWebProxyApi,
        },
        {
            name: 'dicomjson',
            type: 'jsonApi',
            createDataSource: createDicomJSONApi,
        },
        {
            name: 'dicomlocal',
            type: 'localApi',
            createDataSource: createDicomLocalApi,
        },
    ];
}

export default getDataSourcesModule;