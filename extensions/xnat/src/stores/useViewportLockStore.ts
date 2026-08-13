import { create } from 'zustand';

export const VIEWPORT_LOCK_OPTION_IDS = [
  'zoomPanCurrentSeries',
  'zoomPanAllSeries',
  'windowLevelCurrentSeries',
  'windowLevelAllSeries',
] as const;

export type ViewportLockOptionId = (typeof VIEWPORT_LOCK_OPTION_IDS)[number];

export type ViewportLockEnabledMap = Record<ViewportLockOptionId, boolean>;

const DEFAULT_ENABLED: ViewportLockEnabledMap = {
  zoomPanCurrentSeries: false,
  zoomPanAllSeries: false,
  windowLevelCurrentSeries: false,
  windowLevelAllSeries: false,
};

type ViewportLockStore = {
  enabled: ViewportLockEnabledMap;
  toggle: (optionId: ViewportLockOptionId) => void;
  setEnabled: (optionId: ViewportLockOptionId, enabled: boolean) => void;
  clear: () => void;
  hasAnyEnabled: () => boolean;
};

export const useViewportLockStore = create<ViewportLockStore>((set, get) => ({
  enabled: { ...DEFAULT_ENABLED },

  toggle: optionId =>
    set(state => ({
      enabled: {
        ...state.enabled,
        [optionId]: !state.enabled[optionId],
      },
    })),

  setEnabled: (optionId, enabled) =>
    set(state => ({
      enabled: {
        ...state.enabled,
        [optionId]: enabled,
      },
    })),

  clear: () => set({ enabled: { ...DEFAULT_ENABLED } }),

  hasAnyEnabled: () => Object.values(get().enabled).some(Boolean),
}));
