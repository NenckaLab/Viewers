/**
 * Main display set processing logic
 * Extracted from getSopClassHandlerModule.tsx
 */

import React from 'react';
import { utils } from '@ohif/core';
import { Button } from '@ohif/ui-next';
import { makeDisplaySet } from './DisplaySetFactory';
import { getSopClassUids } from './SopClassUtils';
import { isMultiFrame, isSingleImageModality } from './VolumeUtils';
import type { AppContextType } from './Types';

const { isImage, sopClassDictionary } = utils;

const MAX_ENHANCED_MR_FRAMES = 1000;
const ENHANCED_MR_SOP_CLASSES = [
  sopClassDictionary.EnhancedMRImageStorage,
  sopClassDictionary.EnhancedMRColorImageStorage,
  sopClassDictionary.LegacyConvertedEnhancedMRImageStorage,
];

function showEnhancedMrFrameLimitDialog(appContext: AppContextType, numberOfFrames: number) {
  const uiDialogService = appContext?.servicesManager?.services?.uiDialogService;
  const uiNotificationService = appContext?.servicesManager?.services?.uiNotificationService;

  if (!uiDialogService?.create || typeof uiDialogService.hide !== 'function') {
    // Fallback: show a notification (no popup) if dialog service isn't available.
    uiNotificationService?.show?.({
      title: 'The Viewer has failed to load',
      message: `This scan has ${numberOfFrames} frames (max supported: ${MAX_ENHANCED_MR_FRAMES}). Please download and view the images locally.`,
      type: 'error',
      duration: 8000,
    });
    return;
  }

  const dialogId = 'enhanced-mr-frame-limit';

  // Avoid stacking identical dialogs.
  uiDialogService.hide(dialogId);

  const EnhancedMrDialog = ({ onClose }: any) =>
    React.createElement(
      'div',
      { className: 'max-w-[520px] p-4 text-white' },
      React.createElement('div', { className: 'text-[16px] font-medium' }, 'The Viewer has failed to load'),
      React.createElement(
        'p',
        { className: 'mt-3 text-[14px] leading-[1.35]' },
        `This scan has ${numberOfFrames} frames (max supported: ${MAX_ENHANCED_MR_FRAMES}).`
      ),
      React.createElement(
        'p',
        { className: 'mt-2 text-[14px] leading-[1.35]' },
        'Please download and view the images locally.'
      ),
      React.createElement(
        'div',
        { className: 'mt-6 flex justify-end' },
        React.createElement(Button as any, { onClick: onClose }, 'OK')
      )
    );

  uiDialogService.create({
    id: dialogId,
    centralize: true,
    isDraggable: false,
    showOverlay: true,
    content: EnhancedMrDialog,
    contentProps: {
      onClose: () => uiDialogService.hide(dialogId),
    },
  });
}

/**
 * Process instances from a series to create display sets
 * Basic SOPClassHandler:
 * - For all Image types that are stackable, create a displaySet with a stack of images
 *
 * @param instances - The list of instances for the series
 * @param appContext - Application context
 * @returns The list of display sets created for the given series object
 */
export function getDisplaySetsFromSeries(instances: any[], appContext: AppContextType) {
  // If the series has no instances, stop here
  if (!instances || !instances.length) {
    throw new Error('No instances were provided');
  }

  const displaySets = [];
  const sopClassUids = getSopClassUids(instances);

  // Search through the instances (InstanceMetadata object) of this series
  // Split Multi-frame instances and Single-image modalities
  // into their own specific display sets. Place the rest of each
  // series into another display set.
  const stackableInstances = [];
  instances.forEach(instance => {
    // All imaging modalities must have a valid value for sopClassUid (x00080016) or rows (x00280010)
    if (!isImage(instance.SOPClassUID) && !instance.Rows) {
      return;
    }

    let displaySet;
    if (isMultiFrame(instance)) {
      const numberOfFrames = Number(instance.NumberOfFrames) || 1;
      if (numberOfFrames > MAX_ENHANCED_MR_FRAMES && ENHANCED_MR_SOP_CLASSES.includes(instance.SOPClassUID)) {
        showEnhancedMrFrameLimitDialog(appContext, numberOfFrames);
        // Skip display set creation for this instance to prevent the whole series
        // from failing and to rely on the popup/notification above.
        return;
      }

      displaySet = makeDisplaySet([instance], appContext);
      displaySet.setAttributes({
        sopClassUids,
        numImageFrames: instance.NumberOfFrames,
        instanceNumber: instance.InstanceNumber,
        acquisitionDatetime: instance.AcquisitionDateTime,
      });
      displaySets.push(displaySet);
    } else if (isSingleImageModality(instance.Modality)) {
      displaySet = makeDisplaySet([instance], appContext);
      displaySet.setAttributes({
        sopClassUids,
        instanceNumber: instance.InstanceNumber,
        acquisitionDatetime: instance.AcquisitionDateTime,
      });
      displaySets.push(displaySet);
    } else {
      stackableInstances.push(instance);
    }
  });

  if (stackableInstances.length) {
    const displaySet = makeDisplaySet(stackableInstances, appContext);
    displaySet.setAttribute('studyInstanceUid', instances[0].StudyInstanceUID);
    displaySet.setAttributes({
      sopClassUids,
    });
    displaySets.push(displaySet);
  }

  return displaySets;
}
