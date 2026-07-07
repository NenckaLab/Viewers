import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { ToolButton } from '@ohif/ui-next';

function NestedMenu({ children, label = 'More', icon = 'tool-more-menu', isActive }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleNestedMenu = () => setIsOpen(!isOpen);

  const closeNestedMenu = () => {
    if (isOpen) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    window.addEventListener('click', closeNestedMenu);
    return () => {
      window.removeEventListener('click', closeNestedMenu);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <ToolButton
        id="NestedMenu"
        label={label}
        icon={icon}
        onClick={toggleNestedMenu}
        isActive={isActive || isOpen}
      />
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded bg-black p-2 shadow">
          {children}
        </div>
      )}
    </div>
  );
}

NestedMenu.propTypes = {
  children: PropTypes.any.isRequired,
  icon: PropTypes.string,
  label: PropTypes.string,
};

export default NestedMenu;
