import {
  flattenFormioFields,
  getFormFieldOptions,
  getFormioComponents,
  getSurveyQuestions,
  normalizeFormFieldType,
  parseCustomFormContents,
  shouldShowFormField,
  toHtmlDateValue,
} from './flattenFormioFields';

describe('flattenFormioFields', () => {
  it('returns an empty array for missing components', () => {
    expect(flattenFormioFields(undefined)).toEqual([]);
    expect(flattenFormioFields(null)).toEqual([]);
    expect(flattenFormioFields([])).toEqual([]);
  });

  it('keeps a top-level radio field', () => {
    const radio = {
      type: 'radio',
      key: 'finding',
      label: 'Finding',
      input: true,
      values: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    };

    expect(flattenFormioFields([radio])).toEqual([radio]);
  });

  it('extracts radios nested in panels and columns', () => {
    const fields = flattenFormioFields([
      {
        type: 'panel',
        key: 'findingsPanel',
        input: false,
        components: [
          {
            type: 'columns',
            key: 'columns',
            input: false,
            columns: [
              {
                components: [
                  {
                    type: 'radio',
                    key: 'severity',
                    label: 'Severity',
                    input: true,
                    values: [{ label: 'Mild', value: 'mild' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(fields.map(field => field.key)).toEqual(['severity']);
    expect(fields[0].type).toBe('radio');
  });

  it('extracts radios nested in tabs', () => {
    const fields = flattenFormioFields([
      {
        type: 'tabs',
        key: 'tabs',
        input: false,
        components: [
          {
            key: 'assessment',
            label: 'Assessment',
            components: [
              {
                type: 'radio',
                key: 'irregularity',
                label: 'Irregularity',
                input: true,
                values: [{ label: 'None', value: 'none' }],
              },
            ],
          },
        ],
      },
    ]);

    expect(fields.map(field => field.key)).toEqual(['irregularity']);
  });

  it('keeps a radio even when it has leftover nested components', () => {
    const fields = flattenFormioFields([
      {
        type: 'radio',
        key: 'finding',
        input: true,
        values: [{ label: 'Yes', value: 'yes' }],
        components: [{ type: 'htmlelement', key: 'note' }],
      },
    ]);

    expect(fields.map(field => field.key)).toEqual(['finding']);
  });

  it('skips layout wrappers, buttons, and repeating grids', () => {
    const fields = flattenFormioFields([
      { type: 'button', key: 'submit', input: true, label: 'Submit' },
      {
        type: 'datagrid',
        key: 'repeats',
        input: true,
        components: [{ type: 'radio', key: 'hiddenRadio', input: true }],
      },
      {
        type: 'textfield',
        key: 'notes',
        label: 'Notes',
        input: true,
      },
    ]);

    expect(fields.map(field => field.key)).toEqual(['notes']);
  });
});

describe('getFormioComponents', () => {
  it('reads components from a Form.io builder wrapper', () => {
    const schema = parseCustomFormContents({
      builder: {
        title: 'Overread',
        components: [{ type: 'radio', key: 'finding', input: true }],
      },
    });

    expect(getFormioComponents(schema).map(field => field.key)).toEqual(['finding']);
  });
});

describe('getFormFieldOptions', () => {
  it('reads Form.io radio options from values', () => {
    expect(
      getFormFieldOptions({
        type: 'radio',
        key: 'choice',
        values: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
      })
    ).toEqual([
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ]);
  });

  it('falls back to data.values used by Form.io select', () => {
    expect(
      getFormFieldOptions({
        type: 'select',
        key: 'modality',
        data: {
          values: [{ label: 'MR', value: 'mr' }],
        },
      })
    ).toEqual([{ label: 'MR', value: 'mr' }]);
  });

  it('reads xnatSelect options from data.values', () => {
    expect(
      getFormFieldOptions({
        type: 'xnatSelect',
        key: 'resultsOfNonDiagnosticMriReview',
        data: {
          values: [
            { label: '1. Normal Scan', value: '1. Normal Scan' },
            {
              label: '4. Finding in need of URGENT follow up',
              value: '4. Finding in need of URGENT follow up',
            },
          ],
        },
      })
    ).toEqual([
      { label: '1. Normal Scan', value: '1. Normal Scan' },
      {
        label: '4. Finding in need of URGENT follow up',
        value: '4. Finding in need of URGENT follow up',
      },
    ]);
  });
});

describe('shouldShowFormField', () => {
  it('shows fields that have the Form.io stub conditional', () => {
    expect(
      shouldShowFormField(
        {
          conditional: { show: null, when: null, eq: '' },
        },
        {}
      )
    ).toBe(true);
  });

  it('hides a field until its show-when condition matches', () => {
    const fieldDef = {
      conditional: { show: true, when: 'finding', eq: 'yes' },
    };

    expect(shouldShowFormField(fieldDef, { finding: 'no' })).toBe(false);
    expect(shouldShowFormField(fieldDef, { finding: 'yes' })).toBe(true);
  });

  it('matches Form.io camelCase eq values against labeled xnatSelect options', () => {
    const fields = flattenFormioFields([
      {
        key: 'resultsOfNonDiagnosticMriReview',
        type: 'xnatSelect',
        input: true,
        data: {
          values: [
            { label: '1. Normal Scan', value: '1. Normal Scan' },
            {
              label: '4. Finding in need of URGENT follow up',
              value: '4. Finding in need of URGENT follow up',
            },
          ],
        },
      },
      {
        key: 'PersonContacted',
        type: 'xnatRadio',
        input: true,
        values: [{ label: 'No Contact Made', value: 'noContactMade' }],
        conditional: {
          eq: 'findingInNeedOfUrgentFollowUp',
          show: true,
          when: 'resultsOfNonDiagnosticMriReview',
        },
      },
    ]);

    const radio = fields.find(field => field.key === 'PersonContacted');
    expect(fields.map(field => field.key)).toEqual([
      'resultsOfNonDiagnosticMriReview',
      'PersonContacted',
    ]);
    expect(
      shouldShowFormField(radio, { resultsOfNonDiagnosticMriReview: '1. Normal Scan' }, fields)
    ).toBe(false);
    expect(
      shouldShowFormField(
        radio,
        {
          resultsOfNonDiagnosticMriReview: '4. Finding in need of URGENT follow up',
        },
        fields
      )
    ).toBe(true);
  });
});

describe('XNAT custom form field types', () => {
  const overreadFields = [
    { key: 'checkbox', type: 'checkbox', input: true },
    { key: 'number', type: 'xnatNumber', input: true },
    { key: 'radio', type: 'xnatRadio', input: true, values: [{ label: 'Test', value: 'test' }] },
    {
      key: 'select',
      type: 'xnatSelect',
      input: true,
      data: { values: [{ label: 'MR', value: 'mr' }] },
    },
    { key: 'textArea', type: 'textarea', input: true },
    { key: 'textField', type: 'textfield', input: true },
    {
      key: 'day',
      type: 'day',
      input: true,
      fields: { day: { hide: false }, month: { hide: false }, year: { hide: false } },
    },
    { key: 'dateTime', type: 'datetime', input: true },
    { key: 'email', type: 'email', input: true },
    { key: 'phoneNumber', type: 'phoneNumber', input: true },
    {
      key: 'survey',
      type: 'survey',
      input: true,
      values: [{ label: 'test', value: 'test' }],
      questions: [{ label: 'test', value: 'test' }],
    },
    { key: 'time', type: 'time', input: true },
  ];

  it('keeps every XNAT input type, including day with a fields object', () => {
    expect(flattenFormioFields(overreadFields).map(field => field.key)).toEqual(
      overreadFields.map(field => field.key)
    );
  });

  it('maps XNAT types to the matching control', () => {
    expect(normalizeFormFieldType({ type: 'xnatSelect' })).toBe('select');
    expect(normalizeFormFieldType({ type: 'xnatRadio' })).toBe('radio');
    expect(normalizeFormFieldType({ type: 'xnatNumber' })).toBe('number');
    expect(normalizeFormFieldType({ type: 'textfield' })).toBe('text');
    expect(normalizeFormFieldType({ type: 'phoneNumber' })).toBe('phone');
    expect(normalizeFormFieldType({ type: 'datetime' })).toBe('datetime');
    expect(normalizeFormFieldType({ type: 'day' })).toBe('day');
    expect(normalizeFormFieldType({ type: 'survey' })).toBe('survey');
  });

  it('reads survey questions separately from answer values', () => {
    const survey = overreadFields.find(field => field.key === 'survey');
    expect(getSurveyQuestions(survey)).toEqual([{ label: 'test', value: 'test' }]);
    expect(getFormFieldOptions(survey)).toEqual([{ label: 'test', value: 'test' }]);
  });

  it('treats Form.io empty day placeholders as an empty date input', () => {
    expect(toHtmlDateValue('00/00/0000')).toBe('');
    expect(toHtmlDateValue('2024-03-15')).toBe('2024-03-15');
  });
});
