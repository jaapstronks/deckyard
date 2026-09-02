/**
 * Email Templates Panel - State Management
 * Manages panel state and provides state accessors.
 */

import { DEFAULT_LOCALE } from '../../../../shared/constants/email-templates.js';

/**
 * Create state management for the email templates panel.
 * @param {Object} elements - UI elements that need busy state management
 * @returns {Object} State management API
 */
export function createState(elements) {
  const {
    templateSelect,
    defaultLocaleSelect,
    localeTabs,
    resetBtn,
    previewBtn,
    testBtn,
    saveBtn,
  } = elements;

  // Internal state
  let data = null;
  let currentType = 'userInvitation';
  let currentLocale = 'en';
  let formInputs = {};
  let busy = false;

  /**
   * Set busy state, disabling/enabling UI elements.
   * @param {boolean} v - New busy state
   */
  const setBusy = (v) => {
    busy = v;
    templateSelect.disabled = v;
    defaultLocaleSelect.disabled = v;
    resetBtn.disabled = v;
    previewBtn.disabled = v;
    testBtn.disabled = v;
    saveBtn.disabled = v;

    for (const input of Object.values(formInputs)) {
      if (input) input.disabled = v;
    }

    for (const tab of localeTabs.querySelectorAll('button')) {
      tab.disabled = v;
    }
  };

  /**
   * Get current form values (only non-empty values).
   * @returns {Object.<string, string>} Field values
   */
  const getFormValues = () => {
    const values = {};
    for (const [field, input] of Object.entries(formInputs)) {
      const value = input?.value?.trim() || '';
      if (value) {
        values[field] = value;
      }
    }
    return values;
  };

  return {
    // Getters
    getData: () => data,
    getDefaultLocale: () => data?.defaultLocale || DEFAULT_LOCALE,
    getCurrentType: () => currentType,
    getCurrentLocale: () => currentLocale,
    getFormInputs: () => formInputs,
    isBusy: () => busy,

    // Setters
    setData: (d) => {
      data = d;
    },
    /**
     * Record the default locale the server now holds. The list payload
     * already carries this field, so it stays the one record of the saved
     * value — a successful save updates it in place rather than adding a
     * second field that means the same thing.
     * @param {string} locale - Locale the server confirmed
     */
    setDefaultLocale: (locale) => {
      if (data) data.defaultLocale = locale;
    },
    setCurrentType: (type) => {
      currentType = type;
    },
    setCurrentLocale: (locale) => {
      currentLocale = locale;
    },
    setFormInputs: (inputs) => {
      formInputs = inputs;
    },

    // Actions
    setBusy,
    getFormValues,
  };
}
