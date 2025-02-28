import { Types } from '@ohif/core';

import getDataSourcesModule from './getDataSourcesModule.js';
import getLayoutTemplateModule from './getLayoutTemplateModule.js';
import getPanelModule from './getPanelModule';
import getSopClassHandlerModule from './getSopClassHandlerModule.js';
import getToolbarModule from './getToolbarModule';
import getCommandsModule from './commandsModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getStudiesForPatientByMRN from './Panels/getStudiesForPatientByMRN';
import getCustomizationModule from './getCustomizationModule';
import { id } from './id.js';
import init from './init';
import SegmentationService from './services/SegmentationService';
import {
  ContextMenuController,
  CustomizableContextMenuTypes,
} from './CustomizableContextMenu';
import * as dicomWebUtils from './DicomWebDataSource/utils';

const defaultExtension: Types.Extensions.Extension = {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,
  preRegistration({ servicesManager }) {
    servicesManager.registerService(SegmentationService.REGISTRATION);
  },
  getDataSourcesModule,
  getLayoutTemplateModule,
  getPanelModule,
  getHangingProtocolModule,
  getSopClassHandlerModule,
  getToolbarModule,
  getCommandsModule,
  getUtilityModule({ servicesManager }) {
    return [
      {
        name: 'common',
        exports: {
          getStudiesForPatientByMRN,
        },
      },
    ];
  },

  getCustomizationModule,
};

export default defaultExtension;

export {
  ContextMenuController,
  CustomizableContextMenuTypes,
  getStudiesForPatientByMRN,
  dicomWebUtils,
};
