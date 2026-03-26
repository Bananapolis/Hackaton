/**
 * Client-side navigation utility.
 * Uses pushState + dispatches a popstate event so main.jsx re-renders.
 */
export function navigate(path) {
  if (typeof window === 'undefined') return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
