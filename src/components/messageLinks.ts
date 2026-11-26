// Web and mail links open in the browser. A file: URL, a drive path or a scheme-less
// link is a local path, possibly relative to the chat folder: files preview in
// Workspace (on the phone, in its file viewer), folders open. Other schemes are shown as text, never followed.
export type LinkTarget = { kind: 'web' } | { kind: 'local'; path: string } | { kind: 'text' }
export function linkTarget(href = ''): LinkTarget {
  if (/^(https?|mailto):/i.test(href)) return { kind: 'web' }
  let target = href
  if (/^file:/i.test(target)) {
    try {
      const file = new URL(target)
      target = file.hostname ? `//${file.hostname}${file.pathname}` : file.pathname.replace(/^\/(?=[a-z]:\/)/i, '')
    } catch { return { kind: 'text' } }
  } else if (target.startsWith('#') || !target || (/^[a-z][a-z\d+.-]+:/i.test(target) && !/^[a-z]:[\\/]/i.test(target))) {
    return { kind: 'text' }
  }
  target = target.replace(/#.*$/, '')
  try { target = decodeURIComponent(target) } catch { /* Keep the original spelling. */ }
  target = target.replace(/:\d+(?::\d+)?$/, '')
  return target ? { kind: 'local', path: target } : { kind: 'text' }
}
// react-markdown drops unknown schemes, which includes drive paths such as E:/game.
// Keep them for linkTarget; script and data URLs are still removed.
export const keepUrl = (url: string) => /^\s*(javascript|vbscript|data):/i.test(url) ? '' : url
