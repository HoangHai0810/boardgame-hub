// Shared SVG art for the whole platform (moved here from the two games in
// the v35 redesign so the Hub, Cheese Thief and Ma Sói all draw the same
// faces): MouseAvatar, WolfAvatar, CheeseWedge, plus the Ma Sói landing
// moon/village art and the role icons for the reveal card.
import type { Role } from '../../../games/ma-soi/logic';

const hashId = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);

const MOUSE_COLORS: [string, string][] = [
  ['#C9CED8', '#9AA3B2'], ['#F8CD9E', '#EDA45F'], ['#ACCDF6', '#7FA8E6'], ['#DEC4F4', '#BB94E4'],
  ['#B4E0C2', '#85C79B'], ['#F6AC8D', '#E67F57'], ['#F8E08C', '#E9C04C'], ['#F7BDD6', '#EA93B8'],
];
export function MouseAvatar({ seed, size = 48, state = 'awake', halo }: { seed: string; size?: number; state?: 'awake' | 'asleep' | 'thief' | 'dead'; halo?: string }) {
  const [face, ear] = MOUSE_COLORS[hashId(seed) % MOUSE_COLORS.length];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="inline-block flex-none" aria-hidden>
      {halo && <circle cx="50" cy="50" r="48" fill={halo} stroke="#2B2016" strokeWidth="2.5" />}
      <circle cx="27" cy="27" r="17" fill={ear} stroke="#2B2016" strokeWidth="3" />
      <circle cx="73" cy="27" r="17" fill={ear} stroke="#2B2016" strokeWidth="3" />
      <circle cx="27" cy="27" r="8.5" fill="#F6A8BC" />
      <circle cx="73" cy="27" r="8.5" fill="#F6A8BC" />
      <circle cx="50" cy="57" r="35" fill={face} stroke="#2B2016" strokeWidth="3" />
      <g stroke="#2B2016" strokeWidth="1.6" opacity="0.35" strokeLinecap="round"><path d="M8 62 l14 3 M10 72 l13 -1" /><path d="M92 62 l-14 3 M90 72 l-13 -1" /></g>
      {state === 'thief' ? (<>
        <rect x="13" y="43" width="74" height="21" rx="10.5" fill="#26221F" />
        <circle cx="37" cy="53.5" r="6.4" fill="#FFFBef" /><circle cx="63" cy="53.5" r="6.4" fill="#FFFBef" />
        <circle cx="37" cy="53.5" r="3.2" fill="#2B2016" /><circle cx="63" cy="53.5" r="3.2" fill="#2B2016" />
      </>) : state === 'asleep' ? (
        <g stroke="#2B2016" strokeWidth="3" fill="none" strokeLinecap="round"><path d="M30 54 q7 6 14 0" /><path d="M56 54 q7 6 14 0" /></g>
      ) : state === 'dead' ? (
        <g stroke="#2B2016" strokeWidth="3.4" strokeLinecap="round"><path d="M31 48 l12 12 M43 48 l-12 12" /><path d="M57 48 l12 12 M69 48 l-12 12" /></g>
      ) : (
        <g fill="#2B2016"><circle cx="37" cy="53" r="4.6" /><circle cx="63" cy="53" r="4.6" /></g>
      )}
      <ellipse cx="50" cy="68" rx="5.4" ry="4.2" fill="#F2728C" stroke="#2B2016" strokeWidth="1.6" />
      <path d="M50 72 q0 5 -7 6 M50 72 q0 5 7 6" stroke="#2B2016" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function CheeseWedge({ size = 92 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.76)} viewBox="0 0 100 76" className="inline-block" aria-hidden>
      <path d="M8 68 L92 68 L92 14 Z" fill="#FFC93C" stroke="#2B2016" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M92 14 L92 68 L83 68 L83 23 Z" fill="#F0A92E" />
      <path d="M15 63 L86 22 L86 31 L27 63 Z" fill="#FFDE59" opacity="0.75" />
      <g fill="#E39A0B" stroke="#C77F06" strokeWidth="1">
        <circle cx="66" cy="50" r="6.5" /><circle cx="44" cy="58" r="4.4" /><circle cx="78" cy="35" r="4" /><circle cx="56" cy="43" r="3.1" />
      </g>
      <path d="M8 68 L92 68 L92 14 Z" fill="none" stroke="#2B2016" strokeWidth="3.5" strokeLinejoin="round" />
    </svg>
  );
}

const FACE_COLORS: [string, string][] = [
  ['#F8CD9E', '#EDA45F'], ['#ACCDF6', '#7FA8E6'], ['#DEC4F4', '#BB94E4'], ['#B4E0C2', '#85C79B'],
  ['#F6AC8D', '#E67F57'], ['#F8E08C', '#E9C04C'], ['#F7BDD6', '#EA93B8'], ['#C9CED8', '#9AA3B2'],
];
const faceFor = (id: string) => FACE_COLORS[hashId(id) % FACE_COLORS.length];

/** Flat SVG face in the platform's style. Wolf = pointed ears + grey fur +
 *  fangs; dead = X eyes; asleep = closed eyes. */
export function WolfAvatar({ seed, size = 48, state = 'villager', halo }: { seed: string; size?: number; state?: 'villager' | 'wolf' | 'dead' | 'asleep'; halo?: string }) {
  const [skin, shade] = state === 'wolf' ? ['#8A8F9C', '#6B7080'] : faceFor(seed);
  const dead = state === 'dead';
  const asleep = state === 'asleep';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      {halo && <circle cx="50" cy="50" r="47" fill={halo} />}
      {state === 'wolf' ? (
        <>
          <path d="M20 38 L10 4 L44 20 Z" fill={skin} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
          <path d="M80 38 L90 4 L56 20 Z" fill={skin} stroke="#2B2016" strokeWidth="3" strokeLinejoin="round" />
          <path d="M22 30 L17 12 L34 20 Z" fill="#4A4F5E" />
          <path d="M78 30 L83 12 L66 20 Z" fill="#4A4F5E" />
        </>
      ) : (
        <>
          <circle cx="24" cy="30" r="11" fill={skin} stroke="#2B2016" strokeWidth="3" />
          <circle cx="76" cy="30" r="11" fill={skin} stroke="#2B2016" strokeWidth="3" />
        </>
      )}
      <circle cx="50" cy="54" r="34" fill={skin} stroke="#2B2016" strokeWidth="3.5" />
      {state === 'wolf' && (
        <>
          <path d="M17 62 L10 70 L19 69 Z" fill={skin} stroke="#2B2016" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M83 62 L90 70 L81 69 Z" fill={skin} stroke="#2B2016" strokeWidth="2.5" strokeLinejoin="round" />
          <ellipse cx="50" cy="70" rx="15" ry="11" fill="#B9BEC9" />
        </>
      )}
      {state !== 'wolf' && <ellipse cx="50" cy="72" rx="13" ry="9" fill={shade} opacity="0.55" />}
      <circle cx="50" cy="68" r="4.5" fill="#2B2016" />
      {dead ? (
        <>
          <path d="M32 44 L44 56 M44 44 L32 56" stroke="#2B2016" strokeWidth="4" strokeLinecap="round" />
          <path d="M56 44 L68 56 M68 44 L56 56" stroke="#2B2016" strokeWidth="4" strokeLinecap="round" />
          <path d="M40 82 Q50 76 60 82" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : asleep ? (
        <>
          <path d="M32 50 Q38 54 44 50" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M56 50 Q62 54 68 50" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M42 82 Q50 86 58 82" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : state === 'wolf' ? (
        <>
          <circle cx="37" cy="50" r="5" fill="#D63A2F" />
          <circle cx="63" cy="50" r="5" fill="#D63A2F" />
          <path d="M29 41 L45 46" stroke="#2B2016" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M71 41 L55 46" stroke="#2B2016" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M50 72 L50 77 M50 77 Q44 82 40 79 M50 77 Q56 82 60 79" stroke="#2B2016" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M42 75 L45.5 75 L43.8 82 Z" fill="#FFF3CF" stroke="#2B2016" strokeWidth="1" strokeLinejoin="round" />
          <path d="M54.5 75 L58 75 L56.2 82 Z" fill="#FFF3CF" stroke="#2B2016" strokeWidth="1" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="38" cy="50" r="4" fill="#2B2016" />
          <circle cx="62" cy="50" r="4" fill="#2B2016" />
          <path d="M42 80 Q50 87 58 80" stroke="#2B2016" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Role icon for the reveal card: a tinted circle holding the role's mark
 *  (wolf face, eye, shield, flask, bow, house). Colors match the role pills. */
export const ROLE_TINT: Record<Role, string> = {
  wolf: '#FBE3E0', seer: '#DBEAFE', guardian: '#D1FAE5', witch: '#EDE9FE', hunter: '#FEF3C7', villager: '#F5EED3',
};
export const ROLE_STRONG: Record<Role, string> = {
  wolf: '#D63A2F', seer: '#2E7CD6', guardian: '#0E9F6E', witch: '#7C4DBD', hunter: '#B45309', villager: '#5C4B33',
};
export function RoleIcon({ role, size = 96 }: { role: Role; size?: number }) {
  const ink = '#2B2016';
  return (
    <span className="inline-flex items-center justify-center rounded-full border-[3px]" style={{ width: size, height: size, background: ROLE_TINT[role], borderColor: ink }}>
      {role === 'wolf' ? <WolfAvatar seed="role-wolf" size={size * 0.72} state="wolf" />
      : role === 'seer' ? (
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 100 100" aria-hidden>
          <path d="M8 50 Q50 8 92 50 Q50 92 8 50 Z" fill="none" stroke="#2E7CD6" strokeWidth="7" strokeLinejoin="round" />
          <circle cx="50" cy="50" r="20" fill="#2E7CD6" />
          <circle cx="50" cy="50" r="8" fill="#FFF3CF" />
        </svg>
      ) : role === 'guardian' ? (
        <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 100 100" aria-hidden>
          <path d="M50 8 L86 22 V52 Q86 76 50 92 Q14 76 14 52 V22 Z" fill="#0E9F6E" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
          <path d="M34 50 L46 62 L68 36" fill="none" stroke="#FFF3CF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : role === 'witch' ? (
        <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 100 100" aria-hidden>
          <path d="M42 10 h16 v18 l14 26 a26 26 0 1 1 -44 0 L42 28 Z" fill="#7C4DBD" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
          <path d="M34 62 h32" stroke="#FFF3CF" strokeWidth="6" strokeLinecap="round" />
          <circle cx="42" cy="46" r="4" fill="#FFF3CF" /><circle cx="56" cy="52" r="3" fill="#FFF3CF" />
        </svg>
      ) : role === 'hunter' ? (
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r="30" fill="none" stroke="#B45309" strokeWidth="7" />
          <circle cx="50" cy="50" r="16" fill="none" stroke="#B45309" strokeWidth="6" />
          <circle cx="50" cy="50" r="5" fill="#B45309" />
          <path d="M72 28 L88 12 M88 12 h-12 M88 12 v12" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 100 100" aria-hidden>
          <path d="M14 52 L50 16 L86 52 V86 H14 Z" fill="#E9C04C" stroke={ink} strokeWidth="5" strokeLinejoin="round" />
          <rect x="40" y="62" width="20" height="24" rx="3" fill="#8A5A2B" stroke={ink} strokeWidth="4" />
        </svg>
      )}
    </span>
  );
}

/** Ma Sói landing art (mockup "Ma Sói 1"): a big cratered moon, the wolf
 *  in front of it, and the village rooftops with lit windows along the
 *  bottom of the navy hero. */
export function MoonVillage({ width = 390 }: { width?: number }) {
  const h = Math.round(width * 0.52);
  return (
    <svg width={width} height={h} viewBox={`0 0 390 ${h}`} className="block mx-auto" aria-hidden>
      <circle cx="195" cy="86" r="72" fill="#FFF3CF" />
      <circle cx="168" cy="62" r="11" fill="#EFE0B4" />
      <circle cx="214" cy="96" r="14" fill="#EFE0B4" />
      <circle cx="186" cy="112" r="7" fill="#EFE0B4" />
      <circle cx="228" cy="58" r="6" fill="#EFE0B4" />
      <g transform={`translate(${195 - 52}, 62)`}>
        <WolfAvatar seed="moon-wolf" size={104} state="wolf" />
      </g>
      {/* Village: one explicit house per shape — body + roof + window
       *  drawn together, so a window can never drift off its house. */}
      <g fill="#232344" stroke="#2B2016" strokeWidth="2" strokeLinejoin="round">
        <path d="M4 202 L4 176 L32 158 L60 176 L60 202 Z" />
        <path d="M68 202 L68 170 L93 150 L118 170 L118 202 Z" />
        <path d="M126 202 L126 178 L154 160 L182 178 L182 202 Z" />
        <path d="M190 202 L190 168 L216 148 L242 168 L242 202 Z" />
        <path d="M250 202 L250 176 L278 158 L306 176 L306 202 Z" />
        <path d="M314 202 L314 172 L343 152 L372 172 L372 202 Z" />
      </g>
      <g fill="#FFB020">
        <rect x="27" y="182" width="10" height="12" />
        <rect x="88" y="176" width="10" height="12" />
        <rect x="149" y="184" width="10" height="12" />
        <rect x="211" y="174" width="10" height="12" />
        <rect x="273" y="182" width="10" height="12" />
        <rect x="338" y="178" width="10" height="12" />
      </g>
    </svg>
  );
}
