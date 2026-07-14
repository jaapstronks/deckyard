/**
 * Simple state management utility.
 * Provides a consistent pattern for managing component state with subscriptions.
 *
 * @example
 * const store = createStore({ count: 0, items: [] });
 *
 * // Subscribe to changes
 * const unsubscribe = store.subscribe((state, prevState) => {
 *   console.log('Count changed:', state.count);
 * });
 *
 * // Update state
 * store.set({ count: store.get().count + 1 });
 * store.update(state => ({ ...state, count: state.count + 1 }));
 *
 * // Cleanup
 * unsubscribe();
 */

/**
 * Create a simple state store.
 * @template T
 * @param {T} initialState - Initial state object
 * @returns {Object} Store API
 */
export function createStore(initialState = {}) {
  let state = { ...initialState };
  const subscribers = new Set();

  /**
   * Get current state.
   * @returns {T} Current state
   */
  function get() {
    return state;
  }

  /**
   * Set state (merges with existing state).
   * @param {Partial<T>} newState - Partial state to merge
   */
  function set(newState) {
    const prevState = state;
    state = { ...state, ...newState };
    notify(prevState);
  }

  /**
   * Update state using a function.
   * @param {(state: T) => T} updater - Function that receives current state and returns new state
   */
  function update(updater) {
    const prevState = state;
    state = updater(state);
    notify(prevState);
  }

  /**
   * Reset state to initial values.
   */
  function reset() {
    const prevState = state;
    state = { ...initialState };
    notify(prevState);
  }

  /**
   * Subscribe to state changes.
   * @param {(state: T, prevState: T) => void} callback - Called when state changes
   * @returns {() => void} Unsubscribe function
   */
  function subscribe(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  /**
   * Notify all subscribers of state change.
   * @param {T} prevState - Previous state
   */
  function notify(prevState) {
    for (const subscriber of subscribers) {
      try {
        subscriber(state, prevState);
      } catch (err) {
        console.error('State subscriber error:', err);
      }
    }
  }

  /**
   * Get a derived value that updates when dependencies change.
   * @template R
   * @param {(state: T) => R} selector - Function to derive value from state
   * @param {(value: R) => void} callback - Called when derived value changes
   * @returns {() => void} Unsubscribe function
   */
  function select(selector, callback) {
    let prevValue = selector(state);
    return subscribe((newState) => {
      const newValue = selector(newState);
      if (newValue !== prevValue) {
        prevValue = newValue;
        callback(newValue);
      }
    });
  }

  return {
    get,
    set,
    update,
    reset,
    subscribe,
    select,
  };
}

/**
 * Create a controller with state management.
 * Useful for components that need state + methods.
 *
 * @template S State type
 * @template M Methods type
 * @param {S} initialState - Initial state
 * @param {(store: ReturnType<typeof createStore<S>>) => M} createMethods - Function to create methods
 * @returns {ReturnType<typeof createStore<S>> & M} Store with methods
 *
 * @example
 * const counter = createController(
 *   { count: 0 },
 *   (store) => ({
 *     increment: () => store.update(s => ({ ...s, count: s.count + 1 })),
 *     decrement: () => store.update(s => ({ ...s, count: s.count - 1 })),
 *   })
 * );
 *
 * counter.increment();
 * console.log(counter.get().count); // 1
 */
export function createController(initialState, createMethods) {
  const store = createStore(initialState);
  const methods = createMethods(store);
  return { ...store, ...methods };
}

/**
 * Create a namespaced state slice from a parent store.
 * Useful for modularizing large state objects.
 *
 * @template T Parent state type
 * @template K Key in parent state
 * @param {ReturnType<typeof createStore<T>>} parentStore - Parent store
 * @param {K} key - Key in parent state to slice
 * @returns {Object} Slice API
 *
 * @example
 * const appStore = createStore({ user: { name: '' }, settings: { theme: 'light' } });
 * const userSlice = createSlice(appStore, 'user');
 * userSlice.set({ name: 'John' }); // Updates appStore.user.name
 */
export function createSlice(parentStore, key) {
  return {
    get: () => parentStore.get()[key],
    set: (newValue) => parentStore.set({ [key]: { ...parentStore.get()[key], ...newValue } }),
    update: (updater) => {
      const current = parentStore.get()[key];
      parentStore.set({ [key]: updater(current) });
    },
    subscribe: (callback) => {
      let prevValue = parentStore.get()[key];
      return parentStore.subscribe((state) => {
        const newValue = state[key];
        if (newValue !== prevValue) {
          callback(newValue, prevValue);
          prevValue = newValue;
        }
      });
    },
  };
}