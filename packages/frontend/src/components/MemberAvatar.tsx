import { memberInitials } from '../lib/memberColors';

interface MemberAvatarProps {
  name: string;
  color: string;
  /** Diameter in px. */
  size?: number;
  /** Tooltip; defaults to the full name. */
  title?: string;
  className?: string;
}

/**
 * A small circular avatar: the member's identity color with their initials.
 * The initials are the required secondary encoding so identity never rests on
 * color alone (see {@link import('../lib/memberColors')}).
 */
export function MemberAvatar({ name, color, size = 22, title, className }: MemberAvatarProps) {
  return (
    <span
      className={`avatar${className ? ` ${className}` : ''}`}
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
      title={title ?? name}
      aria-label={name}
    >
      {memberInitials(name)}
    </span>
  );
}
