/**
 * Email Templates Panel - State Management
 * Manages panel state and provides state accessors.
 */

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
    getCurrentType: () => currentType,
    getCurrentLocale: () => currentLocale,
    getFormInputs: () => formInputs,
    isBusy: () => busy,

    // Setters
    setData: (d) => { data = d; },
    setCurrentType: (type) => { currentType = type; },
    setCurrentLocale: (locale) => { currentLocale = locale; },
    setFormInputs: (inputs) => { formInputs = inputs; },

    // Actions
    setBusy,
    getFormValues,
  };
}