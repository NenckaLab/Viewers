import React, { ReactElement } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import {
  ProgressDropdownOption,
  ProgressDropdownOptionPropType,
} from './types';

const ProgressDiscreteBar = ({
  options,
}: {
  options: ProgressDropdownOption[];
}): ReactElement => {
  return (
    <div className="flex">
      {options.map((option, i) => (
        <div
          key={i}
          className={classnames(
            'h-1 grow mr-1 last:mr-0 first:rounded-l-sm last:rounded-r-sm',
            {
              'bg-black': !option.activated && !option.completed,
              'bg-primary-main': option.activated && !option.completed,
              'bg-primary-light': option.completed,
            }
          )}
        />
      ))}
    </div>
  );
};

ProgressDiscreteBar.propTypes = {
  options: PropTypes.arrayOf(ProgressDropdownOptionPropType).isRequired,
};

export default ProgressDiscreteBar;
