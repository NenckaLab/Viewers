import { Types } from '@ohif/core';

const defaultDisplaySetSelector = {
    seriesMatchingRules: [
        // Match any display set - very permissive for comparison
        {
            weight: 1,
            attribute: 'numImageFrames',
            constraint: {
                greaterThanOrEqual: { value: 0 }, // Match any display set with 0 or more frames
            },
            required: false,
        },
    ],
};

const priorDisplaySetSelector = {
    seriesMatchingRules: [
        // Match any display set - very permissive for comparison
        {
            weight: 1,
            attribute: 'numImageFrames',
            constraint: {
                greaterThanOrEqual: { value: 0 }, // Match any display set with 0 or more frames
            },
            required: false,
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
        viewportType: 'stack',
        syncGroups: [
            {
                type: 'hydrateseg',
                id: 'sameFORId',
                source: true,
                target: true,
                options: {
                    matchingRules: ['sameFOR'],
                },
            },
        ],
    },
    displaySets: [currentDisplaySet],
};

const priorViewport0 = {
    ...currentViewport0,
    displaySets: [priorDisplaySet],
};

/**
 * Hanging protocol for comparing two MR studies from the same subject
 */
const mrSubjectComparison: Types.HangingProtocol.Protocol = {
    id: '@ohif/mrSubjectComparison',
    description: 'Compare two MR studies from the same subject',
    name: 'MR Subject Comparison',
    numberOfPriorsReferenced: -1, // Allow any number of studies
    protocolMatchingRules: [],
    toolGroupIds: ['default'],
    displaySetSelectors: {
        defaultDisplaySetId: defaultDisplaySetSelector,
        priorDisplaySetId: priorDisplaySetSelector,
    },
    defaultViewport: {
        viewportOptions: {
            viewportType: 'stack',
            toolGroupId: 'default',
            allowUnmatchedView: true,
            syncGroups: [
                {
                    type: 'hydrateseg',
                    id: 'sameFORId',
                    source: true,
                    target: true,
                    options: {
                        matchingRules: ['sameFOR'],
                    },
                },
            ],
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
            name: 'Side-by-Side Comparison',
            stageActivation: {
                enabled: {
                    minViewportsMatched: 1, // Lower threshold to activate even with partial matches
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
