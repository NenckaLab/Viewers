/**
 * Walk XNAT / Form.io custom-form schemas and collect input fields.
 * Radios and other controls are often nested under layout components
 * (panel, columns, tabs, table) and never appear if only top-level
 * `contents.components` is used.
 */

export type FormioFieldOption = {
  label: string;
  value: string;
};

export type FormioConditional = {
  eq?: string;
  show?: boolean | null;
  when?: string | null;
};

export type FormioComponent = {
  key?: string;
  type?: string;
  label?: string;
  input?: boolean;
  inputType?: string;
  values?: Array<{ label?: string; value?: string | number }>;
  questions?: Array<{ label?: string; value?: string | number }>;
  data?: {
    values?: Array<{ label?: string; value?: string | number }>;
  };
  conditional?: FormioConditional;
  components?: FormioComponent[];
  columns?: Array<{ components?: FormioComponent[] }>;
  rows?: Array<
    Array<{ components?: FormioComponent[] }> | { components?: FormioComponent[] }
  >;
  builder?: { title?: string; components?: FormioComponent[] };
  schema?: { components?: FormioComponent[] };
  title?: string;
};

const SKIP_TYPES = new Set([
  'button',
  'content',
  'htmlelement',
  'hidden',
]);

const REPEAT_TYPES = new Set(['datagrid', 'editgrid', 'datamap']);

const LAYOUT_TYPES = new Set([
  'columns',
  'panel',
  'tabs',
  'table',
  'fieldset',
  'well',
  'container',
]);

function getNestedComponents(component: FormioComponent): FormioComponent[] {
  const nested: FormioComponent[] = [];

  if (Array.isArray(component.columns)) {
    component.columns.forEach(column => {
      if (Array.isArray(column.components)) {
        nested.push(...column.components);
      }
    });
  }

  if (Array.isArray(component.rows)) {
    component.rows.forEach(row => {
      const cells = Array.isArray(row) ? row : [row];
      cells.forEach(cell => {
        if (cell && Array.isArray(cell.components)) {
          nested.push(...cell.components);
        }
      });
    });
  }

  if (Array.isArray(component.components)) {
    nested.push(...component.components);
  }

  return nested;
}

function isRenderableField(component: FormioComponent): boolean {
  if (!component?.key || typeof component.key !== 'string') {
    return false;
  }

  const type = (component.type || '').toLowerCase();
  if (SKIP_TYPES.has(type) || REPEAT_TYPES.has(type) || LAYOUT_TYPES.has(type)) {
    return false;
  }

  if (component.input === false) {
    return false;
  }

  return true;
}

export function parseCustomFormContents(raw: unknown): FormioComponent {
  if (raw == null) {
    return {};
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as FormioComponent;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as FormioComponent;
      }
    } catch {
      return {};
    }
  }

  return {};
}

export function getFormioComponents(schema: FormioComponent | null | undefined): FormioComponent[] {
  if (!schema) {
    return [];
  }

  if (Array.isArray(schema.components) && schema.components.length > 0) {
    return schema.components;
  }

  if (Array.isArray(schema.builder?.components)) {
    return schema.builder.components;
  }

  if (Array.isArray(schema.schema?.components)) {
    return schema.schema.components;
  }

  return Array.isArray(schema.components) ? schema.components : [];
}

export function getFormioFormTitle(
  schema: FormioComponent | null | undefined,
  fallback: string
): string {
  return schema?.title || schema?.builder?.title || fallback;
}

export function flattenFormioFields(
  components: FormioComponent[] | null | undefined
): FormioComponent[] {
  if (!Array.isArray(components)) {
    return [];
  }

  const fields: FormioComponent[] = [];

  components.forEach(component => {
    if (!component) {
      return;
    }

    const type = (component.type || '').toLowerCase();
    if (REPEAT_TYPES.has(type)) {
      return;
    }

    const nested = getNestedComponents(component);
    if (nested.length > 0) {
      fields.push(...flattenFormioFields(nested));
      if (LAYOUT_TYPES.has(type) || component.input === false) {
        return;
      }
    }

    if (isRenderableField(component)) {
      fields.push(component);
    }
  });

  return fields;
}

export type FormioFieldOptionSource = {
  values?: Array<{ label?: string; value?: string | number }>;
  data?: {
    values?: Array<{ label?: string; value?: string | number }>;
  };
};

export function getFormFieldOptions(fieldDef?: unknown): FormioFieldOption[] {
  if (!fieldDef || typeof fieldDef !== 'object') {
    return [];
  }

  const source = fieldDef as FormioFieldOptionSource;
  const raw =
    Array.isArray(source.values) && source.values.length > 0
      ? source.values
      : source.data?.values;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      option =>
        option &&
        ((option.value !== undefined && option.value !== null && String(option.value) !== '') ||
          Boolean(option.label))
    )
    .map(option => ({
      label:
        option.label != null && option.label !== ''
          ? String(option.label)
          : String(option.value),
      value:
        option.value !== undefined && option.value !== null && String(option.value) !== ''
          ? String(option.value)
          : String(option.label),
    }))
    .filter(option => option.value !== '' || option.label !== '');
}

export function coerceFormFieldValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    const nested = (value as { value?: unknown }).value;
    if (nested != null && typeof nested !== 'object') {
      return String(nested);
    }
  }

  return typeof value === 'object' ? '' : String(value);
}

export function normalizeFormFieldType(
  fieldDef?: { type?: string; inputType?: string } | null
): string {
  const type = (fieldDef?.type || fieldDef?.inputType || 'text').toLowerCase();

  if (type === 'xnatselect' || type === 'select') {
    return 'select';
  }
  if (type === 'xnatradio' || type === 'radio' || type === 'radios') {
    return 'radio';
  }
  if (type === 'textarea') {
    return 'textarea';
  }
  if (type === 'textfield' || type === 'text' || type === 'xnattextfield') {
    return 'text';
  }
  if (type === 'checkbox' || type === 'xnatcheckbox') {
    return 'checkbox';
  }
  if (type === 'numberfield' || type === 'number' || type === 'xnatnumber') {
    return 'number';
  }
  if (type === 'email') {
    return 'email';
  }
  if (type === 'phonenumber') {
    return 'phone';
  }
  if (type === 'time') {
    return 'time';
  }
  if (type === 'datetime' || type === 'datetimepicker') {
    return 'datetime';
  }
  if (type === 'day') {
    return 'day';
  }
  if (type === 'survey') {
    return 'survey';
  }

  return type;
}

function mapOptions(
  raw?: Array<{ label?: string; value?: string | number }>
): FormioFieldOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      option =>
        option &&
        ((option.value !== undefined && option.value !== null && String(option.value) !== '') ||
          Boolean(option.label))
    )
    .map(option => ({
      label:
        option.label != null && option.label !== ''
          ? String(option.label)
          : String(option.value),
      value:
        option.value !== undefined && option.value !== null && String(option.value) !== ''
          ? String(option.value)
          : String(option.label),
    }))
    .filter(option => option.value !== '' || option.label !== '');
}

export function getSurveyQuestions(fieldDef?: unknown): FormioFieldOption[] {
  if (!fieldDef || typeof fieldDef !== 'object') {
    return [];
  }

  return mapOptions((fieldDef as { questions?: Array<{ label?: string; value?: string | number }> }).questions);
}

export function toHtmlDateValue(value: unknown): string {
  const raw = coerceFormFieldValue(value);
  if (!raw || /^0+[/-]0+[/-]0+$/.test(raw)) {
    return '';
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }

  return '';
}

export function toHtmlTimeValue(value: unknown): string {
  const raw = coerceFormFieldValue(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return '';
  }

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function toHtmlDateTimeLocalValue(value: unknown): string {
  const raw = coerceFormFieldValue(value);
  if (!raw) {
    return '';
  }

  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) {
    return `${iso[1]}T${iso[2]}:${iso[3]}`;
  }

  const date = toHtmlDateValue(raw);
  return date ? `${date}T00:00` : '';
}

/** Form.io / lodash-style camelCase used for auto-generated option values. */
export function formioCamelCase(text: string): string {
  const words = String(text)
    .replace(/['’]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}

function stripLeadingNumbering(text: string): string {
  return String(text).replace(/^\d+[.)]\s*/, '');
}

export function valuesMatchConditional(
  actual: unknown,
  expected: unknown,
  options: FormioFieldOption[] = []
): boolean {
  const got = coerceFormFieldValue(actual);
  const eq = String(expected ?? '');
  if (!eq) {
    return got === '';
  }
  if (got === eq) {
    return true;
  }

  const candidates = [got, stripLeadingNumbering(got), formioCamelCase(got), formioCamelCase(stripLeadingNumbering(got))];
  if (candidates.includes(eq)) {
    return true;
  }

  const selected = options.find(option => option.value === got || option.label === got);
  if (!selected) {
    return false;
  }

  const optionCandidates = [
    selected.value,
    selected.label,
    stripLeadingNumbering(selected.label),
    formioCamelCase(selected.value),
    formioCamelCase(selected.label),
    formioCamelCase(stripLeadingNumbering(selected.label)),
  ];
  return optionCandidates.includes(eq);
}

/**
 * Form.io always attaches a stub `conditional: { show: null, when: null, eq: "" }`.
 * That must not hide the field. Only apply when `when` names another field.
 *
 * XNAT often leaves `eq` as the original Form.io camelCase slug after option
 * values are changed to the full labels, so match against both.
 */
export function shouldShowFormField(
  fieldDef: { conditional?: FormioConditional } | null | undefined,
  editingData: Record<string, unknown> = {},
  formFields: unknown[] = []
): boolean {
  const conditional = fieldDef?.conditional;
  const when = conditional?.when;
  if (!conditional || typeof when !== 'string' || when.trim() === '') {
    return true;
  }

  const triggerField = formFields.find(
    field =>
      field &&
      typeof field === 'object' &&
      'key' in field &&
      (field as { key?: string }).key === when
  );
  const matches = valuesMatchConditional(
    editingData[when],
    conditional.eq,
    getFormFieldOptions(triggerField)
  );

  if (conditional.show === false) {
    return !matches;
  }

  if (conditional.show === true) {
    return matches;
  }

  return true;
}
