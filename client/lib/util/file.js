/**
 * File Utilities
 *
 * Shared utilities for file operations.
 */

/**
 * Read a file as a data URL
 * @param {File} file - File to read
 * @returns {Promise<string>} Data URL
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Read a file as UTF-8 text.
 * @param {File} file - File to read
 * @returns {Promise<string>} File contents as text
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}