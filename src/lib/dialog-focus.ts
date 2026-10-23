// Closed details contain focusable DOM nodes which the browser excludes from Tab order.
export function visibleDialogControl(element: HTMLElement) {
  if (element.closest('[hidden]')) return false
  const closed = element.closest('details:not([open])')
  if (closed && !(element.tagName === 'SUMMARY' && element.parentElement === closed)) return false
  if (typeof element.checkVisibility === 'function') return element.checkVisibility()
  return getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden'
}
