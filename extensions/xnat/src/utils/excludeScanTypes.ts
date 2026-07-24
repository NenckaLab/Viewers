import { isOverreadModeActive } from './acquisitionImageLimit';

export type ScanMetadata = {
  type?: string;
  seriesDescription?: string;
};

const scanIdToMetadataCache = new Map<string, Map<string, ScanMetadata>>();
const excludedScanTypesByProjectCache = new Map<string, string[]>();

function normalizeMatchValue(value?: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ');
}

function tryParseExcludedJsonArray(value: string): string[] | null {
  const attempts = [value];

  try {
    attempts.push(decodeURIComponent(value));
  } catch {
    // Keep the original value only.
  }

  for (const candidate of attempts) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith('[')) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return uniqueMatchValues(parsed.map(entry => String(entry)));
      }
    } catch {
      // Try the next decoding candidate.
    }
  }

  return null;
}

function looksLikeBrokenJsonList(value: string): boolean {
  return value.includes('[') || value.includes(']') || value.includes('"');
}

function uniqueMatchValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach(value => {
    const trimmed = (value || '').trim();
    if (!trimmed) {
      return;
    }

    const normalized = normalizeMatchValue(trimmed);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed);
    }
  });

  return result;
}

function extractExcludedEntry(item: unknown): string[] {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!item || typeof item !== 'object') {
    return [];
  }

  const record = item as Record<string, unknown>;
  const candidate =
    record.label ??
    record.name ??
    record.type ??
    record.series_description ??
    record.seriesDescription ??
    record.value;

  const trimmed = candidate ? String(candidate).trim() : '';
  return trimmed ? [trimmed] : [];
}

function splitCommaSeparatedRespectingParentheses(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let depth = 0;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

export function parseExcludedScanTypesParam(value: string | null | undefined): string[] {
  if (!value || !value.trim()) {
    return [];
  }

  const trimmed = value.trim();
  const parsedJson = tryParseExcludedJsonArray(trimmed);
  if (parsedJson) {
    return parsedJson;
  }

  if (looksLikeBrokenJsonList(trimmed)) {
    return [];
  }

  return uniqueMatchValues(splitCommaSeparatedRespectingParentheses(trimmed));
}

export function formatExcludedScanTypesParam(excludedScanTypes: string[]): string {
  if (!excludedScanTypes.length) {
    return '';
  }

  return encodeURIComponent(JSON.stringify(excludedScanTypes));
}

export function parseExcludedScansApiResponse(data: unknown): string[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return [];
    }

    if (typeof data[0] === 'string') {
      return uniqueMatchValues(data.map(String));
    }

    if (typeof data[0] === 'object') {
      const nestedValues = data.flatMap(item => {
        if (!item || typeof item !== 'object') {
          return [];
        }

        const record = item as Record<string, unknown>;
        if (record.excludedScans || record.excluded_scans) {
          return parseExcludedScansApiResponse(record.excludedScans ?? record.excluded_scans);
        }

        return extractExcludedEntry(item);
      });

      return uniqueMatchValues(nestedValues);
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

      if (excludedScanTypes.length > 0) {
        excludedScanTypesByProjectCache.set(projectId, excludedScanTypes);
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
  const merged = new Set<string>();

  const addValues = (values?: string[]) => {
    (values || []).forEach(value => {
      const trimmed = value.trim();
      if (trimmed) {
        merged.add(trimmed);
      }
    });
  };

  addValues(servicesManager?.services?.excludedScanTypes);

  if (typeof window !== 'undefined') {
    addValues(
      parseExcludedScanTypesParam(new URLSearchParams(window.location.search).get('excludeScanTypes'))
    );
  }

  if (isOverreadModeActive(servicesManager) && projectId) {
    addValues(await fetchExcludedScanTypesForProject(projectId));
  }

  const resolved = Array.from(merged);

  if (resolved.length > 0 && servicesManager?.services) {
    servicesManager.services.excludedScanTypes = resolved;
  }

  return resolved;
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

/** @deprecated Use normalizeMatchValue internally; kept for existing imports. */
export function normalizeScanType(scanType?: string): string {
  return normalizeMatchValue(scanType);
}

export function isScanTypeExcluded(scanType: string | undefined, excludedTypes: string[]): boolean {
  if (!scanType || excludedTypes.length === 0) {
    return false;
  }

  const normalized = normalizeMatchValue(scanType);
  return excludedTypes.some(type => normalizeMatchValue(type) === normalized);
}

export function isSeriesMatchExcluded(
  matchValues: string[],
  excludedTypes: string[]
): boolean {
  if (!matchValues.length || !excludedTypes.length) {
    return false;
  }

  const normalizedMatchValues = matchValues.map(normalizeMatchValue);
  const normalizedExcluded = excludedTypes.map(normalizeMatchValue);

  return normalizedExcluded.some(excluded =>
    normalizedMatchValues.some(matchValue => matchValue === excluded)
  );
}

export function getSeriesMatchValues(
  series: {
    type?: string;
    scanType?: string;
    ScanType?: string;
    SeriesDescription?: string;
    seriesDescription?: string;
  },
  xnatInstances: Array<{
    url?: string;
    metadata?: {
      type?: string;
      scanType?: string;
      SeriesDescription?: string;
      series_description?: string;
    };
  }>,
  scanIdToMetadataMap?: Map<string, ScanMetadata>
): string[] {
  const values: Array<string | undefined> = [
    series.SeriesDescription,
    series.seriesDescription,
    series.scanType,
    series.ScanType,
    series.type,
  ];

  const firstInstance = xnatInstances[0];
  const metadata = firstInstance?.metadata;

  if (metadata) {
    values.push(
      metadata.SeriesDescription,
      metadata.series_description,
      metadata.scanType,
      metadata.type
    );
  }

  const scanId = parseScanIdFromXnatUrl(firstInstance?.url);
  if (scanId && scanIdToMetadataMap?.has(scanId)) {
    const scanMetadata = scanIdToMetadataMap.get(scanId);
    values.push(scanMetadata?.type, scanMetadata?.seriesDescription);
  }

  return uniqueMatchValues(values);
}

/** @deprecated Use getSeriesMatchValues for exclusion checks. */
export function getSeriesScanType(
  series: { type?: string; scanType?: string; ScanType?: string; SeriesDescription?: string },
  xnatInstances: Array<{ url?: string; metadata?: { type?: string; scanType?: string } }>,
  scanIdToTypeMap?: Map<string, string>
): string | undefined {
  const metadataMap = scanIdToTypeMap
    ? new Map(
        Array.from(scanIdToTypeMap.entries()).map(([scanId, type]) => [
          scanId,
          { type, seriesDescription: undefined },
        ])
      )
    : undefined;

  const matchValues = getSeriesMatchValues(series, xnatInstances, metadataMap);
  return matchValues[0];
}

export function parseXnatScansResponse(data: unknown): Map<string, ScanMetadata> {
  const map = new Map<string, ScanMetadata>();
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
    const seriesDescription = fields.series_description || fields.seriesDescription;

    if (!scanId) {
      continue;
    }

    map.set(String(scanId), {
      type: scanType ? String(scanType) : undefined,
      seriesDescription: seriesDescription ? String(seriesDescription) : undefined,
    });
  }

  return map;
}

export async function getScanIdToMetadataMap(experimentId: string): Promise<Map<string, ScanMetadata>> {
  const cached = scanIdToMetadataCache.get(experimentId);
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
        `XNAT Overread: Failed to fetch scan metadata for ${experimentId}: HTTP ${response.status}`
      );
      return new Map();
    }

    const data = await response.json();
    const map = parseXnatScansResponse(data);
    scanIdToMetadataCache.set(experimentId, map);
    return map;
  } catch (error) {
    console.warn(`XNAT Overread: Error fetching scan metadata for ${experimentId}:`, error);
    return new Map();
  }
}

/** @deprecated Use getScanIdToMetadataMap. */
export async function getScanIdToTypeMap(experimentId: string): Promise<Map<string, string>> {
  const metadataMap = await getScanIdToMetadataMap(experimentId);
  const typeMap = new Map<string, string>();

  metadataMap.forEach((metadata, scanId) => {
    if (metadata.type) {
      typeMap.set(scanId, metadata.type);
    }
  });

  return typeMap;
}

export function shouldSkipExcludedScanTypeInOverreadMode(
  xnatInstances: any[],
  series: any,
  excludedTypes: string[],
  scanIdToMetadataMap: Map<string, ScanMetadata> | undefined,
  servicesManager?: { services?: { isOverreadMode?: boolean; excludedScanTypes?: string[] } }
): boolean {
  if (!isOverreadModeActive(servicesManager) || excludedTypes.length === 0) {
    return false;
  }

  const matchValues = getSeriesMatchValues(series, xnatInstances, scanIdToMetadataMap);
  if (!matchValues.length) {
    return false;
  }

  return isSeriesMatchExcluded(matchValues, excludedTypes);
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
