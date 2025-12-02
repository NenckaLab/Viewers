import { Button } from '@ohif/core/src/types';

// Section headers for organizing toolbar buttons
export const sectionHeaders: Button[] = [
    // sections
    {
        id: 'MeasurementTools',
        uiType: 'ohif.toolButtonList',
        props: {
            buttonSection: true,
        },
    },
    {
        id: 'MoreTools',
        uiType: 'ohif.toolButtonList',
        props: {
            buttonSection: true,
        },
    },
    {
        id: 'SegmentationUtilities',
        uiType: 'ohif.toolBoxButtonGroup',
        props: {
            id: 'SegmentationUtilities',
            icon: 'tab-segmentation',
            label: 'Segmentation Utilities',
            buttonSection: 'SegmentationUtilities',
        },
    },
    {
        id: 'SegmentationTools',
        uiType: 'ohif.toolBoxButtonGroup',
        props: {
            id: 'SegmentationTools',
            icon: 'tab-segmentation',
            label: 'Segmentation Tools',
            buttonSection: 'SegmentationTools',
        },
    },
];
