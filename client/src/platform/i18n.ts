// Hub (Sảnh) strings — the platform shell's own copy, separate from any
// game's strings so a game never has to carry the hub's words.
export type Lang = 'vi' | 'en';

const vi = {
  hubKicker: 'CHƠI CÙNG NHAU · KHÔNG CẦN CÀI ĐẶT',
  hubTitle: 'Chọn game nào?',
  hubSub: 'Tạo phòng, gửi link cho bạn bè, chơi ngay trên trình duyệt — điện thoại hay máy tính đều được.',
  cheeseName: 'Chuột Phô Mai',
  cheeseTag: 'Suy luận xã hội — một con chuột lén trộm phô mai lúc nửa đêm, cả bàn phải tìm ra nó.',
  wolfName: 'Ma Sói',
  wolfTag: 'Suy luận xã hội — tìm sói đang trà trộn giữa làng trước khi trời sáng.',
  unoName: 'Uno',
  unoTag: 'Đánh bài theo màu và số, chặn nhau tới lá cuối cùng.',
  spyName: 'Ai là Gián Điệp?',
  spyTag: 'Một người không biết từ khóa — cả bàn phải tìm ra kẻ đó.',
  players: (a: number, b: number) => `${a}–${b} người`,
  minutes: (m: number) => `~${m} phút`,
  hasVoice: 'Có voice',
  playNow: 'Chơi ngay',
  comingSoon: 'Sắp có',
  playable: '● ĐANG CHƠI ĐƯỢC',
  hubFoot: 'Game mới sẽ xuất hiện ở đây — nói với Staff game nào bạn muốn chơi tiếp theo.',
};

const en: typeof vi = {
  hubKicker: 'PLAY TOGETHER · NOTHING TO INSTALL',
  hubTitle: 'Pick a game?',
  hubSub: 'Create a room, share the link, play right in the browser — phone or computer.',
  cheeseName: 'Cheese Mouse',
  cheeseTag: 'Social deduction — one mouse steals the cheese at night, and the whole table must find it.',
  wolfName: 'Werewolf',
  wolfTag: 'Social deduction — find the wolves hiding in the village before dawn.',
  unoName: 'Uno',
  unoTag: 'Match cards by color and number, block each other to the last card.',
  spyName: "Who's the Spy?",
  spyTag: 'One player does not know the secret word — the table must find them.',
  players: (a: number, b: number) => `${a}–${b} players`,
  minutes: (m: number) => `~${m} min`,
  hasVoice: 'Voice chat',
  playNow: 'Play now',
  comingSoon: 'Coming soon',
  playable: '● PLAYABLE NOW',
  hubFoot: 'New games will appear here — tell Staff which game you want next.',
};

export const t = (lang: Lang) => (lang === 'vi' ? vi : en);
