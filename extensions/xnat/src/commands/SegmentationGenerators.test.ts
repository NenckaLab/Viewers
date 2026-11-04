import { resolveSegmentationForExport } from './SegmentationGenerators';

describe('resolveSegmentationForExport', () => {
  const active = { segmentationId: 'active-seg' };
  const named = { segmentationId: 'named-seg' };

  const segmentationService = {
    getSegmentation: (segmentationId: string) =>
      segmentationId === 'named-seg' ? named : undefined,
    getActiveSegmentation: (viewportId: string) =>
      viewportId === 'xnat-mpr-axial' ? active : undefined,
  };

  it('uses the segmentation the viewer service already has', () => {
    expect(resolveSegmentationForExport(segmentationService, 'named-seg', 'xnat-mpr-axial')).toBe(
      named
    );
  });

  it('falls back to the active viewport segmentation when the id is missing', () => {
    expect(
      resolveSegmentationForExport(segmentationService, undefined, 'xnat-mpr-axial')
    ).toBe(active);
  });

  it('returns undefined when neither the id nor the viewport has a segmentation', () => {
    expect(resolveSegmentationForExport(segmentationService, 'missing', 'other-viewport')).toBe(
      undefined
    );
  });
});
