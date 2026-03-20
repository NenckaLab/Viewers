/**
 * Toolbar utility functions
 * Extracted from getToolbarModule.tsx
 */

import { utils } from '@ohif/ui-next';
import { Enums } from '@cornerstonejs/tools';
import type { ToggleEvaluateParams, EvaluateFunctionResult } from './ToolbarTypes';

/**
 * Default tool button surface classes (align with ui-next ToolButton defaultClasses).
 * Returned when a tool is enabled so ToolbarService's `className || props.className` merge
 * replaces stale disabled styling after layout / HP changes.
 */
export const TOOL_BUTTON_DEFAULT_CLASSNAME =
  'bg-transparent text-foreground/80 hover:bg-background hover:text-highlight';

/** Matches ui-next ToolButton activeClasses when the tool is the primary active tool */
export const TOOL_BUTTON_ACTIVE_CLASSNAME = 'bg-highlight text-background hover:!bg-highlight/80';

// Rely on `disabled: true` for ToolButton styling; avoid extra className so it cannot stick
// across refreshes when the platform merge uses `||`.
export const getDisabledState = (disabledText?: string) => ({
  disabled: true,
  disabledText: disabledText || 'Not available',
});

/**
 * Evaluate toggle state for cornerstone tools
 * @param params - Parameters for toggle evaluation
 * @returns Evaluation result
 */
export function _evaluateToggle({
  viewportId,
  toolbarService,
  button,
  disabledText,
  offModes,
  toolGroupService,
}: ToggleEvaluateParams): EvaluateFunctionResult | undefined {
  const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);

  if (!toolGroup) {
    // Layout / HP switches can run toolbar refresh before the viewport is attached to a tool
    // group; avoid leaving a stale toggled-on appearance from the previous viewport.
    return {
      className: utils.getToggledClassName(false),
    };
  }
  const toolName = toolbarService.getToolNameForButton(button);

  if (!toolGroup?.hasTool(toolName)) {
    return getDisabledState(disabledText);
  }

  const isOff = offModes.includes(toolGroup.getToolOptions(toolName).mode);

  return {
    className: utils.getToggledClassName(!isOff),
  };
}
