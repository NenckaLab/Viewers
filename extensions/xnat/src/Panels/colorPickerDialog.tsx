import React from 'react';
import { Button } from '@ohif/ui-next';
import { ChromePicker } from 'react-color';

import './colorPickerDialog.css';

function callColorPickerDialog(uiDialogService, rgbaColor, callback) {
  const dialogId = 'pick-color';

  const ColorPickerContent = ({ onClose }: any) => {
    const [color, setColor] = React.useState(rgbaColor);

    return (
      <div className="p-4 text-white">
        <div className="text-[16px] font-medium">Segment Color</div>
        <div className="mt-4">
          <ChromePicker
            color={color}
            onChange={(c: any) => setColor(c.rgb)}
            presetColors={[]}
            width={300}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              callback('', 'cancel');
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              callback(color, 'save');
              onClose();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    );
  };

  if (uiDialogService) {
    uiDialogService.create({
      id: dialogId,
      centralize: true,
      isDraggable: false,
      showOverlay: true,
      content: ColorPickerContent,
      contentProps: {
        onClose: () => uiDialogService.hide(dialogId),
      },
    });
  }
}

export default callColorPickerDialog;
