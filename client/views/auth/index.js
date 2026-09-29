/**
 * The auth screens: sign-in, magic-link sign-in, forgot password and reset
 * password. One seam for `app.js`; the shared card scaffolding lives in
 * `shell.js`.
 */

export { renderLogin } from './login.js';
export { renderMagicLogin } from './magic-login.js';
export { renderForgotPassword } from './forgot-password.js';
export { renderResetPassword } from './reset-password.js';
