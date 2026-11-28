/* ---------- Avatar picker (design "Chọn avatar", Nov 2026): big selected
 *  avatar, name field, 6 background colors, 12-animal grid. Saved to
 *  localStorage; the transports send it with the join so the whole table
 *  sees it (see platform/art.ts + transport/net*.ts). ---------- */
import { useState } from 'react';
import { AVATARS, AVATAR_BGS, avatarSrc, getAvatar, setAvatar } from './art';
import { t, Lang } from './i18n';

export default function AvatarPicker({ lang, onClose }: { lang: Lang; onClose: () => void }) {
  const d = t(lang);
  const cur = getAvatar();
  const [animal, setAnimal] = useState(cur.animal);
  const [bg, setBg] = useState(cur.bg);
  const [name, setName] = useState(() => sessionStorage.getItem('ct_name') || '');
  const picked = AVATARS.find(a => a.id === animal) ?? AVATARS[0];
  const save = () => {
    setAvatar({ animal, bg });
    if (name.trim()) sessionStorage.setItem('ct_name', name.trim());
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 bg-[#14142B] overflow-y-auto">
      <div className="max-w-3xl lg:max-w-5xl mx-auto px-4 py-4 text-[#FFF3CF]">
        <div className="flex items-center gap-3">
          <button className="disp font-extrabold text-[#FFF3CF] text-sm bg-[#23233F] border-2 border-[#3D3D63] rounded-full px-3 py-2.5 push" onClick={onClose}>← {d.back}</button>
          <h2 className="disp font-extrabold text-2xl sm:text-3xl">{d.pickAvatar}</h2>
        </div>
        <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-8 mt-5">
          <div className="text-center">
            <span className="inline-block rounded-full border-4 border-[#FFB020] overflow-hidden anim-pop" style={{ background: bg }}>
              <img src={avatarSrc(animal)} alt={picked.vi} width={150} height={150} className="block" style={{ width: 150, height: 150 }} draggable={false} />
            </span>
            <input className="w-full max-w-[280px] mx-auto block px-4 py-3 font-bold mt-4 text-center bg-[#23233F] border-2 border-[#3D3D63] rounded-2xl text-[#FFF3CF] placeholder:text-[#7C83B8]" placeholder={d.yourName}
              value={name} maxLength={20} onChange={e => setName(e.target.value)} />
            <p className="text-[#B9BCE0] font-bold text-sm mt-2 leading-snug">{d.avatarHint}</p>
            <div className="disp font-extrabold tracking-[0.18em] text-[11px] text-[#FFB020] mt-4">{d.avatarBg}</div>
            <div className="flex justify-center gap-2 mt-2">
              {AVATAR_BGS.map(c => (
                <button key={c} aria-label={c} onClick={() => setBg(c)}
                  className={`w-10 h-10 rounded-full border-2 push ${bg === c ? 'border-[#FFB020] ring-4 ring-[#FFB020]/40 scale-110' : 'border-[#2B2016]'}`}
                  style={{ background: c }} />
              ))}
            </div>
            <button className="disp px-5 py-3 rounded-2xl font-extrabold hard push bg-[#FFB020] text-[#2B2016] text-lg w-full max-w-[280px] mt-5" onClick={save}>{d.saveAvatar}</button>
          </div>
          <div className="mt-6 lg:mt-0">
            <h3 className="disp font-extrabold text-xl text-center lg:text-left">{d.chooseAnimal}</h3>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 mt-3">
              {AVATARS.map(a => (
                <button key={a.id} onClick={() => { setAnimal(a.id); setBg(a.bg); }}
                  className={`rounded-3xl p-2 push ${animal === a.id ? 'bg-[#FFB020]/20 ring-4 ring-[#FFB020]' : 'bg-[#23233F] border-2 border-[#3D3D63]'}`}>
                  <img src={avatarSrc(a.id)} alt={lang === 'vi' ? a.vi : a.en} width={72} height={72} className="rounded-full mx-auto block border-2 border-[#2B2016]" style={{ width: 72, height: 72, background: a.bg }} draggable={false} />
                  <span className={`block font-bold text-sm mt-1.5 text-center ${animal === a.id ? 'text-[#FFB020]' : 'text-[#FFF3CF]'}`}>{lang === 'vi' ? a.vi : a.en}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
