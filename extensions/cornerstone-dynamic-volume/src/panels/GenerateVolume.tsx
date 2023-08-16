import React from 'react';
import Typography from '@ohif/ui';
import { InputDoubleRange } from '@ohif/ui';
import { Select } from '@ohif/ui';
import { Button } from '@ohif/ui';
import PropTypes from 'prop-types';

const GenerateVolume = ({
  rangeValues,
  handleSliderChange,
  operationsUI,
  options,
  handleGenerateOptionsChange,
  onGenerateImage,
  returnTo4D,
}) => {
  return (
    <>
      <div className="marginBottom-10px">Frame Panel</div>
      <div className="w-3">
        <InputDoubleRange
          maxValue={rangeValues[1] || 2}
          minValue={rangeValues[0] || 1}
          onSliderChange={handleSliderChange}
          step={10}
          unit="%"
          valueLeft={rangeValues[0] || 1}
          valueRight={rangeValues[1] || 2}
        />
      </div>
      <Select
        label={'Strategy'}
        closeMenuOnSelect={true}
        className="mr-2 bg-black border-primary-main text-white "
        options={operationsUI}
        placeholder={
          operationsUI.find(option => option.value === options.Operation)
            .placeHolder
        }
        value={options.Operation}
        onChange={({ value }) => {
          handleGenerateOptionsChange({
            Operation: value,
          });
        }}
      />
      <Button color="primary" onClick={onGenerateImage}>
        Generate Image
      </Button>
      <Button color="primary" onClick={returnTo4D}>
        Return To 4D
      </Button>
    </>
  );
};

GenerateVolume.propTypes = {
  rangeValues: PropTypes.array.isRequired,
  handleSliderChange: PropTypes.func.isRequired,
  operationsUI: PropTypes.array.isRequired,
  options: PropTypes.object.isRequired,
  handleGenerateOptionsChange: PropTypes.func.isRequired,
  onGenerateImage: PropTypes.func.isRequired,
  returnTo4D: PropTypes.func.isRequired,
};

export default GenerateVolume;
