import { volumeLoader } from '@cornerstonejs/core';
import {
    cornerstoneStreamingImageVolumeLoader,
    cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { errorHandler, utils } from '@ohif/core';

const { registerVolumeLoader } = volumeLoader;

export default function initWADOImageLoader(
    userAuthenticationService,
    appConfig,
    extensionManager
) {
    registerVolumeLoader('cornerstoneStreamingImageVolume', cornerstoneStreamingImageVolumeLoader);

    registerVolumeLoader(
        'cornerstoneStreamingDynamicImageVolume',
        cornerstoneStreamingDynamicImageVolumeLoader
    );

    dicomImageLoader.init({
        // AsyncDicomReader naturalize fails on many XNAT Part 10 files
        // ("Finding view is past end of input"). Use dicom-parser instead.
        useLegacyMetadataProvider: true,
        maxWebWorkers: Math.min(
            Math.max(navigator.hardwareConcurrency - 1, 1),
            appConfig.maxNumberOfWebWorkers
        ),
        beforeSend: function(xhr) {
            //TODO should be removed in the future and request emitted by DicomWebDataSource
            const sourceConfig = extensionManager.getActiveDataSource()?.[0]?.getConfig() ?? {};
            const headers = userAuthenticationService.getAuthorizationHeader();
            const acceptHeader = utils.generateAcceptHeader(
                sourceConfig.acceptHeader,
                sourceConfig.requestTransferSyntaxUID,
                sourceConfig.omitQuotationForMultipartRequest
            );

            const xhrRequestHeaders = {
                Accept: acceptHeader,
            };

            if (headers) {
                Object.assign(xhrRequestHeaders, headers);
            }

            return xhrRequestHeaders;
        },
        errorInterceptor: error => {
            errorHandler.getHTTPErrorHandler(error);
        },
    });
}

export function destroy() {
    console.debug('Destroying WADO Image Loader');
}