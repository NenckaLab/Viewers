import React from 'react';
import PropTypes from 'prop-types';
import OverreadNavigationPanel from '../xnat-components/OverreadNavigationPanel';

/**
 * Wraps the OverreadNavigationPanel and provides services
 * 
 * @param {object} params
 * @param {object} extensionManager
 * @param {object} servicesManager
 * @param {object} commandsManager
 */
function WrappedOverreadNavigationPanel({ extensionManager, servicesManager, commandsManager }) {
  return (
    <div className="h-full">
      <OverreadNavigationPanel
        servicesManager={servicesManager}
      />
    </div>
  );
}

WrappedOverreadNavigationPanel.propTypes = {
  extensionManager: PropTypes.object.isRequired,
  servicesManager: PropTypes.object.isRequired,
  commandsManager: PropTypes.object.isRequired,
};

export default WrappedOverreadNavigationPanel; 