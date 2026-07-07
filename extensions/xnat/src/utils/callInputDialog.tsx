import React from 'react';
import { Button, Input, LabellingFlow } from '@ohif/ui-next';

/**
 *
 * @param {*} data
 * @param {*} data.text
 * @param {*} data.label
 * @param {*} event
 * @param {*} callback
 * @param {*} isArrowAnnotateInputDialog
 * @param {*} dialogConfig
 * @param {string?} dialogConfig.dialogTitle - title of the input dialog
 * @param {string?} dialogConfig.inputLabel - show label above the input
 */

export function callInputDialog(
  uiDialogService,
  data,
  callback,
  isArrowAnnotateInputDialog = true,
  dialogConfig: any = {}
) {
  const dialogId = 'dialog-enter-annotation';
  const label = data ? (isArrowAnnotateInputDialog ? data.text : data.label) : '';
  const {
    dialogTitle = 'Annotation',
    inputLabel = 'Enter your annotation',
    validateFunc = value => true,
  } = dialogConfig;

  const InputDialogContent = ({ onClose }: any) => {
    const [text, setText] = React.useState(label);

    const save = () => {
      if (typeof validateFunc === 'function' && !validateFunc(text)) {
        return;
      }
      callback(text, 'save');
      onClose();
    };

    const cancel = () => {
      callback('', 'cancel');
      onClose();
    };

    return (
      <div className="max-w-[520px] p-4 text-white">
        <div className="text-[16px] font-medium">{dialogTitle}</div>
        <div className="mt-4">
          <label className="text-[14px] leading-[1.2] text-white">{inputLabel}</label>
          <div className="mt-2">
            <Input
              autoFocus
              type="text"
              id="annotation"
              value={text}
              onChange={(e: any) => setText(e.target.value)}
              onKeyDown={(e: any) => {
                if (e.key === 'Enter') {
                  save();
                }
              }}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
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
      content: InputDialogContent,
      contentProps: {
        onClose: () => uiDialogService.hide(dialogId),
      },
    });
  }
}

export function callLabelAutocompleteDialog(
  uiDialogService,
  callback,
  dialogConfig,
  labelConfig,
  renderContent = LabellingFlow
) {
  const exclusive = labelConfig ? labelConfig.exclusive : false;
  const dropDownItems = labelConfig ? labelConfig.items : [];

  const { validateFunc = value => true } = dialogConfig;

  const labellingDoneCallback = value => {
    if (typeof value === 'string') {
      if (typeof validateFunc === 'function' && !validateFunc(value)) {
        return;
      }
      callback(value, 'save');
    } else {
      callback('', 'cancel');
    }
    uiDialogService.hide('select-annotation');
  };

  uiDialogService.create({
    id: 'select-annotation',
    centralize: true,
    isDraggable: false,
    showOverlay: true,
    content: renderContent,
    contentProps: {
      labellingDoneCallback: labellingDoneCallback,
      measurementData: { label: '' },
      componentClassName: {},
      labelData: dropDownItems,
      exclusive: exclusive,
    },
  });
}

export function showLabelAnnotationPopup(
  measurement,
  uiDialogService,
  labelConfig,
  renderContent = LabellingFlow
) {
  const exclusive = labelConfig ? labelConfig.exclusive : false;
  const dropDownItems = labelConfig ? labelConfig.items : [];
  return new Promise<Map<any, any>>((resolve, reject) => {
    const labellingDoneCallback = value => {
      uiDialogService.hide('select-annotation');
      if (typeof value === 'string') {
        measurement.label = value;
      }
      resolve(measurement);
    };

    uiDialogService.create({
      id: 'select-annotation',
      isDraggable: false,
      showOverlay: true,
      content: renderContent,
      defaultPosition: {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      },
      contentProps: {
        labellingDoneCallback: labellingDoneCallback,
        measurementData: measurement,
        componentClassName: {},
        labelData: dropDownItems,
        exclusive: exclusive,
      },
    });
  });
}

export default callInputDialog;
