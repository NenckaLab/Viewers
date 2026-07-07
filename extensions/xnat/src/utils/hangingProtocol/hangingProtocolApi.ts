type ManifestFileEntry = {
  id: string;
  label: string;
  url: string;
};

type HangingProtocolManifest = {
  files: ManifestFileEntry[];
  defaultProtocolId?: string;
};

function getXnatBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

function getUserManifestUrl(projectId: string): string {
  return `${getXnatBaseUrl()}/xapi/viewer/users/me/projects/${encodeURIComponent(projectId)}/hanging-protocols/manifest.json`;
}

function getUserProtocolUrl(projectId: string, protocolId: string): string {
  return `${getXnatBaseUrl()}/xapi/viewer/users/me/projects/${encodeURIComponent(projectId)}/hanging-protocols/${encodeURIComponent(protocolId)}.json`;
}

function getUserDefaultProtocolPrefUrl(projectId: string): string {
  return `${getXnatBaseUrl()}/xapi/user-options/prefs/me/hanging-protocol/${encodeURIComponent(projectId)}?format=plain`;
}

async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status} for ${url}: ${message}`);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      // Some XAPI PUT endpoints return plain text with a JSON content type.
      return null;
    }
  }

  return response.text();
}

async function putJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status} for ${url}: ${message}`);
  }
}

export async function fetchUserHangingProtocolManifest(
  projectId: string
): Promise<HangingProtocolManifest | null> {
  if (!projectId) {
    return null;
  }

  const payload = await fetchJson(getUserManifestUrl(projectId));
  if (!payload || !Array.isArray(payload.files)) {
    return { files: [] };
  }

  return payload as HangingProtocolManifest;
}

export async function saveUserHangingProtocol({
  projectId,
  protocol,
  setAsDefault = true,
}: {
  projectId: string;
  protocol: Record<string, any>;
  setAsDefault?: boolean;
}): Promise<void> {
  if (!projectId) {
    throw new Error('A project ID is required to save a hanging protocol.');
  }

  const protocolId = protocol?.id;
  if (!protocolId || typeof protocolId !== 'string') {
    throw new Error('The hanging protocol must include a string id.');
  }

  const protocolUrl = getUserProtocolUrl(projectId, protocolId);
  await putJson(protocolUrl, protocol);

  const existingManifest = (await fetchUserHangingProtocolManifest(projectId)) || { files: [] };
  const label = protocol.name || protocolId;
  const manifestEntry: ManifestFileEntry = {
    id: protocolId,
    label,
    url: protocolUrl,
  };

  const files = [
    ...existingManifest.files.filter(entry => entry.id !== protocolId),
    manifestEntry,
  ];

  await putJson(getUserManifestUrl(projectId), {
    files,
    defaultProtocolId: protocolId,
  });

  if (setAsDefault) {
    try {
      const response = await fetch(getUserDefaultProtocolPrefUrl(projectId), {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: protocolId,
      });
      if (!response.ok) {
        console.warn(
          `Could not update user-options hanging protocol preference (${response.status}); default stored in manifest.`
        );
      }
    } catch (error) {
      console.warn(
        'Could not update user-options hanging protocol preference; default stored in manifest.',
        error
      );
    }
  }
}

export function getUserHangingProtocolSources(projectId: string): string[] {
  if (!projectId) {
    return [];
  }

  return [getUserManifestUrl(projectId)];
}

export async function fetchUserDefaultProtocolId(projectId: string): Promise<string | null> {
  if (!projectId) {
    return null;
  }

  const manifest = await fetchUserHangingProtocolManifest(projectId);
  if (manifest?.defaultProtocolId) {
    return manifest.defaultProtocolId;
  }

  try {
    const pref = await fetchJson(getUserDefaultProtocolPrefUrl(projectId));
    if (typeof pref === 'string' && pref.trim()) {
      return pref.trim();
    }
  } catch (error) {
    console.warn('Could not read user-options hanging protocol preference:', error);
  }

  return null;
}
