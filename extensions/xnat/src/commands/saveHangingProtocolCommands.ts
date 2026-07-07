import sessionMap from '../utils/sessionMap';
import { serializeCurrentHangingProtocol } from '../utils/hangingProtocol/serializeCurrentHangingProtocol';
import { saveUserHangingProtocol } from '../utils/hangingProtocol/hangingProtocolApi';
import createHangingProtocolDialogPrompt from '../Panels/createHangingProtocolDialogPrompt';
import PROMPT_RESPONSES from '../utils/_shared/PROMPT_RESPONSES';

function resolveProjectId(): string | null {
  const query = new URLSearchParams(window.location.search);
  return (
    query.get('projectId') ||
    sessionMap.getProject?.() ||
    sessionStorage.getItem('xnat_projectId')
  );
}

export const createSaveHangingProtocolCommands = (servicesManager: any, commandsManager: any) => {
  const { hangingProtocolService, uiNotificationService } = servicesManager.services;

  const actions = {
    saveHangingProtocolToXnat: async ({
      name,
      protocolId,
      setAsDefault = true,
    }: {
      name?: string;
      protocolId?: string;
      setAsDefault?: boolean;
    } = {}) => {
      const projectId = resolveProjectId();
      if (!projectId) {
        uiNotificationService.show({
          title: 'Save Hanging Protocol',
          message: 'No project ID is available for this viewer session.',
          type: 'error',
          duration: 4000,
        });
        return false;
      }

      let resolvedName = name?.trim();
      if (!resolvedName) {
        const { uiDialogService } = servicesManager.services;
        const promptResult = await createHangingProtocolDialogPrompt(uiDialogService);
        if (!promptResult?.value || promptResult.action !== PROMPT_RESPONSES.CREATE_REPORT) {
          return false;
        }
        resolvedName = promptResult.value;
      }

      try {
        const protocol = serializeCurrentHangingProtocol(servicesManager, {
          name: resolvedName,
          protocolId,
        });

        await saveUserHangingProtocol({
          projectId,
          protocol,
          setAsDefault,
        });

        hangingProtocolService.addProtocol(protocol.id, protocol);

        if (setAsDefault) {
          const url = new URL(window.location.href);
          url.searchParams.set('xnathangingprotocolId', protocol.id);
          window.history.replaceState({}, '', `${url.pathname}${url.search}`);

          commandsManager.run('setHangingProtocol', {
            protocolId: protocol.id,
            reset: true,
          });
        }

        uiNotificationService.show({
          title: 'Save Hanging Protocol',
          message: `Saved "${protocol.name}" for this project. It will be used the next time you open the viewer here.`,
          type: 'success',
          duration: 5000,
        });
        return true;
      } catch (error) {
        console.error('Failed to save hanging protocol to XNAT:', error);
        uiNotificationService.show({
          title: 'Save Hanging Protocol',
          message: 'The hanging protocol could not be saved to XNAT.',
          type: 'error',
          duration: 4000,
        });
        return false;
      }
    },
  };

  return actions;
};
