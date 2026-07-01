import { isOverreadModeActive } from './acquisitionImageLimit';

const scanIdToTypeCache = new Map<string, Map<string, string>>();
const excludedScanTypesByProjectCache = new Map<string, string[]>();

export function parseExcludedScanTypesParam(value: string | null | undefined): string[] {
  if (!value || !value.trim()) {
    return [];
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function parseExcludedScansApiResponse(data: unknown): string[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === 'string') {
      return data.map(String).filter(entry => entry.trim());
    }

    if (data.length > 0 && typeof data[0] === 'object') {
      const first = data[0] as Record<string, unknown>;
      return parseExcludedScansApiResponse(first.excludedScans ?? first.excluded_scans);
    }

    return [];
  }

  if (typeof data === 'object') {
    const response = data as Record<string, unknown>;
    if (Array.isArray(response.excludedScans)) {
      return parseExcludedScansApiResponse(response.excludedScans);
    }
    if (Array.isArray(response.excluded_scans)) {
      return parseExcludedScansApiResponse(response.excluded_scans);
    }
  }

  return [];
}

export async function fetchExcludedScanTypesForProject(projectId: string): Promise<string[]> {
  if (!projectId) {
    return [];
  }

  if (excludedScanTypesByProjectCache.has(projectId)) {
    return excludedScanTypesByProjectCache.get(projectId) || [];
  }

  const encodedProjectId = encodeURIComponent(projectId);
  const endpoints = [
    `/xapi/overread/OverreadPreferences/project/${encodedProjectId}/excluded-scans`,
    `/xapi/overread/OverreadPreferences/project/${encodedProjectId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      const excludedScanTypes = parseExcludedScansApiResponse(data);
      excludedScanTypesByProjectCache.set(projectId, excludedScanTypes);

      if (excludedScanTypes.length > 0 || endpoint.includes('excluded-scans')) {
        return excludedScanTypes;
      }
    } catch (error) {
      console.warn(`XNAT Overread: Error fetching excluded scan types from ${endpoint}:`, error);
    }
  }

  excludedScanTypesByProjectCache.set(projectId, []);
  return [];
}

export async function resolveExcludedScanTypes(
  servicesManager?: { services?: { excludedScanTypes?: string[]; isOverreadMode?: boolean } },
  projectId?: string
): Promise<string[]> {
  const fromUrlOrService = getExcludedScanTypes(servicesManager);
  if (fromUrlOrService.length > 0) {
    return fromUrlOrService;
  }

  if (!isOverreadModeActive(servicesManager) || !projectId) {
    return [];
  }

  const fetched = await fetchExcludedScanTypesForProject(projectId);
  if (fetched.length > 0 && servicesManager?.services) {
    servicesManager.services.excludedScanTypes = fetched;
  }

  return fetched;
}

export function getExcludedScanTypes(
  servicesManager?: { services?: { excludedScanTypes?: string[] } }
): string[] {
  const fromService = servicesManager?.services?.excludedScanTypes;
  if (Array.isArray(fromService) && fromService.length > 0) {
    return fromService;
  }

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    return parseExcludedScanTypesParam(params.get('excludeScanTypes'));
  }

  return [];
}

export function parseScanIdFromXnatUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  const match = url.match(/\/scans\/([^/]+)\//i);
  return match?.[1];
}

export function normalizeScanType(scanType?: string): string {
  return (scanType || '').trim().toLowerCase();
}

export function isScanTypeExcluded(scanType: string | undefined, excludedTypes: string[]): boolean {
  if (!scanType || excludedTypes.length === 0) {
    return false;
  }

  const normalized = normalizeScanType(scanType);
  return excludedTypes.some(type => normalizeScanType(type) === normalized);
}

export function getSeriesScanType(
  series: { type?: string; scanType?: string; ScanType?: string },
  xnatInstances: Array<{ url?: string; metadata?: { type?: string; scanType?: string } }>,
  scanIdToTypeMap?: Map<string, string>
): string | undefined {
  const directType = series.scanType || series.ScanType || series.type;
  if (directType) {
    return directType;
  }

  const firstInstance = xnatInstances[0];
  const metadataType = firstInstance?.metadata?.scanType || firstInstance?.metadata?.type;
  if (metadataType) {
    return metadataType;
  }

  const scanId = parseScanIdFromXnatUrl(firstInstance?.url);
  if (scanId && scanIdToTypeMap?.has(scanId)) {
    return scanIdToTypeMap.get(scanId);
  }

  return undefined;
}

export function parseXnatScansResponse(data: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const items: Array<Record<string, unknown>> = [];

  if (Array.isArray(data)) {
    items.push(...data);
  } else if (data && typeof data === 'object') {
    const response = data as Record<string, unknown>;

    if (Array.isArray(response.items)) {
      items.push(...(response.items as Array<Record<string, unknown>>));
    } else if (response.ResultSet && typeof response.ResultSet === 'object') {
      const resultSet = response.ResultSet as { Result?: Array<Record<string, unknown>> };
      if (Array.isArray(resultSet.Result)) {
        items.push(...resultSet.Result);
      }
    }
  }

  for (const item of items) {
    const fields = (item.data_fields as Record<string, unknown> | undefined) || item;
    const scanId = fields.ID || fields.id || fields.scanId;
    const scanType = fields.type || fields.scanType;

    if (scanId && scanType) {
      map.set(String(scanId), String(scanType));
    }
  }

  return map;
}

export async function getScanIdToTypeMap(experimentId: string): Promise<Map<string, string>> {
  const cached = scanIdToTypeCache.get(experimentId);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`/data/experiments/${experimentId}/scans?format=json`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn(
        `XNAT Overread: Failed to fetch scan types for ${experimentId}: HTTP ${response.status}`
      );
      return new Map();
    }

    const data = await response.json();
    const map = parseXnatScansResponse(data);
    scanIdToTypeCache.set(experimentId, map);
    return map;
  } catch (error) {
    console.warn(`XNAT Overread: Error fetching scan types for ${experimentId}:`, error);
    return new Map();
  }
}

export function shouldSkipExcludedScanTypeInOverreadMode(
  xnatInstances: any[],
  series: any,
  excludedTypes: string[],
  scanIdToTypeMap: Map<string, string> | undefined,
  servicesManager?: { services?: { isOverreadMode?: boolean; excludedScanTypes?: string[] } }
): boolean {
  if (!isOverreadModeActive(servicesManager) || excludedTypes.length === 0) {
    return false;
  }

  const scanType = getSeriesScanType(series, xnatInstances, scanIdToTypeMap);
  if (!scanType) {
    return false;
  }

  return isScanTypeExcluded(scanType, excludedTypes);
}

export function appendOverreadViewerQueryParams(params: string): string {
  if (typeof window === 'undefined') {
    return params;
  }

  try {
    const currentSearchParams = new URLSearchParams(window.location.search || '');
    const isOverreadModeActive =
      currentSearchParams.get('overreadMode') === 'true' ||
      window.location.pathname.includes('/overreads');

    let updatedParams = params;

    if (isOverreadModeActive && !updatedParams.includes('overreadMode')) {
      updatedParams += '&overreadMode=true';
    }

    const excludeScanTypes = currentSearchParams.get('excludeScanTypes');
    if (excludeScanTypes && !updatedParams.includes('excludeScanTypes=')) {
      updatedParams += `&excludeScanTypes=${encodeURIComponent(excludeScanTypes)}`;
    }

    return updatedParams;
  } catch (error) {
    console.warn('Unable to append overread viewer query params:', error);
    return params;
  }
}
