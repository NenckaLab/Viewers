import React, { useState } from 'react';
import { Button, Input } from '@ohif/ui-next';
import PROMPT_RESPONSES from '../utils/_shared/PROMPT_RESPONSES';

function SaveHangingProtocolDialogContent({ title, initialValue, onCancel, onSave }: any) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="max-w-[520px] p-4 text-white">
      <div className="text-[16px] font-medium">{title}</div>
      <p className="text-muted-foreground mt-2 text-sm">
        Save the current viewport layout for this XNAT project. The saved layout will open
        automatically the next time you view images in this project.
      </p>

      <div className="mt-4">
        <label className="text-[14px] leading-[1.2] text-white">Layout name</label>
        <div className="mt-2">
          <Input
            autoFocus
            type="text"
            value={value}
            placeholder="e.g. Chest 2x2"
            onChange={(e: any) => setValue(e.target.value)}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' && value.trim()) {
                onSave(value.trim());
              }
            }}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!value.trim()} onClick={() => onSave(value.trim())}>
          Save
        </Button>
      </div>
    </div>
  );
}

export default function createHangingProtocolDialogPrompt(uiDialogService) {
  return new Promise<{ action: string; value?: string }>(resolve => {
    const dialogId = 'save-hanging-protocol-dialog';

    uiDialogService.show({
      id: dialogId,
      title: 'Save Hanging Protocol',
      shouldCloseOnEsc: true,
      content: SaveHangingProtocolDialogContent,
      contentProps: {
        title: 'Save Hanging Protocol',
        initialValue: '',
        onCancel: () => {
          uiDialogService.hide(dialogId);
          resolve({ action: PROMPT_RESPONSES.CANCEL });
        },
        onSave: (value: string) => {
          uiDialogService.hide(dialogId);
          resolve({ action: PROMPT_RESPONSES.CREATE_REPORT, value });
        },
      },
    });
  });
}
