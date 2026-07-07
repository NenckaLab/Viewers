// @ts-nocheck
import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { ToolButton } from '@ohif/ui-next';

function ToolbarSplitButtonWithServices({
  groupId,
  primary,
  secondary,
  items,
  renderer,
  onInteraction,
  servicesManager,
}: withAppTypes) {
  const { toolbarService } = servicesManager?.services;

  /* Bubbles up individual item clicks */
  const getSplitButtonItems = useCallback(
    items =>
      items.map((item, index) => ({
        ...item,
        index,
        onClick: () => {
          onInteraction({
            groupId,
            itemId: item.id,
            commands: item.commands,
          });
        },
      })),
    [groupId, onInteraction]
  );

  const PrimaryButtonComponent =
    toolbarService?.getButtonComponentForUIType(primary.uiType) ?? ToolButton;

  const listItemRenderer = renderer;

  return (
    <div className="relative flex items-center gap-1">
      <PrimaryButtonComponent
        id={primary.id}
        icon={primary.icon}
        label={primary.label}
        commands={primary.commands}
        servicesManager={servicesManager}
        onInteraction={({ itemId, commands }) => {
          onInteraction({ groupId, itemId, commands });
        }}
      />

      <ToolButton
        id={`${groupId}-more`}
        icon={secondary?.icon || 'tool-more-menu'}
        label={secondary?.label || 'More'}
        tooltip={secondary?.tooltip}
        onInteraction={() => {
          // Simple fallback: execute the first enabled item (keeps UI usable without legacy SplitButton)
          const first = getSplitButtonItems(items).find(it => !it.disabled);
          first?.onClick?.();
        }}
      />
    </div>
  );
}

ToolbarSplitButtonWithServices.propTypes = {
  groupId: PropTypes.string,
  primary: PropTypes.shape({
    id: PropTypes.string.isRequired,
    uiType: PropTypes.string,
  }),
  secondary: PropTypes.shape({
    id: PropTypes.string,
    icon: PropTypes.string.isRequired,
    label: PropTypes.string,
    tooltip: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    className: PropTypes.string,
  }),
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      icon: PropTypes.string,
      label: PropTypes.string,
      tooltip: PropTypes.string,
      disabled: PropTypes.bool,
      className: PropTypes.string,
    })
  ),
  renderer: PropTypes.func,
  onInteraction: PropTypes.func.isRequired,
  servicesManager: PropTypes.shape({
    services: PropTypes.shape({
      toolbarService: PropTypes.object,
    }),
  }),
};

export default ToolbarSplitButtonWithServices;
