import React from 'react';
import { Input, Label, Select, LegacyButton, ButtonGroup } from '@ohif/ui';
import { useTranslation } from 'react-i18next';
import classnames from 'classnames';

export const ROI_STAT = 'roi_stat';
const RANGE = 'range';

const options = [
  { value: ROI_STAT, label: 'Max', placeHolder: 'Max' },
  { value: RANGE, label: 'Range', placeHolder: 'Range' },
];

function RectangleROIThresholdConfiguration({
  showStartEndThresholdSettings = false,
  config,
  dispatch,
  runCommand,
}) {
  const { t } = useTranslation('ROIThresholdConfiguration');

  return (
    <div className="flex flex-col px-4 space-y-4 bg-primary-dark py-2">
      <div className="flex items-end space-x-2">
        <div
          className={classnames('flex flex-col', {
            'w-1/2': showStartEndThresholdSettings,
            'w-full': !showStartEndThresholdSettings,
          })}
        >
          <Select
            label={t('Strategy')}
            closeMenuOnSelect={true}
            className="mr-2 bg-black border-primary-main text-white "
            options={options}
            placeholder={
              options.find(option => option.value === config.strategy)
                .placeHolder
            }
            value={config.strategy}
            onChange={({ value }) => {
              dispatch({
                type: 'setStrategy',
                payload: {
                  strategy: value,
                },
              });
            }}
          />
        </div>
        {showStartEndThresholdSettings && (
          <div className="w-1/2">
            {/* TODO Revisit design of ButtonGroup later - for now use LegacyButton for its children.*/}
            <ButtonGroup>
              <LegacyButton
                size="initial"
                className="px-2 py-2 text-base text-white"
                color="primaryLight"
                variant="outlined"
                onClick={() => runCommand('setStartSliceForROIThresholdTool')}
              >
                {t('Start')}
              </LegacyButton>
              <LegacyButton
                size="initial"
                color="primaryLight"
                variant="outlined"
                className="px-2 py-2 text-base text-white"
                onClick={() => runCommand('setEndSliceForROIThresholdTool')}
              >
                {t('End')}
              </LegacyButton>
            </ButtonGroup>
          </div>
        )}
      </div>

      {config.strategy === ROI_STAT && (
        <Input
          label={t('Percentage of Max SUV')}
          labelClassName="text-white"
          className="mt-2 bg-black border-primary-main"
          type="text"
          containerClassName="mr-2"
          value={config.weight}
          onChange={e => {
            dispatch({
              type: 'setWeight',
              payload: {
                weight: e.target.value,
              },
            });
          }}
        />
      )}
      {config.strategy !== ROI_STAT && (
        <div className="text-sm mr-2">
          <table>
            <tbody>
              <tr className="mt-2">
                <td className="pr-4 pt-2" colSpan="3">
                  <Label
                    className="text-white"
                    text="Lower & Upper Ranges"
                  ></Label>
                </td>
              </tr>
              <tr className="mt-2">
                <td className="text-center pr-4 pt-2">
                  <Label className="text-white" text="CT"></Label>
                </td>
                <td>
                  <div className="flex justify-between">
                    <Input
                      label={t('')}
                      labelClassName="text-white"
                      className="mt-2 bg-black border-primary-main"
                      type="text"
                      containerClassName="mr-2"
                      value={config.ctLower}
                      onChange={e => {
                        dispatch({
                          type: 'setThreshold',
                          payload: {
                            ctLower: e.target.value,
                          },
                        });
                      }}
                    />
                    <Input
                      label={t('')}
                      labelClassName="text-white"
                      className="mt-2 bg-black border-primary-main"
                      type="text"
                      containerClassName="mr-2"
                      value={config.ctUpper}
                      onChange={e => {
                        dispatch({
                          type: 'setThreshold',
                          payload: {
                            ctUpper: e.target.value,
                          },
                        });
                      }}
                    />
                  </div>
                </td>
              </tr>
              <tr>
                <td className="text-center pr-4 pt-2">
                  <Label className="text-white" text="PT"></Label>
                </td>
                <td>
                  <div className="flex justify-between">
                    <Input
                      label={t('')}
                      labelClassName="text-white"
                      className="mt-2 bg-black border-primary-main"
                      type="text"
                      containerClassName="mr-2"
                      value={config.ptLower}
                      onChange={e => {
                        dispatch({
                          type: 'setThreshold',
                          payload: {
                            ptLower: e.target.value,
                          },
                        });
                      }}
                    />
                    <Input
                      label={t('')}
                      labelClassName="text-white"
                      className="mt-2 bg-black border-primary-main"
                      type="text"
                      containerClassName="mr-2"
                      value={config.ptUpper}
                      onChange={e => {
                        dispatch({
                          type: 'setThreshold',
                          payload: {
                            ptUpper: e.target.value,
                          },
                        });
                      }}
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RectangleROIThresholdConfiguration;
