import { Enums } from '@cornerstonejs/tools';
import { toolNames } from './initCornerstoneTools';
import DicomUpload from './components/DicomUpload/DicomUpload';
import ViewportWindowLevel from './components/ViewportWindowLevel';
import ActiveViewportWindowLevel from './components/ActiveViewportWindowLevel';

const tools = {
  active: [
    {
      toolName: toolNames.WindowLevel,
      bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
    },
    {
      toolName: toolNames.Pan,
      bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
    },
    {
      toolName: toolNames.Zoom,
      bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
    },
    { toolName: toolNames.StackScrollMouseWheel, bindings: [] },
  ],
  enabled: [{ toolName: toolNames.SegmentationDisplay }],
};

function getCustomizationModule() {
  return [
    {
      name: 'cornerstoneDicomUploadComponent',
      value: {
        id: 'dicomUploadComponent',
        component: DicomUpload,
      },
    },
    {
      name: 'default',
      value: [
        {
          id: 'cornerstone.overlayViewportTools',
          tools,
        },
      ],
    },
    {
      name: 'cornerstoneViewportWindowLevelComponent',
      value: {
        id: 'viewportWindowLevelComponent',
        component: ViewportWindowLevel,
      },
    },
    {
      name: 'cornerstoneActiveViewportWindowLevelComponent',
      value: {
        id: 'activeViewportWindowLevelComponent',
        component: ActiveViewportWindowLevel,
      },
    },
  ];
}

export default getCustomizationModule;
