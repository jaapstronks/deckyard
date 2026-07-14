/**
 * Dual-write adapter for safe migration.
 *
 * Modes:
 * - 'shadow': Write both, read from primary (file), compare results
 * - 'primary-file': Write both, read from file
 * - 'primary-postgres': Write both, read from postgres
 */

import { StorageAdapter } from './interface.js';

export class DualWriteAdapter extends StorageAdapter {
  /**
   * @param {StorageAdapter} fileAdapter
   * @param {StorageAdapter} postgresAdapter
   * @param {Object} opts
   * @param {'shadow'|'primary-file'|'primary-postgres'} opts.mode
   */
  constructor(fileAdapter, postgresAdapter, opts = {}) {
    super();
    this.file = fileAdapter;
    this.postgres = postgresAdapter;
    this.mode = opts.mode || 'primary-file';
  }

  async initialize() {
    // Both adapters should already be initialized
  }

  async close() {
    await this.file.close();
    await this.postgres.close();
  }

  _getPrimary() {
    return this.mode === 'primary-postgres' ? this.postgres : this.file;
  }

  _getSecondary() {
    return this.mode === 'primary-postgres' ? this.file : this.postgres;
  }

  async _writeToSecondary(method, args, primary) {
    try {
      const secondary = this._getSecondary();
      const result = await secondary[method](...args);

      if (this.mode === 'shadow') {
        // Compare results
        const match = JSON.stringify(result) === JSON.stringify(primary);
        if (!match) {
          console.warn(`[DualWrite] Mismatch in ${method}:`, {
            primary: JSON.stringify(primary).slice(0, 200),
            secondary: JSON.stringify(result).slice(0, 200),
          });
        }
      }

      return result;
    } catch (err) {
      console.error(`[DualWrite] Secondary ${method} failed:`, err.message);
      // Don't throw - secondary failures are non-fatal
      return null;
    }
  }

  // ============================================================
  // PRESENTATIONS
  // ============================================================

  async listPresentations(ctx) {
    const primary = this._getPrimary();
    return primary.listPresentations(ctx);
  }

  async getPresentation(id, ctx) {
    const primary = this._getPrimary();
    return primary.getPresentation(id, ctx);
  }

  async createPresentation(data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.createPresentation(data, ctx);

    // Write to secondary (best-effort)
    this._writeToSecondary('createPresentation', [data, ctx], result);

    return result;
  }

  async updatePresentation(id, data, ctx, opts) {
    const primary = this._getPrimary();
    const result = await primary.updatePresentation(id, data, ctx, opts);

    // Write to secondary (best-effort)
    this._writeToSecondary('updatePresentation', [id, data, ctx, opts], result);

    return result;
  }

  async deletePresentation(id, ctx) {
    const primary = this._getPrimary();
    const result = await primary.deletePresentation(id, ctx);

    // Delete from secondary (best-effort)
    this._writeToSecondary('deletePresentation', [id, ctx], result);

    return result;
  }

  async duplicatePresentation(id, ctx) {
    const primary = this._getPrimary();
    const result = await primary.duplicatePresentation(id, ctx);

    // Note: duplicate in secondary would create different IDs
    // For true dual-write, we'd need to pass the result to secondary
    // For now, just log the primary result
    if (result) {
      this._writeToSecondary('createPresentation', [result, ctx], result);
    }

    return result;
  }

  // ============================================================
  // PRESENTATION VERSIONS
  // ============================================================

  async listPresentationVersions(presentationId, ctx) {
    const primary = this._getPrimary();
    return primary.listPresentationVersions(presentationId, ctx);
  }

  async getPresentationVersion(presentationId, versionId, ctx) {
    const primary = this._getPrimary();
    return primary.getPresentationVersion(presentationId, versionId, ctx);
  }

  async createPresentationVersion(presentationId, snapshot, ctx, opts) {
    const primary = this._getPrimary();
    const result = await primary.createPresentationVersion(presentationId, snapshot, ctx, opts);

    this._writeToSecondary('createPresentationVersion', [presentationId, snapshot, ctx, opts], result);

    return result;
  }

  async prunePresentationVersions(presentationId, ctx, opts) {
    const primary = this._getPrimary();
    const result = await primary.prunePresentationVersions(presentationId, ctx, opts);

    this._writeToSecondary('prunePresentationVersions', [presentationId, ctx, opts], result);

    return result;
  }

  // ============================================================
  // IMAGE LIBRARY
  // ============================================================

  async listImages(ctx) {
    const primary = this._getPrimary();
    return primary.listImages(ctx);
  }

  async getImage(id, ctx) {
    const primary = this._getPrimary();
    return primary.getImage(id, ctx);
  }

  async createImage(data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.createImage(data, ctx);

    this._writeToSecondary('createImage', [data, ctx], result);

    return result;
  }

  async updateImage(id, data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.updateImage(id, data, ctx);

    this._writeToSecondary('updateImage', [id, data, ctx], result);

    return result;
  }

  async deleteImage(id, ctx) {
    const primary = this._getPrimary();
    const result = await primary.deleteImage(id, ctx);

    this._writeToSecondary('deleteImage', [id, ctx], result);

    return result;
  }

  // ============================================================
  // SLIDE LIBRARY
  // ============================================================

  async listSlideLibrary(ctx, opts) {
    const primary = this._getPrimary();
    return primary.listSlideLibrary(ctx, opts);
  }

  async getSlideLibraryItem(id, ctx) {
    const primary = this._getPrimary();
    return primary.getSlideLibraryItem(id, ctx);
  }

  async createSlideLibraryItem(data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.createSlideLibraryItem(data, ctx);

    this._writeToSecondary('createSlideLibraryItem', [data, ctx], result);

    return result;
  }

  async updateSlideLibraryItem(id, data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.updateSlideLibraryItem(id, data, ctx);

    this._writeToSecondary('updateSlideLibraryItem', [id, data, ctx], result);

    return result;
  }

  async deleteSlideLibraryItem(id, ctx) {
    const primary = this._getPrimary();
    const result = await primary.deleteSlideLibraryItem(id, ctx);

    this._writeToSecondary('deleteSlideLibraryItem', [id, ctx], result);

    return result;
  }

  // ============================================================
  // PUBLISHED PRESENTATIONS
  // ============================================================

  async listPublished(ctx) {
    const primary = this._getPrimary();
    return primary.listPublished(ctx);
  }

  async getPublished(publishId, ctx) {
    const primary = this._getPrimary();
    return primary.getPublished(publishId, ctx);
  }

  async upsertPublished(data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.upsertPublished(data, ctx);

    this._writeToSecondary('upsertPublished', [data, ctx], result);

    return result;
  }

  async deletePublished(publishId, ctx) {
    const primary = this._getPrimary();
    const result = await primary.deletePublished(publishId, ctx);

    this._writeToSecondary('deletePublished', [publishId, ctx], result);

    return result;
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  async getAppSettings(ctx) {
    const primary = this._getPrimary();
    return primary.getAppSettings(ctx);
  }

  async setAppSettings(data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.setAppSettings(data, ctx);

    this._writeToSecondary('setAppSettings', [data, ctx], result);

    return result;
  }

  async getUserSettings(email, ctx) {
    const primary = this._getPrimary();
    return primary.getUserSettings(email, ctx);
  }

  async setUserSettings(email, data, ctx) {
    const primary = this._getPrimary();
    const result = await primary.setUserSettings(email, data, ctx);

    this._writeToSecondary('setUserSettings', [email, data, ctx], result);

    return result;
  }

  // ============================================================
  // FOLLOW CODES
  // ============================================================

  async createFollowCode(code, followUrl, ctx, opts) {
    const primary = this._getPrimary();
    const result = await primary.createFollowCode(code, followUrl, ctx, opts);

    this._writeToSecondary('createFollowCode', [code, followUrl, ctx, opts], result);

    return result;
  }

  async resolveFollowCode(code, ctx) {
    const primary = this._getPrimary();
    return primary.resolveFollowCode(code, ctx);
  }

  async cleanupExpiredFollowCodes(ctx) {
    const primary = this._getPrimary();
    const result = await primary.cleanupExpiredFollowCodes(ctx);

    this._writeToSecondary('cleanupExpiredFollowCodes', [ctx], result);

    return result;
  }
}