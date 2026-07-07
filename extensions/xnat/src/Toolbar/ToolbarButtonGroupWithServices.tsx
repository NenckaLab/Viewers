import React, { useCallback } from 'react';
import { ToolButton } from '@ohif/ui-next';

function ToolbarButtonGroupWithServices({ groupId, items, onInteraction, size }) {
  const getSplitButtonItems = useCallback(
    items =>
      items.map((item, index) => (
        <ToolButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          disabled={item.disabled}
          className={item.className}
          id={item.id}
          size={size}
          onInteraction={() =>
            onInteraction({
              groupId,
              itemId: item.id,
              commands: item.commands,
            })
          }
        />
      )),
    [onInteraction, groupId]
  );

  return <div className="flex gap-1">{getSplitButtonItems(items)}</div>;
}

export default ToolbarButtonGroupWithServices;
