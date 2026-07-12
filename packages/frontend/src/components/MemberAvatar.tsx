import { useState } from 'react';
import { memberInitials } from '../lib/memberColors';

interface MemberAvatarProps {
  name: string;
  color: string;
  /** Diameter in px. */
  size?: number;
  /** Tooltip; defaults to the full name. */
  title?: string;
  className?: string;
  /** Jira avatar image URL. Falls back to initials-on-color if absent/fails. */
  avatarUrl?: string | null;
}

/**
 * A small circular avatar. Prefers the member's Jira avatar image when present,
 * and falls back to their identity color with initials — the required secondary
 * encoding so identity never rests on color alone, and so a broken/missing image
 * still renders something meaningful (see {@link import('../lib/memberColors')}).
 */
export function MemberAvatar({ name, color, size = 22, title, className, avatarUrl }: MemberAvatarProps) {
  const [imgOk, setImgOk] = useState(true);
  const showImg = Boolean(avatarUrl) && imgOk;

  return (
    <span
      className={`avatar${className ? ` ${className}` : ''}`}
      style={{
        background: showImg ? 'transparent' : color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
      title={title ?? name}
      aria-label={name}
    >
      {showImg ? (
        <img
          className="avatar-img"
          src={avatarUrl ?? undefined}
          alt=""
          width={size}
          height={size}
          onError={() => setImgOk(false)}
        />
      ) : (
        memberInitials(name)
      )}
    </span>
  );
}
