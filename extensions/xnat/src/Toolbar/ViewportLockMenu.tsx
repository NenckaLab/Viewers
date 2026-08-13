import React from 'react';
import { useSystem } from '@ohif/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icons,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ohif/ui-next';
import { VIEWPORT_LOCK_OPTIONS } from '../utils/viewportLocks';
import { useViewportLockStore } from '../stores/useViewportLockStore';

type ViewportLockMenuProps = {
  id: string;
  disabled?: boolean;
  disabledText?: string;
};

export default function ViewportLockMenu({
  id,
  disabled = false,
  disabledText,
}: ViewportLockMenuProps) {
  const { commandsManager } = useSystem();
  const enabled = useViewportLockStore(state => state.enabled);
  const anyEnabled = Object.values(enabled).some(Boolean);

  const tooltip = disabled && disabledText ? disabledText : 'Lock zoom, pan, and window level';

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={disabled}
                data-cy={id}
                aria-label="Viewport lock"
                className={[
                  '!rounded-lg inline-flex h-10 w-10 items-center justify-center',
                  disabled
                    ? 'text-foreground cursor-not-allowed opacity-40 hover:bg-muted hover:text-highlight'
                    : anyEnabled
                      ? 'bg-transparent text-highlight hover:bg-muted'
                      : 'text-foreground/80 hover:bg-background hover:text-highlight bg-transparent',
                ].join(' ')}
              >
                <Icons.ByName
                  name="Lock"
                  className="h-7 w-7"
                />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="bottom"
      >
        {VIEWPORT_LOCK_OPTIONS.map((option, index) => {
          const previous = VIEWPORT_LOCK_OPTIONS[index - 1];
          const showSeparator = previous && previous.group !== option.group;

          return (
            <React.Fragment key={option.id}>
              {showSeparator && <DropdownMenuSeparator />}
              <DropdownMenuCheckboxItem
                checked={enabled[option.id]}
                disabled={disabled}
                data-cy={`ViewportLock-${option.id}`}
                onSelect={event => event.preventDefault()}
                onCheckedChange={() => {
                  commandsManager.runCommand('toggleViewportLock', {
                    optionId: option.id,
                  });
                }}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            </React.Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
