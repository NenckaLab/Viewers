const STACK_PROTOCOL_ID = 'default';

type VolumeErrorHandlerDeps = {
  servicesManager: {
    services: {
      hangingProtocolService?: {
        getState: () => { protocolId?: string };
        setProtocol: (protocolId: string) => void;
        subscribe: (
          event: string,
          callback: (payload: { protocol?: { id?: string } }) => void
        ) => void;
        EVENTS?: { PROTOCOL_CHANGED?: string };
      };
      cornerstoneViewportService?: {
        getRenderingEngine: () => { render?: () => void } | undefined;
      };
      uiNotificationService?: {
        show: (options: {
          title: string;
          message: string;
          type: string;
          duration: number;
        }) => void;
      };
    };
  };
  commandsManager?: {
    run: (commandName: string, options?: Record<string, unknown>) => void;
  };
};

let registered = false;
let hasRetried = false;
let hasFallenBack = false;
let recoveryPhase: 'idle' | 'retrying' | 'fallingBack' = 'idle';
let deps: VolumeErrorHandlerDeps | null = null;

export function isVolumeRenderingError(message?: string, stack?: string): boolean {
  const msg = String(message || '').toLowerCase();
  const st = String(stack || '').toLowerCase();
  const fromStack =
    st.includes('setmappershaderparameters') ||
    st.includes('updateshaders') ||
    st.includes('vtkvolumefs');

  return (
    msg.includes('error compiling shader') ||
    msg.includes('vtkvolumefs') ||
    (msg.includes('cannot read properties of null') &&
      (msg.includes('isattributeused') || fromStack)) ||
    (msg.includes('isattributeused') && msg.includes('setmappershaderparameters')) ||
    fromStack
  );
}

export function swallowVolumeErrorEvent(event: Event): void {
  if ('preventDefault' in event) {
    event.preventDefault();
  }
  if ('stopImmediatePropagation' in event) {
    event.stopImmediatePropagation();
  }
}

function retryVolumeRender(): void {
  try {
    deps?.servicesManager.services.cornerstoneViewportService
      ?.getRenderingEngine()
      ?.render?.();
  } catch (error) {
    console.warn('XNAT: Volume render retry failed:', error);
  }
}

function applyStackProtocol(): void {
  const hangingProtocolService = deps?.servicesManager.services.hangingProtocolService;
  if (!hangingProtocolService) {
    return;
  }

  try {
    deps?.commandsManager?.run('setHangingProtocol', {
      protocolId: STACK_PROTOCOL_ID,
      reset: true,
    });
  } catch (error) {
    console.warn('XNAT: Failed to apply stack protocol after volume error:', error);
  }

  if (hangingProtocolService.getState()?.protocolId !== STACK_PROTOCOL_ID) {
    try {
      hangingProtocolService.setProtocol(STACK_PROTOCOL_ID);
    } catch (fallbackError) {
      console.warn('XNAT: Stack protocol fallback failed:', fallbackError);
    }
  }

  if (hangingProtocolService.getState()?.protocolId === STACK_PROTOCOL_ID) {
    deps?.servicesManager.services.uiNotificationService?.show({
      title: 'Volume rendering',
      message: 'MPR volume rendering failed. Switched to a stack view.',
      type: 'warning',
      duration: 5000,
    });
  }
}

/**
 * Recover from VTK volume-mapper failures (null program / isAttributeUsed).
 * First burst: retry render. If it fails again, switch to the stack default protocol.
 */
export function recoverFromVolumeRenderingError(): void {
  if (!deps || recoveryPhase !== 'idle' || hasFallenBack) {
    return;
  }

  const hangingProtocolService = deps.servicesManager.services.hangingProtocolService;
  const protocolId = hangingProtocolService?.getState()?.protocolId;
  if (protocolId === STACK_PROTOCOL_ID) {
    return;
  }

  if (!hasRetried) {
    hasRetried = true;
    recoveryPhase = 'retrying';
    setTimeout(() => {
      retryVolumeRender();
      recoveryPhase = 'idle';
    }, 200);
    return;
  }

  hasFallenBack = true;
  recoveryPhase = 'fallingBack';
  setTimeout(() => {
    applyStackProtocol();
    recoveryPhase = 'idle';
  }, 50);
}

export function registerVolumeRenderingErrorHandler(nextDeps: VolumeErrorHandlerDeps): void {
  deps = nextDeps;

  if (registered) {
    return;
  }
  registered = true;

  const hangingProtocolService = nextDeps.servicesManager.services.hangingProtocolService;
  const protocolChanged = hangingProtocolService?.EVENTS?.PROTOCOL_CHANGED;
  if (hangingProtocolService && protocolChanged) {
    try {
      hangingProtocolService.subscribe(protocolChanged, ({ protocol }) => {
        if (protocol?.id && protocol.id !== STACK_PROTOCOL_ID) {
          hasRetried = false;
          hasFallenBack = false;
          recoveryPhase = 'idle';
        }
      });
    } catch (error) {
      console.warn('XNAT: Could not subscribe to protocol changes for volume error recovery:', error);
    }
  }

  window.addEventListener(
    'error',
    event => {
      const message = String(event.message || event.error?.message || '');
      const stack = String(event.error?.stack || '');
      if (!isVolumeRenderingError(message, stack)) {
        return;
      }
      swallowVolumeErrorEvent(event);
      recoverFromVolumeRenderingError();
    },
    true
  );

  window.addEventListener(
    'unhandledrejection',
    event => {
      const reason = event.reason;
      const message = String(reason?.message ?? reason ?? '');
      const stack = String(reason?.stack ?? '');
      if (!isVolumeRenderingError(message, stack)) {
        return;
      }
      swallowVolumeErrorEvent(event);
      recoverFromVolumeRenderingError();
    },
    true
  );
}
