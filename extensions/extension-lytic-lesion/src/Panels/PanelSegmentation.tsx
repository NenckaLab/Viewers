import { createReportAsync } from '@ohif/extension-default';
import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { SegmentationGroupTable, Input, Label, Select, Button, ButtonGroup } from '@ohif/ui';
import WindowLevelPanel from './WindowLevelPanel';
import callInputDialog from './callInputDialog';
import callColorPickerDialog from './colorPickerDialog';
import { useTranslation } from 'react-i18next';

export default function PanelSegmentation({
  servicesManager,
  commandsManager,
  extensionManager,
  configuration,
}) {
  const { segmentationService, uiDialogService } = servicesManager.services;

  const { t } = useTranslation('PanelSegmentation');

  const [selectedSegmentationId, setSelectedSegmentationId] = useState(null);
  const [segmentationConfiguration, setSegmentationConfiguration] = useState(
    segmentationService.getConfiguration()
  );

  const [segmentations, setSegmentations] = useState(() => segmentationService.getSegmentations());
  const [targetNumber, setTargetNumber] = React.useState(233);
  const [minHU, setMinHU] = React.useState(-90);
  const [maxHU, setMaxHU] = React.useState(500);
  const [lowHU, setLowHU] = React.useState(73);
  const [highHU, setHighHU] = React.useState(365);

  const handleSetRange = () => {
    // Perform the action to set the Hounsfield range
    commandsManager.runCommand('setHounsfieldRange', {
      minHU: minHU,
      maxHU: maxHU,
      lowHU: lowHU,
      highHU: highHU,
      targetNumber: targetNumber,
    });
    commandsManager.runCommand('setColormap', { colormap: 'HUColormap' })
  };
  useEffect(() => {
    // ~~ Subscription
    const added = segmentationService.EVENTS.SEGMENTATION_ADDED;
    const updated = segmentationService.EVENTS.SEGMENTATION_UPDATED;
    const removed = segmentationService.EVENTS.SEGMENTATION_REMOVED;
    const subscriptions = [];

    [added, updated, removed].forEach(evt => {
      const { unsubscribe } = segmentationService.subscribe(evt, () => {
        const segmentations = segmentationService.getSegmentations();
        setSegmentations(segmentations);
        setSegmentationConfiguration(segmentationService.getConfiguration());
      });
      subscriptions.push(unsubscribe);
    });

    return () => {
      subscriptions.forEach(unsub => {
        unsub();
      });
    };
  }, []);

  const getToolGroupIds = segmentationId => {
    const toolGroupIds = segmentationService.getToolGroupIdsWithSegmentation(segmentationId);

    return toolGroupIds;
  };

  const onSegmentationAdd = async () => {
    commandsManager.runCommand('createLabelmapForViewport');
  };

  const onSegmentationClick = (segmentationId: string) => {
    segmentationService.setActiveSegmentationForToolGroup(segmentationId);
  };

  const onSegmentationDelete = (segmentationId: string) => {
    segmentationService.remove(segmentationId);
  };

  const onSegmentAdd = segmentationId => {
    segmentationService.addSegment(segmentationId);
  };

  const onSegmentClick = (segmentationId, segmentIndex) => {
    segmentationService.setActiveSegment(segmentationId, segmentIndex);

    const toolGroupIds = getToolGroupIds(segmentationId);

    toolGroupIds.forEach(toolGroupId => {
      // const toolGroupId =
      segmentationService.setActiveSegmentationForToolGroup(segmentationId, toolGroupId);
      segmentationService.jumpToSegmentCenter(segmentationId, segmentIndex, toolGroupId);
    });
  };

  const onSegmentEdit = (segmentationId, segmentIndex) => {
    const segmentation = segmentationService.getSegmentation(segmentationId);

    const segment = segmentation.segments[segmentIndex];
    const { label } = segment;

    callInputDialog(uiDialogService, label, (label, actionId) => {
      if (label === '') {
        return;
      }

      segmentationService.setSegmentLabel(segmentationId, segmentIndex, label);
    });
  };

  const onSegmentationEdit = segmentationId => {
    const segmentation = segmentationService.getSegmentation(segmentationId);
    const { label } = segmentation;

    callInputDialog(uiDialogService, label, (label, actionId) => {
      if (label === '') {
        return;
      }

      segmentationService.addOrUpdateSegmentation(
        {
          id: segmentationId,
          label,
        },
        false, // suppress event
        true // notYetUpdatedAtSource
      );
    });
  };

  const onSegmentColorClick = (segmentationId, segmentIndex) => {
    const segmentation = segmentationService.getSegmentation(segmentationId);

    const segment = segmentation.segments[segmentIndex];
    const { color, opacity } = segment;

    const rgbaColor = {
      r: color[0],
      g: color[1],
      b: color[2],
      a: opacity / 255.0,
    };

    callColorPickerDialog(uiDialogService, rgbaColor, (newRgbaColor, actionId) => {
      if (actionId === 'cancel') {
        return;
      }

      segmentationService.setSegmentRGBAColor(segmentationId, segmentIndex, [
        newRgbaColor.r,
        newRgbaColor.g,
        newRgbaColor.b,
        newRgbaColor.a * 255.0,
      ]);
    });
  };

  const onSegmentDelete = (segmentationId, segmentIndex) => {
    segmentationService.removeSegment(segmentationId, segmentIndex);
  };

  const onToggleSegmentVisibility = (segmentationId, segmentIndex) => {
    const segmentation = segmentationService.getSegmentation(segmentationId);
    const segmentInfo = segmentation.segments[segmentIndex];
    const isVisible = !segmentInfo.isVisible;
    const toolGroupIds = getToolGroupIds(segmentationId);

    // Todo: right now we apply the visibility to all tool groups
    toolGroupIds.forEach(toolGroupId => {
      segmentationService.setSegmentVisibility(
        segmentationId,
        segmentIndex,
        isVisible,
        toolGroupId
      );
    });
  };

  const onToggleSegmentLock = (segmentationId, segmentIndex) => {
    segmentationService.toggleSegmentLocked(segmentationId, segmentIndex);
  };

  const onToggleSegmentationVisibility = segmentationId => {
    segmentationService.toggleSegmentationVisibility(segmentationId);
  };

  const _setSegmentationConfiguration = useCallback(
    (segmentationId, key, value) => {
      segmentationService.setConfiguration({
        segmentationId,
        [key]: value,
      });
    },
    [segmentationService]
  );

  const onSegmentationDownload = segmentationId => {
    commandsManager.runCommand('downloadSegmentation', {
      segmentationId,
    });
  };

  const storeSegmentation = segmentationId => {
    const datasources = extensionManager.getActiveDataSource();

    const getReport = async () => {
      return await commandsManager.runCommand('storeSegmentation', {
        segmentationId,
        dataSource: datasources[0],
      });
    };

    createReportAsync({
      servicesManager,
      getReport,
      reportType: 'Segmentation',
    });
  };

  return (
    <>
      <div className="flex min-h-0 flex-auto select-none flex-col justify-between">
        <SegmentationGroupTable
          title={t('Segmentations')}
          segmentations={segmentations}
          disableEditing={configuration.disableEditing}
          activeSegmentationId={selectedSegmentationId || ''}
          onSegmentationAdd={onSegmentationAdd}
          onSegmentationClick={onSegmentationClick}
          onSegmentationDelete={onSegmentationDelete}
          onSegmentationDownload={onSegmentationDownload}
          storeSegmentation={storeSegmentation}
          onSegmentationEdit={onSegmentationEdit}
          onSegmentClick={onSegmentClick}
          onSegmentEdit={onSegmentEdit}
          onSegmentAdd={onSegmentAdd}
          onSegmentColorClick={onSegmentColorClick}
          onSegmentDelete={onSegmentDelete}
          onToggleSegmentVisibility={onToggleSegmentVisibility}
          onToggleSegmentLock={onToggleSegmentLock}
          onToggleSegmentationVisibility={onToggleSegmentationVisibility}
          showDeleteSegment={true}
          segmentationConfig={{ initialConfig: segmentationConfiguration }}
          setRenderOutline={value =>
            _setSegmentationConfiguration(selectedSegmentationId, 'renderOutline', value)
          }
          setOutlineOpacityActive={value =>
            _setSegmentationConfiguration(selectedSegmentationId, 'outlineOpacity', value)
          }
          setRenderFill={value =>
            _setSegmentationConfiguration(selectedSegmentationId, 'renderFill', value)
          }
          setRenderInactiveSegmentations={value =>
            _setSegmentationConfiguration(
              selectedSegmentationId,
              'renderInactiveSegmentations',
              value
            )
          }
          setOutlineWidthActive={value =>
            _setSegmentationConfiguration(selectedSegmentationId, 'outlineWidthActive', value)
          }
          setFillAlpha={value =>
            _setSegmentationConfiguration(selectedSegmentationId, 'fillAlpha', value)
          }
          setFillAlphaInactive={value =>
            _setSegmentationConfiguration(selectedSegmentationId, 'fillAlphaInactive', value)
          }
        />
      </div>
    </>
  );
}

PanelSegmentation.propTypes = {
  commandsManager: PropTypes.shape({
    runCommand: PropTypes.func.isRequired,
  }),
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      segmentationService: PropTypes.shape({
        getSegmentation: PropTypes.func.isRequired,
        getSegmentations: PropTypes.func.isRequired,
        toggleSegmentationVisibility: PropTypes.func.isRequired,
        subscribe: PropTypes.func.isRequired,
        EVENTS: PropTypes.object.isRequired,
      }).isRequired,
    }).isRequired,
  }).isRequired,
};
