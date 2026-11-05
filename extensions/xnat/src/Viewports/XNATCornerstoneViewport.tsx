/**
 * XNAT wrapper for OHIFCornerstoneViewport that ensures the viewport is enabled
 * when viewportId changes (e.g. when "No protocol matches, defaulting to..." uses
 * a different layout). The cornerstone OHIFCornerstoneViewport only calls
 * enableViewport on mount; when viewportId changes due to protocol fallback,
 * the viewport must be re-enabled before setViewportData runs.
 */
import React, { useLayoutEffect, useEffect } from 'react';
import { OHIFCornerstoneViewport } from '@ohif/extension-cornerstone';
import { useViewportElement, useSystem } from '@ohif/core';
import { recoverFromVolumeRenderingError } from '../utils/volumeRenderingErrorHandler';

interface VolumeErrorBoundaryProps {
  children?: React.ReactNode;
}

interface VolumeErrorBoundaryState {
  hasError: boolean;
}

class VolumeErrorBoundary extends React.Component<
  VolumeErrorBoundaryProps,
  VolumeErrorBoundaryState
> {
  constructor(props: VolumeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    recoverFromVolumeRenderingError();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children as React.ReactNode;
  }
}

function XNATCornerstoneViewport(props: React.ComponentProps<typeof OHIFCornerstoneViewport>) {
  const { viewportOptions } = props;
  const viewportId = viewportOptions?.viewportId;
  const syncGroups = viewportOptions?.syncGroups;
  const { servicesManager } = useSystem();
  const element = useViewportElement<HTMLDivElement>(viewportId || '');
  const { cornerstoneViewportService, syncGroupService } = servicesManager.services;

  // Apply MPR sync groups (camera/pan/zoom) when this viewport's data is set.
  // Sync groups from the HP are in viewportOptions; we add this viewport to them
  // so movement and zoom stay in sync across axial/sagittal/coronal. Done only in XNAT extension.
  useEffect(() => {
    if (!viewportId || !syncGroups?.length || !syncGroupService) return;
    const applySync = () => {
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      if (!viewportInfo) return;
      const renderingEngineId = viewportInfo.getRenderingEngineId?.();
      if (!renderingEngineId) return;
      syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, syncGroups);
    };
    const unsub = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
      (evt: { viewportId: string }) => {
        if (evt.viewportId !== viewportId) return;
        applySync();
      }
    );
    // Apply once in case viewport was already ready before we subscribed
    const t = setTimeout(applySync, 100);
    return () => {
      clearTimeout(t);
      if (typeof unsub === 'function') unsub();
    };
  }, [viewportId, syncGroups, cornerstoneViewportService, syncGroupService]);

  // useLayoutEffect runs synchronously after refs are set, before child's useEffect.
  // This ensures enableViewport runs before loadViewportData->setViewportData.
  useLayoutEffect(() => {
    if (!viewportId || !element) return;
    cornerstoneViewportService.enableViewport(viewportId, element);
  }, [viewportId, element, cornerstoneViewportService]);

  return (
    <VolumeErrorBoundary>
      <OHIFCornerstoneViewport key={viewportId} {...props} servicesManager={servicesManager} />
    </VolumeErrorBoundary>
  );
}

export default XNATCornerstoneViewport;
