/**
 * Safe localStorage abstraction that handles errors gracefully.
 * Useful for environments where localStorage may be disabled or quota exceeded.
 */
export const storage = {
  /**
   * Get a value from localStorage.
   * @param {string} key - Storage key
   * @param {*} [fallback=null] - Value to return if key doesn't exist or on error
   * @returns {string|*} The stored value or fallback
   */
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : fallback;
    } catch {
      return fallback;
    }
  },

  /**
   * Set a value in localStorage.
   * @param {string} key - Storage key
   * @param {*} value - Value to store (will be converted to string)
   * @returns {boolean} True if successful, false on error
   */
  set(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Remove a value from localStorage.
   * @param {string} key - Storage key
   * @returns {boolean} True if successful, false on error
   */
  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get a value and parse it as JSON.
   * @param {string} key - Storage key
   * @param {*} [fallback=null] - Value to return if key doesn't exist, parse fails, or on error
   * @returns {*} The parsed value or fallback
   */
  getJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  /**
   * Set a value as JSON in localStorage.
   * @param {string} key - Storage key
   * @param {*} value - Value to store (will be JSON stringified)
   * @returns {boolean} True if successful, false on error
   */
  setJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Get a boolean value from localStorage.
   * @param {string} key - Storage key
   * @param {boolean} [fallback=false] - Value to return if key doesn't exist or on error
   * @returns {boolean} The stored boolean or fallback
   */
  getBool(key, fallback = false) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return fallback;
      return value === '1' || value === 'true';
    } catch {
      return fallback;
    }
  },

  /**
   * Set a boolean value in localStorage.
   * @param {string} key - Storage key
   * @param {boolean} value - Boolean to store (stored as '1' or '0')
   * @returns {boolean} True if successful, false on error
   */
  setBool(key, value) {
    try {
      localStorage.setItem(key, value ? '1' : '0');
      return true;
    } catch {
      return false;
    }
  },
};