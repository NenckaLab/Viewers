import React, { useState } from 'react';
import { SegmentationTable, DropdownMenuContent, DropdownMenuItem } from '@ohif/ui-next';
import { useActiveViewportSegmentationRepresentations } from '@ohif/extension-cornerstone';
import { metaData } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core/src';
import XNATSegmentationImportMenu from '../xnat-components/XNATSegmentationImportMenu/XNATSegmentationImportMenu';

export default function XNATSegmentationPanel({ configuration }) {
  const { commandsManager, servicesManager } = useSystem();
  const { customizationService, displaySetService, viewportGridService } = servicesManager.services;
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [viewportData, setViewportData] = useState<any>(null);

  const { segmentationsWithRepresentations, disabled } =
    useActiveViewportSegmentationRepresentations();

  // Extract customization options
  const segmentationTableMode = customizationService.getCustomization(
    'panelSegmentation.tableMode'
  ) as unknown as string;
  
  const onSegmentationAdd = async () => {
    try {
      const activeViewportId = viewportGridService.getActiveViewportId();
      await commandsManager.runCommand('createLabelmapForViewport', { 
        viewportId: activeViewportId 
      });
    } catch (error) {
      console.warn('Error creating segmentation:', error);
      // Still allow the operation to complete - the segmentation might be created
      // but with statistics calculation errors
    }
  };

  const onImportFromXNAT = () => {
    // Get current viewport data
    const { activeViewportId, viewports } = viewportGridService.getState();
    
    if (activeViewportId && viewports.has(activeViewportId)) {
      const viewport = viewports.get(activeViewportId);
      const displaySetInstanceUID = viewport.displaySetInstanceUIDs[0];
      
      if (displaySetInstanceUID) {
        const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
        
        if (displaySet) {
          setViewportData({
            studyInstanceUID: displaySet.StudyInstanceUID,
            seriesInstanceUID: displaySet.SeriesInstanceUID,
          });
          setShowImportMenu(true);
        }
      }
    }
  };

  const onImportComplete = () => {
    setShowImportMenu(false);
    setViewportData(null);
  };

  const onImportCancel = () => {
    setShowImportMenu(false);
    setViewportData(null);
  };
  
  const disableEditing = customizationService.getCustomization('panelSegmentation.disableEditing') || configuration?.disableEditing;
  const showAddSegment = customizationService.getCustomization('panelSegmentation.showAddSegment');

  // Create handlers object for all command runs
  const handlers = {
    onSegmentationClick: (segmentationId: string) => {
      commandsManager.run('setActiveSegmentation', { segmentationId });
    },
    onSegmentAdd: segmentationId => {
      commandsManager.run('addSegment', { segmentationId });
    },
    onSegmentClick: (segmentationId, segmentIndex) => {
      commandsManager.run('setActiveSegmentAndCenter', { segmentationId, segmentIndex });
    },
    onSegmentEdit: (segmentationId, segmentIndex) => {
      commandsManager.run('editSegmentLabel', { segmentationId, segmentIndex });
    },
    onSegmentationEdit: segmentationId => {
      commandsManager.run('editSegmentationLabel', { segmentationId });
    },
    onSegmentColorClick: (segmentationId, segmentIndex) => {
      commandsManager.run('editSegmentColor', { segmentationId, segmentIndex });
    },
    onSegmentDelete: (segmentationId, segmentIndex) => {
      commandsManager.run('deleteSegment', { segmentationId, segmentIndex });
    },
    onToggleSegmentVisibility: (segmentationId, segmentIndex, type) => {
      commandsManager.run('toggleSegmentVisibility', { segmentationId, segmentIndex, type });
    },
    onToggleSegmentLock: (segmentationId, segmentIndex) => {
      commandsManager.run('toggleSegmentLock', { segmentationId, segmentIndex });
    },
    onToggleSegmentationRepresentationVisibility: (segmentationId, type) => {
      commandsManager.run('toggleSegmentationVisibility', { segmentationId, type });
    },
    onSegmentationDownload: segmentationId => {
      commandsManager.run('downloadSegmentation', { segmentationId });
    },
    setStyle: (segmentationId, type, key, value) => {
      commandsManager.run('setSegmentationStyle', { segmentationId, type, key, value });
    },
    toggleRenderInactiveSegmentations: () => {
      commandsManager.run('toggleRenderInactiveSegmentations');
    },
    onSegmentationRemoveFromViewport: segmentationId => {
      commandsManager.run('removeSegmentationFromViewport', { segmentationId });
    },
    onSegmentationDelete: segmentationId => {
      commandsManager.run('deleteSegmentation', { segmentationId });
    },
    setFillAlpha: ({ type }, value) => {
      commandsManager.run('setFillAlpha', { type, value });
    },
    setOutlineWidth: ({ type }, value) => {
      commandsManager.run('setOutlineWidth', { type, value });
    },
    setRenderFill: ({ type }, value) => {
      commandsManager.run('setRenderFill', { type, value });
    },
    setRenderOutline: ({ type }, value) => {
      commandsManager.run('setRenderOutline', { type, value });
    },
    setFillAlphaInactive: ({ type }, value) => {
      commandsManager.run('setFillAlphaInactive', { type, value });
    },
    getRenderInactiveSegmentations: () => {
      return commandsManager.run('getRenderInactiveSegmentations');
    },
  };

  // Generate export options
  const exportOptions = segmentationsWithRepresentations.map(({ segmentation }) => {
    const { representationData, segmentationId } = segmentation;
    const { Labelmap } = representationData;

    if (!Labelmap) {
      return { segmentationId, isExportable: true };
    }

    // Handle potential type issues with referencedImageIds
    const referencedImageIds = (Labelmap as any).referencedImageIds;
    if (!referencedImageIds || !Array.isArray(referencedImageIds) || referencedImageIds.length === 0) {
      return { segmentationId, isExportable: false };
    }

    const firstImageId = referencedImageIds[0];
    const instance = metaData.get('instance', firstImageId);

    if (!instance) {
      return { segmentationId, isExportable: false };
    }

    const SOPInstanceUID = instance.SOPInstanceUID || instance.SopInstanceUID;
    const SeriesInstanceUID = instance.SeriesInstanceUID;
    const displaySet = displaySetService.getDisplaySetForSOPInstanceUID(
      SOPInstanceUID,
      SeriesInstanceUID
    );

    return {
      segmentationId,
      isExportable: displaySet?.isReconstructable,
    };
  });

  // Common props for SegmentationTable
  const tableProps = {
    disabled,
    data: segmentationsWithRepresentations,
    mode: segmentationTableMode,
    title: 'Segmentations',
    exportOptions,
    disableEditing,
    onSegmentationAdd,
    showAddSegment,
    renderInactiveSegmentations: handlers.getRenderInactiveSegmentations(),
    ...handlers,
  };

  const renderSegments = () => {
    return (
      <SegmentationTable.Segments>
        <SegmentationTable.SegmentStatistics.Header />
        <SegmentationTable.SegmentStatistics.Body />
      </SegmentationTable.Segments>
    );
  };

  // Enhanced dropdown content component with XNAT import/export
  const SimpleDropdownContent = () => {
    if (showImportMenu && viewportData) {
      return (
        <XNATSegmentationImportMenu
          studyInstanceUID={viewportData.studyInstanceUID}
          seriesInstanceUID={viewportData.seriesInstanceUID}
          onClose={onImportCancel}
          servicesManager={servicesManager}
        />
      );
    }

    // Get the active segmentation for export options
    const activeViewportId = viewportGridService.getActiveViewportId();
    const { segmentationService } = servicesManager.services;
    const activeSegmentation = segmentationService.getActiveSegmentation(activeViewportId);
    const hasActiveSegmentation = !!activeSegmentation;
    const activeSegmentationId = activeSegmentation?.segmentationId;

    return (
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onSegmentationAdd()}>
          ➕ Add Segmentation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportFromXNAT}>
          📥 Import from XNAT
        </DropdownMenuItem>
        {hasActiveSegmentation && (
          <>
            <DropdownMenuItem 
              onClick={() => handlers.onSegmentationDownload(activeSegmentationId)}
            >
              💾 Download DICOM SEG
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => commandsManager.run('downloadRTSS', { segmentationId: activeSegmentationId })}
            >
              💾 Download RTSS
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => commandsManager.run('XNATExportSegmentation', { segmentationId: activeSegmentationId })}
            >
              📤 Export to XNAT as SEG
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    );
  };

  // Render content based on mode
  const renderModeContent = () => {
    if (tableProps.mode === 'collapsed') {
      return (
        <SegmentationTable.Collapsed>
          <SegmentationTable.Collapsed.Header>
            <SegmentationTable.Collapsed.DropdownMenu>
              <SimpleDropdownContent />
            </SegmentationTable.Collapsed.DropdownMenu>
            <SegmentationTable.Collapsed.Selector />
            <SegmentationTable.Collapsed.Info />
          </SegmentationTable.Collapsed.Header>
          <SegmentationTable.Collapsed.Content>
            <SegmentationTable.AddSegmentRow />
            {renderSegments()}
          </SegmentationTable.Collapsed.Content>
        </SegmentationTable.Collapsed>
      );
    }

    return (
      <>
        <SegmentationTable.Expanded>
          <SegmentationTable.Expanded.Header>
            <SegmentationTable.Expanded.DropdownMenu>
              <SimpleDropdownContent />
            </SegmentationTable.Expanded.DropdownMenu>
            <SegmentationTable.Expanded.Label />
            <SegmentationTable.Expanded.Info />
          </SegmentationTable.Expanded.Header>

          <SegmentationTable.Expanded.Content>
            <SegmentationTable.AddSegmentRow />
            {renderSegments()}
          </SegmentationTable.Expanded.Content>
        </SegmentationTable.Expanded>
      </>
    );
  };

  return (
    <SegmentationTable {...tableProps}>
      <SegmentationTable.Config />
      <SegmentationTable.AddSegmentationRow />
      {renderModeContent()}
    </SegmentationTable>
  );
}
