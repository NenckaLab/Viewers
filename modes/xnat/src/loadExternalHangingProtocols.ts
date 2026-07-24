type HangingProtocolLike = Record<string, any>;

type HangingProtocolModuleLike = {
  id?: string;
  name?: string;
  protocol?: HangingProtocolLike;
};

type ExternalHangingProtocolsPayload =
  | HangingProtocolLike
  | HangingProtocolModuleLike
  | HangingProtocolLike[]
  | HangingProtocolModuleLike[]
  | {
      protocols?: Array<HangingProtocolLike | HangingProtocolModuleLike>;
      hangingProtocols?: Array<HangingProtocolLike | HangingProtocolModuleLike>;
      items?: Array<HangingProtocolLike | HangingProtocolModuleLike>;
    };

type ExternalProtocolFileEntry = {
  id?: string;
  name?: string;
  label?: string;
  url?: string;
  fromManifest?: boolean;
};

type ExternalHangingProtocolManifestPayload =
  | string[]
  | ExternalProtocolFileEntry[]
  | {
      files?: Array<string | ExternalProtocolFileEntry>;
      items?: Array<string | ExternalProtocolFileEntry>;
      sources?: Array<string | ExternalProtocolFileEntry>;
      protocolFiles?: Array<string | ExternalProtocolFileEntry>;
    };

type ExternalProtocolFileRegistryEntry = {
  sourceUrl: string;
  sourceName?: string;
  sourceLabel?: string;
  fromManifest: boolean;
  protocolIds: string[];
  loaded: boolean;
  error?: string;
};

type ExternalHangingProtocolRegistry = {
  updatedAt: string;
  files: ExternalProtocolFileRegistryEntry[];
};

const loadedSources = new Set<string>();
const loadedProtocolIds = new Set<string>();
const loadedProtocolIdsBySource = new Map<string, string[]>();
const fileRegistryByUrl = new Map<string, ExternalProtocolFileRegistryEntry>();

function updateRegistry(
  sourceUrl: string,
  update: Partial<ExternalProtocolFileRegistryEntry> & Pick<ExternalProtocolFileRegistryEntry, 'fromManifest'>
): void {
  const existing = fileRegistryByUrl.get(sourceUrl) || {
    sourceUrl,
    fromManifest: update.fromManifest,
    loaded: false,
    protocolIds: [],
  };

  const nextEntry: ExternalProtocolFileRegistryEntry = {
    ...existing,
    ...update,
    sourceUrl,
    fromManifest: existing.fromManifest || update.fromManifest,
    protocolIds: Array.from(new Set(update.protocolIds || existing.protocolIds || [])),
  };

  fileRegistryByUrl.set(sourceUrl, nextEntry);
  publishRegistry();
}

function publishRegistry(): void {
  const registry: ExternalHangingProtocolRegistry = {
    updatedAt: new Date().toISOString(),
    files: Array.from(fileRegistryByUrl.values()),
  };

  (window as any).__xnatExternalHangingProtocols = registry;
  window.dispatchEvent(
    new CustomEvent('xnat:external-hanging-protocols-updated', {
      detail: registry,
    })
  );
}

export function getExternalHangingProtocolRegistry(): ExternalHangingProtocolRegistry | null {
  return (window as any).__xnatExternalHangingProtocols ?? null;
}

function normalizeProtocolItem(item: HangingProtocolLike | HangingProtocolModuleLike): HangingProtocolLike | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const candidate = 'protocol' in item && item.protocol ? item.protocol : item;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const protocolId = candidate.id || ('id' in item ? item.id : undefined) || ('name' in item ? item.name : undefined);
  if (!protocolId || typeof protocolId !== 'string') {
    return null;
  }

  return {
    ...candidate,
    id: protocolId,
  };
}

function normalizePayload(payload: ExternalHangingProtocolsPayload): HangingProtocolLike[] {
  const wrappedPayload = payload as {
    protocols?: Array<HangingProtocolLike | HangingProtocolModuleLike>;
    hangingProtocols?: Array<HangingProtocolLike | HangingProtocolModuleLike>;
    items?: Array<HangingProtocolLike | HangingProtocolModuleLike>;
  };

  const items = Array.isArray(payload)
    ? payload
    : (wrappedPayload.protocols ||
        wrappedPayload.hangingProtocols ||
        wrappedPayload.items ||
        [payload]);

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(normalizeProtocolItem)
    .filter((item): item is HangingProtocolLike => Boolean(item));
}

function getExternalProtocolSources(query: URLSearchParams): string[] {
  const queryUrls = query
    .getAll('xnatHangingProtocolsUrl')
    .concat(query.getAll('hangingProtocolsUrl'))
    .concat(query.getAll('hangingProtocolUrl'));

  const globalConfig = (window as any).config ?? {};
  const xnatConfig = globalConfig?.xnat ?? {};

  const configUrls = [
    xnatConfig.externalHangingProtocolsUrl,
    ...(Array.isArray(xnatConfig.externalHangingProtocolsUrls)
      ? xnatConfig.externalHangingProtocolsUrls
      : []),
    globalConfig.externalHangingProtocolsUrl,
    ...(Array.isArray(globalConfig.externalHangingProtocolsUrls)
      ? globalConfig.externalHangingProtocolsUrls
      : []),
  ];

  const normalized = queryUrls
    .concat(configUrls)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim());

  return Array.from(new Set(normalized));
}

function getManifestUrls(query: URLSearchParams): string[] {
  const queryUrls = query
    .getAll('xnatHangingProtocolManifestUrl')
    .concat(query.getAll('hangingProtocolManifestUrl'))
    .concat(query.getAll('hangingProtocolsManifestUrl'));

  const globalConfig = (window as any).config ?? {};
  const xnatConfig = globalConfig?.xnat ?? {};

  const configUrls = [
    xnatConfig.externalHangingProtocolsManifestUrl,
    ...(Array.isArray(xnatConfig.externalHangingProtocolsManifestUrls)
      ? xnatConfig.externalHangingProtocolsManifestUrls
      : []),
    globalConfig.externalHangingProtocolsManifestUrl,
    ...(Array.isArray(globalConfig.externalHangingProtocolsManifestUrls)
      ? globalConfig.externalHangingProtocolsManifestUrls
      : []),
  ];

  return Array.from(
    new Set(
      queryUrls
        .concat(configUrls)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.trim())
    )
  );
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }

  return response.json();
}

function normalizeManifestEntry(entry: string | ExternalProtocolFileEntry): ExternalProtocolFileEntry | null {
  if (typeof entry === 'string') {
    return { url: entry };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (!entry.url || typeof entry.url !== 'string') {
    return null;
  }

  const resolvedUrl = resolveProtocolUrl(entry.url);

  return {
    id: entry.id,
    name: entry.name,
    label: entry.label,
    url: resolvedUrl,
  };
}

function resolveProtocolUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  const currentOrigin = window.location.origin;
  const originWithoutProtocol = currentOrigin.replace(/^https?:\/\//i, '');
  const xnatHostPattern = /^https?:\/\/<xnat>(\/.*)?$/i;
  if (xnatHostPattern.test(trimmed)) {
    const pathMatch = trimmed.match(/^https?:\/\/<xnat>(\/.*)?$/i);
    return `${currentOrigin}${pathMatch?.[1] || ''}`;
  }

  const replacedPlaceholder = trimmed.replace(/<xnat>/gi, originWithoutProtocol);

  // Keep absolute URLs untouched after placeholder replacement.
  if (/^https?:\/\//i.test(replacedPlaceholder)) {
    return replacedPlaceholder;
  }

  // Convert root-relative and path-relative URLs to absolute same-origin URLs.
  return new URL(replacedPlaceholder, `${currentOrigin}/`).toString();
}

function normalizeManifestPayload(
  payload: ExternalHangingProtocolManifestPayload
): ExternalProtocolFileEntry[] {
  const items = Array.isArray(payload)
    ? payload
    : payload?.files || payload?.items || payload?.sources || payload?.protocolFiles || [];

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map(normalizeManifestEntry)
    .filter((entry): entry is ExternalProtocolFileEntry => Boolean(entry && entry.url));
}

async function getManifestSources(manifestUrls: string[]): Promise<ExternalProtocolFileEntry[]> {
  const sources: ExternalProtocolFileEntry[] = [];

  for (const manifestUrl of manifestUrls) {
    try {
      const payload = (await fetchJson(manifestUrl)) as ExternalHangingProtocolManifestPayload;
      if (!payload) {
        continue;
      }
      const entries = normalizeManifestPayload(payload);
      entries.forEach(entry => {
        if (entry.url) {
          updateRegistry(entry.url, {
            fromManifest: true,
            sourceName: entry.name || entry.id,
            sourceLabel: entry.label,
          });
          sources.push({
            ...entry,
            fromManifest: true,
          });
        }
      });
    } catch (error) {
      console.warn(`XNAT: Failed to load external hanging protocol manifest ${manifestUrl}:`, error);
    }
  }

  return sources;
}

async function fetchProtocols(url: string): Promise<HangingProtocolLike[]> {
  const payload = (await fetchJson(url)) as ExternalHangingProtocolsPayload;
  return normalizePayload(payload);
}

function getProjectIdFromQuery(query: URLSearchParams): string | null {
  return query.get('projectId') || query.get('projectid');
}

function getUserProtocolManifestSources(query: URLSearchParams): string[] {
  const projectId = getProjectIdFromQuery(query);
  if (!projectId) {
    return [];
  }

  const origin = window.location.origin;
  return [`${origin}/xapi/viewer/users/me/projects/${encodeURIComponent(projectId)}/hanging-protocols/manifest.json`];
}

export async function loadExternalHangingProtocols({
  query,
  hangingProtocolService,
}: {
  query: URLSearchParams;
  hangingProtocolService: any;
}): Promise<string[]> {
  type ResolvedSource = {
    id?: string;
    name?: string;
    label?: string;
    url: string;
    fromManifest: boolean;
  };

  const directSources: ResolvedSource[] = getExternalProtocolSources(query).map(url => ({
    url,
    fromManifest: false,
  }));
  const manifestUrls = getManifestUrls(query).concat(getUserProtocolManifestSources(query));
  const manifestSources: ResolvedSource[] = (await getManifestSources(manifestUrls))
    .filter(source => source.url)
    .map(source => ({
      id: source.id,
      name: source.name,
      label: source.label,
      url: source.url as string,
      fromManifest: true,
    }));
  const sources = [...manifestSources, ...directSources];

  if (!sources.length || !hangingProtocolService?.addProtocol) {
    return [];
  }

  const sourceIds = new Set<string>();

  for (const source of sources) {
    updateRegistry(source.url, {
      fromManifest: Boolean(source.fromManifest),
      sourceName: source.name || source.id,
      sourceLabel: source.label,
    });

    if (loadedSources.has(source.url)) {
      const existingIds = loadedProtocolIdsBySource.get(source.url) || [];
      existingIds.forEach(id => sourceIds.add(id));
      updateRegistry(source.url, {
        fromManifest: Boolean(source.fromManifest),
        sourceName: source.name || source.id,
        sourceLabel: source.label,
        loaded: true,
        protocolIds: existingIds,
      });
      continue;
    }

    try {
      const protocols = await fetchProtocols(source.url);
      const sourceSpecificIds: string[] = [];
      protocols.forEach(protocol => {
        if (!protocol?.id || loadedProtocolIds.has(protocol.id)) {
          if (protocol?.id) {
            sourceSpecificIds.push(protocol.id);
            sourceIds.add(protocol.id);
          }
          return;
        }

        hangingProtocolService.addProtocol(protocol.id, protocol);
        loadedProtocolIds.add(protocol.id);
        sourceSpecificIds.push(protocol.id);
        sourceIds.add(protocol.id);
      });

      const dedupedIds = Array.from(new Set(sourceSpecificIds));
      loadedProtocolIdsBySource.set(source.url, dedupedIds);
      loadedSources.add(source.url);
      updateRegistry(source.url, {
        fromManifest: Boolean(source.fromManifest),
        sourceName: source.name || source.id,
        sourceLabel: source.label,
        loaded: true,
        protocolIds: dedupedIds,
      });
      console.info(
        `XNAT: Loaded ${protocols.length} external hanging protocol(s) from ${source.url}.`
      );
    } catch (error) {
      updateRegistry(source.url, {
        fromManifest: Boolean(source.fromManifest),
        sourceName: source.name || source.id,
        sourceLabel: source.label,
        loaded: false,
        protocolIds: [],
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn(`XNAT: Failed to load external hanging protocols from ${source.url}:`, error);
    }
  }

  return Array.from(sourceIds);
}
