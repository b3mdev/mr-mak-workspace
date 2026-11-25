/** Bento's bem-te-vi mark for Workspace and Chats. */
export default function MakLogo({ size = 64, variant = 'workspace' }: { size?: number; variant?: 'workspace' | 'chats' }) {
  const src = variant === 'chats' ? '/assets/bento-chats-192.png' : '/assets/bento-icon-192.png'
  return <img className="mak-logo" src={src} width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ display: 'block', flexShrink: 0, objectFit: 'contain' }} />
}
