import fetchJSON from './fetchJSON';
import sessionMap from '../sessionMap';

/**
 * XNAT Custom Forms API implementation
 * Based on the XNAT Custom Form API specification:
 * https://wiki.xnat.org/xnat-api/custom-form-api
 * https://wiki.xnat.org/xnat-api/how-to-add-or-modify-custom-form-data-using-the-xn
 */

export interface CustomFormField {
  key: string;
  type: string;
  label: string;
  input: boolean;
  tableView: boolean;
  data?: {
    values?: Array<{ label: string; value: string }>;
  };
  conditional?: {
    eq: string;
    show: boolean;
    when: string;
  };
  autoExpand?: boolean;
  widget?: string;
  dataType?: string;
}

export interface CustomForm {
  formId: string;
  formUUID: string;
  contents: string;
  scope: string;
  path: string;
  formDisplayOrder: number;
  doProjectsShareForm: boolean;
  username: string;
  dateCreated: number;
  hasData: boolean;
  appliesToList: Array<{
    entityId: string;
    idCustomVariableFormAppliesTo: string;
    status: string;
  }>;
}

export interface ParsedCustomForm {
  id: string;
  uuid: string;
  title: string;
  fields: CustomFormField[];
  scope: string;
  appliesToProjects: string[];
}

export interface CustomFormData {
  [formUuid: string]: {
    [fieldName: string]: any;
  };
}

/**
 * Fetches available custom forms for a project
 * @param projectId - The project ID
 * @returns Promise that resolves to array of custom forms
 */
export async function fetchCustomForms(projectId: string): Promise<ParsedCustomForm[]> {
  try {
    const route = `xapi/customforms`;
    const response = await fetchJSON(route).promise;
    
    if (!response) {
      console.warn('No custom forms found');
      return [];
    }
    
    // Parse the forms and filter by project
    const forms: CustomForm[] = Array.isArray(response) ? response : [response];
    const parsedForms: ParsedCustomForm[] = [];
    
    forms.forEach(form => {
      try {
        // Parse the contents JSON string
        const contents = JSON.parse(form.contents);
        
        // Check if this form applies to the project
        const appliesToProject = form.appliesToList.some(
          item => item.entityId === projectId && item.status === 'enabled'
        );
        
        if (appliesToProject) {
          const parsedForm: ParsedCustomForm = {
            id: form.formId,
            uuid: form.formUUID,
            title: contents.title || `Form ${form.formId}`,
            fields: contents.components || [],
            scope: form.scope,
            appliesToProjects: form.appliesToList.map(item => item.entityId)
          };
          
          parsedForms.push(parsedForm);
        }
      } catch (parseError) {
        console.error('Error parsing form contents:', parseError, form);
      }
    });
    
    console.log('Parsed custom forms for project:', projectId, parsedForms);
    return parsedForms;
  } catch (error) {
    console.error('Error fetching custom forms:', error);
    throw new Error(`Failed to fetch custom forms: ${error.message}`);
  }
}

/**
 * Retrieves custom form data for a specific experiment
 * @param experimentId - The experiment ID
 * @param formUuid - Optional form UUID to retrieve specific form data
 * @returns Promise that resolves to custom form data
 */
export async function getExperimentCustomFormData(
  experimentId: string,
  formUuid?: string
): Promise<CustomFormData> {
  try {
    const route = formUuid 
      ? `xapi/custom-fields/experiments/${experimentId}/fields/${formUuid}`
      : `xapi/custom-fields/experiments/${experimentId}/fields`;
    
    const response = await fetchJSON(route).promise;
    
    if (!response) {
      console.warn(`No custom form data found for experiment ${experimentId}`);
      return {};
    }
    
    console.log('Experiment custom form data:', experimentId, response);
    return response;
  } catch (error) {
    console.error('Error fetching custom form data:', error);
    throw new Error(`Failed to fetch custom form data: ${error.message}`);
  }
}

/**
 * Adds or updates custom form data for a specific experiment
 * @param experimentId - The experiment ID
 * @param formData - The custom form data to save
 * @returns Promise that resolves to the updated custom form data
 */
export async function saveExperimentCustomFormData(
  experimentId: string,
  formData: CustomFormData
): Promise<CustomFormData> {
  try {
    const route = `xapi/custom-fields/experiments/${experimentId}/fields`;
    
    // Use PUT method for adding/updating custom form data
    const { xnatRootUrl } = sessionMap;
    const cleanRoute = route.startsWith('/') ? route.substring(1) : route;
    const baseUrl = xnatRootUrl.endsWith('/') ? xnatRootUrl : xnatRootUrl + '/';
    const url = `${baseUrl}${cleanRoute}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error saving custom form data:', error);
    throw new Error(`Failed to save custom form data: ${error.message}`);
  }
}

/**
 * Deletes custom form data for a specific form in an experiment
 * @param experimentId - The experiment ID
 * @param formUuid - The UUID of the form to delete
 * @returns Promise that resolves to the updated custom form data
 */
export async function deleteExperimentCustomFormData(
  experimentId: string,
  formUuid: string
): Promise<CustomFormData> {
  try {
    const route = `xapi/custom-fields/experiments/${experimentId}/fields/${formUuid}`;
    
    const { xnatRootUrl } = sessionMap;
    const cleanRoute = route.startsWith('/') ? route.substring(1) : route;
    const baseUrl = xnatRootUrl.endsWith('/') ? xnatRootUrl : xnatRootUrl + '/';
    const url = `${baseUrl}${cleanRoute}`;
    
    const response = await fetch(url, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Error deleting custom form data:', error);
    throw new Error(`Failed to delete custom form data: ${error.message}`);
  }
}

/**
 * Updates a specific form's data within an experiment
 * @param experimentId - The experiment ID
 * @param formUuid - The UUID of the form to update
 * @param formFieldData - The form field data to update
 * @returns Promise that resolves to the updated custom form data
 */
export async function updateExperimentFormData(
  experimentId: string,
  formUuid: string,
  formFieldData: { [fieldName: string]: any }
): Promise<CustomFormData> {
  try {
    // First get existing data
    const existingData = await getExperimentCustomFormData(experimentId);
    
    // Update the specific form's data
    const updatedData = {
      ...existingData,
      [formUuid]: {
        ...existingData[formUuid],
        ...formFieldData
      }
    };
    
    // Save the updated data
    return await saveExperimentCustomFormData(experimentId, updatedData);
  } catch (error) {
    console.error('Error updating experiment form data:', error);
    throw new Error(`Failed to update experiment form data: ${error.message}`);
  }
}

/**
 * Gets form data for a specific form UUID from experiment data
 * @param experimentData - The experiment custom form data
 * @param formUuid - The UUID of the form to extract
 * @returns The form field data or null if not found
 */
export function getFormDataByUuid(
  experimentData: CustomFormData,
  formUuid: string
): { [fieldName: string]: any } | null {
  return experimentData[formUuid] || null;
}

/**
 * Creates a new form entry in experiment data
 * @param experimentData - The existing experiment custom form data
 * @param formUuid - The UUID of the form to create
 * @param formFieldData - The initial form field data
 * @returns Updated experiment data
 */
export function createFormEntry(
  experimentData: CustomFormData,
  formUuid: string,
  formFieldData: { [fieldName: string]: any }
): CustomFormData {
  return {
    ...experimentData,
    [formUuid]: formFieldData
  };
}

export default {
  fetchCustomForms,
  getExperimentCustomFormData,
  saveExperimentCustomFormData,
  deleteExperimentCustomFormData,
  updateExperimentFormData,
  getFormDataByUuid,
  createFormEntry,
}; 