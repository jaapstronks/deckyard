import { newId } from '../util/id.js';
import { storage } from '../storage.js';

export function getOrCreateQaUserId() {
  const KEY = 'qa.userId';
  const existing = storage.get(KEY, '').trim();
  if (existing) return existing;
  const v = newId();
  storage.set(KEY, v);
  return v;
}

export function getQaName() {
  const KEY = 'qa.name';
  return storage.get(KEY, '').trim().slice(0, 60);
}

export function setQaName(name) {
  const KEY = 'qa.name';
  const v = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!v) storage.remove(KEY);
  else storage.set(KEY, v);
  return v;
}

function keyMyQuestions(presentationId) {
  return `qa.myQuestions.${String(presentationId || '').trim()}`;
}

function keyUpvoted(presentationId) {
  return `qa.upvoted.${String(presentationId || '').trim()}`;
}

function readJsonArray(key) {
  const parsed = storage.getJSON(key, null);
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function writeJsonArray(key, arr) {
  storage.setJSON(key, arr);
}

export function getMyQuestionIds(presentationId) {
  return readJsonArray(keyMyQuestions(presentationId));
}

export function addMyQuestionId(presentationId, questionId) {
  const id = String(questionId || '').trim();
  if (!id) return;
  const k = keyMyQuestions(presentationId);
  const arr = readJsonArray(k);
  if (!arr.includes(id)) arr.push(id);
  writeJsonArray(k, arr);
}

export function removeMyQuestionId(presentationId, questionId) {
  const id = String(questionId || '').trim();
  if (!id) return;
  const k = keyMyQuestions(presentationId);
  const arr = readJsonArray(k).filter((x) => x !== id);
  writeJsonArray(k, arr);
}

export function hasUpvoted(presentationId, questionId) {
  const id = String(questionId || '').trim();
  if (!id) return false;
  return readJsonArray(keyUpvoted(presentationId)).includes(id);
}

export function markUpvoted(presentationId, questionId) {
  const id = String(questionId || '').trim();
  if (!id) return;
  const k = keyUpvoted(presentationId);
  const arr = readJsonArray(k);
  if (!arr.includes(id)) arr.push(id);
  writeJsonArray(k, arr);
}
