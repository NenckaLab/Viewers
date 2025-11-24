import { Types } from '@ohif/core';

const defaultDisplaySetSelector = {
    studyMatchingRules: [
        {
            // The priorInstance is a study counter that indicates what position this study is in
            // and the value comes from the options parameter.
            attribute: 'studyInstanceUIDsIndex',
            from: 'options',
            required: true,
            constraint: {
                equals: { value: 0 },
            },
        },
    ],
    seriesMatchingRules: [
        {
            attribute: 'numImageFrames',
            constraint: {
                greaterThan: { value: 0 },
            },
        },
        // This display set will select the specified items by preference
        // It has no affect if nothing is specified in the URL.
        {
            attribute: 'isDisplaySetFromUrl',
            weight: 20,
            constraint: {
                equals: true,
            },
        },
    ],
};

const priorDisplaySetSelector = {
    studyMatchingRules: [
        {
            // The priorInstance is a study counter that indicates what position this study is in
            // and the value comes from the options parameter.
            attribute: 'studyInstanceUIDsIndex',
            from: 'options',
            required: true,
            constraint: {
                equals: { value: 1 },
            },
        },
    ],
    seriesMatchingRules: [
        {
            attribute: 'numImageFrames',
            constraint: {
                greaterThan: { value: 0 },
            },
        },
        // This display set will select the specified items by preference
        // It has no affect if nothing is specified in the URL.
        {
            attribute: 'isDisplaySetFromUrl',
            weight: 20,
            constraint: {
                equals: true,
            },
        },
    ],
};

const currentDisplaySet = {
    id: 'defaultDisplaySetId',
};

const priorDisplaySet = {
    id: 'priorDisplaySetId',
};

const currentViewport0 = {
    viewportOptions: {
        toolGroupId: 'default',
        allowUnmatchedView: true,
        viewportType: 'volume',
        orientation: 'axial',
        initialImageOptions: {
            preset: 'middle',
        },
    },
    displaySets: [currentDisplaySet],
};

const currentViewport1 = {
    ...currentViewport0,
    displaySets: [
        {
            ...currentDisplaySet,
            matchedDisplaySetsIndex: 1,
        },
    ],
};

const priorViewport0 = {
    ...currentViewport0,
    displaySets: [priorDisplaySet],
};

const priorViewport1 = {
    ...priorViewport0,
    displaySets: [
        {
            ...priorDisplaySet,
            matchedDisplaySetsIndex: 1,
        },
    ],
};

/**
 * Hanging protocol for comparing two MR studies from the same subject
 */
const mrSubjectComparison: Types.HangingProtocol.Protocol = {
    id: '@ohif/mrSubjectComparison',
    description: 'Compare two MR studies from the same subject',
    name: 'MR Subject Comparison',
    numberOfPriorsReferenced: 1,
    protocolMatchingRules: [
        {
            id: 'Two MR Studies',
            weight: 1000,
            // Check that we have a second study (prior)
            attribute: 'StudyInstanceUID',
            from: 'prior',
            required: true,
            constraint: {
                notNull: true,
            },
        },
        {
            // Ensure both studies contain MR modality
            attribute: 'ModalitiesInStudy',
            constraint: {
                contains: ['MR'],
            },
        },
    ],
    toolGroupIds: ['default'],
    displaySetSelectors: {
        defaultDisplaySetId: defaultDisplaySetSelector,
        priorDisplaySetId: priorDisplaySetSelector,
    },
    defaultViewport: {
        viewportOptions: {
            viewportType: 'volume',
            toolGroupId: 'default',
            allowUnmatchedView: true,
            orientation: 'axial',
            initialImageOptions: {
                preset: 'middle',
            },
        },
        displaySets: [
            {
                id: 'defaultDisplaySetId',
                matchedDisplaySetsIndex: -1,
            },
        ],
    },
    stages: [
        {
            name: '2x2 Comparison',
            stageActivation: {
                enabled: {
                    minViewportsMatched: 4,
                },
            },
            viewportStructure: {
                layoutType: 'grid',
                properties: {
                    rows: 2,
                    columns: 2,
                },
            },
            viewports: [currentViewport0, priorViewport0, currentViewport1, priorViewport1],
        },
        {
            name: '2x1 Comparison',
            stageActivation: {
                enabled: {
                    minViewportsMatched: 2,
                },
            },
            viewportStructure: {
                layoutType: 'grid',
                properties: {
                    rows: 1,
                    columns: 2,
                },
            },
            viewports: [currentViewport0, priorViewport0],
        },
    ],
};

export default mrSubjectComparison;
