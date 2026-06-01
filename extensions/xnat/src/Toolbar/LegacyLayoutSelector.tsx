import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { LayoutSelector as OHIFLayoutSelector } from '@ohif/ui-next';

function LegacyLayoutSelectorWithServices({
  servicesManager,
  rows = 3,
  columns = 3,
  onLayoutChange = () => {},
  ...props
}) {
  const { toolbarService } = servicesManager.services;

  const onSelection = useCallback(
    props => {
      toolbarService.recordInteraction({
        interactionType: 'action',
        commands: [
          {
            commandName: 'setViewportGridLayout',
            commandOptions: { ...props },
            context: 'DEFAULT',
          },
        ],
      });
    },
    [toolbarService]
  );

  return (
    <OHIFLayoutSelector
      {...props}
      rows={rows}
      columns={columns}
      onSelection={onSelection}
    />
  );
}

LayoutSelector.propTypes = {
  rows: PropTypes.number,
  columns: PropTypes.number,
  onLayoutChange: PropTypes.func,
  servicesManager: PropTypes.object.isRequired,
};

export default LegacyLayoutSelectorWithServices;
