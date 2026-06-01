import React, { useMemo, useState } from 'react';

import { Button, Input } from '@ohif/ui-next';
import { Select } from '@ohif/ui';
import PROMPT_RESPONSES from '../utils/_shared/PROMPT_RESPONSES';

function CreateReportDialogContent({
  title,
  initialValue,
  onCancel,
  onSave,
  dataSourcesOpts,
}: any) {
  const [value, setValue] = useState(initialValue);

  const selectedDataSource = useMemo(
    () => dataSourcesOpts.find((o: any) => o.value === value.dataSourceName) ?? null,
    [dataSourcesOpts, value.dataSourceName]
  );

  return (
    <div className="max-w-[520px] p-4 text-white">
      <div className="text-[16px] font-medium">{title}</div>

      {dataSourcesOpts.length > 1 && (window as any).config?.allowMultiSelectExport && (
        <div className="mt-4">
          <label className="text-[14px] leading-[1.2] text-white">Data Source</label>
          <div className="mt-2">
            <Select
              id="xnat-create-report-data-source"
              options={dataSourcesOpts}
              value={selectedDataSource}
              onChange={opt =>
                setValue(v => ({ ...v, dataSourceName: (opt as any)?.value ?? v.dataSourceName }))
              }
              isClearable={false}
            />
          </div>
        </div>
      )}

      <div className="mt-4">
        <label className="text-[14px] leading-[1.2] text-white">Enter the report name</label>
        <div className="mt-2">
          <Input
            autoFocus
            type="text"
            value={value.label}
            onChange={(e: any) => setValue((v: any) => ({ ...v, label: e.target.value }))}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter') {
                onSave(value);
              }
            }}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(value)}>Save</Button>
      </div>
    </div>
  );
}

export default function CreateReportDialogPrompt(uiDialogService, { extensionManager }) {
  return new Promise(function (resolve, reject) {
    let dialogId = undefined;

    const _handleClose = () => {
      // Dismiss dialog
      uiDialogService.hide(dialogId);
      // Notify of cancel action
      resolve({
        action: PROMPT_RESPONSES.CANCEL,
        value: undefined,
        dataSourceName: undefined,
      });
    };

    /**
     *
     * @param {string} param0.action - value of action performed
     * @param {string} param0.value - value from input field
     */
    const _handleFormSubmit = ({ action, value }) => {
      uiDialogService.hide(dialogId);
      switch (action.id) {
        case 'save':
          resolve({
            action: PROMPT_RESPONSES.CREATE_REPORT,
            value: value.label,
            dataSourceName: value.dataSourceName,
          });
          break;
        case 'cancel':
          resolve({
            action: PROMPT_RESPONSES.CANCEL,
            value: undefined,
            dataSourceName: undefined,
          });
          break;
      }
    };

    const dataSourcesOpts = Object.keys(extensionManager.dataSourceMap)
      .filter(ds => {
        const configuration = extensionManager.dataSourceDefs[ds]?.configuration;
        const supportsStow = configuration?.supportsStow ?? configuration?.wadoRoot;
        return supportsStow;
      })
      .map(ds => {
        return {
          value: ds,
          label: ds,
          placeHolder: ds,
        };
      });

    dialogId = uiDialogService.create({
      centralize: true,
      isDraggable: false,
      content: CreateReportDialogContent,
      useLastPosition: false,
      showOverlay: true,
      contentProps: {
        title: 'Create Report',
        initialValue: {
          label: '',
          dataSourceName: extensionManager.activeDataSource,
        },
        dataSourcesOpts,
        onCancel: _handleClose,
        onSave: (value: any) => _handleFormSubmit({ action: { id: 'save' }, value }),
      },
    });
  });
}
