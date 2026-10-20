import { isReversedSliceOrder, labelmapImagePixelModule, withGeneralImageModule } from './importSegmentation';

describe('isReversedSliceOrder', () => {
  const forward = ['a', 'b', 'c'];

  it('is false when the labelmap already matches the viewport', () => {
    expect(isReversedSliceOrder(forward, forward)).toBe(false);
  });

  it('is true when the labelmap runs opposite the viewport', () => {
    expect(isReversedSliceOrder(['c', 'b', 'a'], forward)).toBe(true);
  });

  it('is false when the orders differ but are not a pure reverse', () => {
    expect(isReversedSliceOrder(['b', 'a', 'c'], forward)).toBe(false);
  });
});

describe('withGeneralImageModule', () => {
  const provider = {
    get(type: string, imageId: string) {
      if (type === 'imagePlaneModule') {
        return { rows: 4, columns: 4 };
      }
      if (type === 'sopCommonModule' && imageId === 'image-1') {
        return { sopInstanceUID: '1.2.3' };
      }
      if (type === 'instance' && imageId === 'image-2') {
        return { SOPInstanceUID: '1.2.4', InstanceNumber: 2 };
      }
      return undefined;
    },
  };

  const wrapped = withGeneralImageModule(provider);

  it('keeps other metadata modules unchanged', () => {
    expect(wrapped.get('imagePlaneModule', 'image-1')).toEqual({ rows: 4, columns: 4 });
  });

  it('fills sopInstanceUID from sopCommonModule when generalImageModule is missing', () => {
    expect(wrapped.get('generalImageModule', 'image-1')).toEqual({
      sopInstanceUID: '1.2.3',
      instanceNumber: undefined,
    });
  });

  it('builds an unsigned 8-bit pixel module when the source image has none', () => {
    expect(labelmapImagePixelModule(undefined)).toEqual({
      bitsAllocated: 8,
      bitsStored: 8,
      highBit: 7,
      samplesPerPixel: 1,
      pixelRepresentation: 0,
      photometricInterpretation: 'MONOCHROME2',
    });
  });

  it('keeps source pixel fields and forces labelmap storage', () => {
    expect(
      labelmapImagePixelModule({
        photometricInterpretation: 'MONOCHROME2',
        pixelRepresentation: 1,
        bitsAllocated: 16,
      })
    ).toMatchObject({
      photometricInterpretation: 'MONOCHROME2',
      pixelRepresentation: 0,
      bitsAllocated: 8,
    });
  });

  it('fills sopInstanceUID from the instance when the file has not been decoded', () => {
    expect(wrapped.get('generalImageModule', 'image-2')).toEqual({
      sopInstanceUID: '1.2.4',
      instanceNumber: 2,
    });
  });
});
