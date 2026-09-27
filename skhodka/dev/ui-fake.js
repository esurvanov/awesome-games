// Стенд интерфейса: фейковое содержание, мир с шиной из core и плоская «сцена» на canvas (toScreen как у настоящей).
'use strict';
(() => {
const { Bus, RNG, clamp } = L.use('core');

const C = {
  ROLES: [
    { id: 'backend', title: 'Бэкенд', icon: 'server' }, { id: 'frontend', title: 'Фронтенд', icon: 'code' },
    { id: 'mobile', title: 'Мобилки', icon: 'mobile' }, { id: 'qa', title: 'Тестировщик', icon: 'bug' },
    { id: 'design', title: 'Дизайнер', icon: 'palette' }, { id: 'pm', title: 'Продакт', icon: 'briefcase' },
    { id: 'devops', title: 'Девопс', icon: 'cloud' }, { id: 'data', title: 'Данные, ML', icon: 'brain' },
    { id: 'founder', title: 'Фаундер', icon: 'rocket' }, { id: 'marketing', title: 'Маркетинг', icon: 'megaphone' },
    { id: 'hr', title: 'Рекрутер', icon: 'users' }, { id: 'gamedev', title: 'Геймдев', icon: 'gamepad' },
  ],
  TOPICS: [
    { id: 'hike', title: 'Горы', icon: 'mountain' }, { id: 'sea', title: 'Море', icon: 'sea' }, { id: 'dogs', title: 'Собаки', icon: 'dog' },
    { id: 'cats', title: 'Коты', icon: 'cat' }, { id: 'wine', title: 'Вино', icon: 'wine' }, { id: 'food', title: 'Еда', icon: 'sushi' },
    { id: 'music', title: 'Музыка', icon: 'music' }, { id: 'football', title: 'Футбол', icon: 'ball' }, { id: 'gym', title: 'Спорт', icon: 'gym' },
    { id: 'travel', title: 'Поездки', icon: 'plane' }, { id: 'flat', title: 'Жильё', icon: 'home' }, { id: 'docs', title: 'ВНЖ, банки', icon: 'passport' },
    { id: 'kids', title: 'Дети', icon: 'baby' }, { id: 'games', title: 'Игры', icon: 'gamepad' }, { id: 'lang', title: 'Языки', icon: 'language' },
  ],
  NEEDS: [
    { id: 'job', seek: { title: 'Работу', icon: 'briefcase' }, offer: { title: 'Вакансию', icon: 'briefcase' } },
    { id: 'team', seek: { title: 'Команду', icon: 'users' }, offer: { title: 'Место в команде', icon: 'userPlus' } },
    { id: 'flat', seek: { title: 'Квартиру', icon: 'home' }, offer: { title: 'Контакт риелтора', icon: 'home' } },
    { id: 'advice', seek: { title: 'Совет', icon: 'bulb' }, offer: { title: 'Опыт', icon: 'bulb' } },
    { id: 'friends', seek: { title: 'Друзей', icon: 'heart' }, offer: { title: 'Компанию', icon: 'cheers' } },
    { id: 'sport', seek: { title: 'Напарника', icon: 'run' }, offer: { title: 'Место в походе', icon: 'mountain' } },
  ],
  MINDS: [
    { id: 'talker', title: 'Болтун', icon: 'chat' }, { id: 'listener', title: 'Слушатель', icon: 'ear' },
    { id: 'nerd', title: 'Зануда', icon: 'glasses' }, { id: 'joker', title: 'Шутник', icon: 'laugh' }, { id: 'dreamer', title: 'Мечтатель', icon: 'dream' },
  ],
  MOODS: [{ id: 'up', title: 'На подъёме', icon: 'sun' }, { id: 'tired', title: 'Устал', icon: 'sleepy' }, { id: 'chill', title: 'Расслаблен', icon: 'cool' }],
  CARDS: [
    { id: 'ask-job', style: 'ask', icon: 'ask', label: 'Чем занимаешься?' }, { id: 'share-sea', style: 'share', icon: 'sea', label: 'Про море', topic: 'sea' },
    { id: 'listen', style: 'listen', icon: 'ear', label: 'Слушать' }, { id: 'joke', style: 'joke', icon: 'laugh', label: 'Пошутить' },
    { id: 'treat', style: 'treat', icon: 'cheers', label: 'Угостить пивом' }, { id: 'help-flat', style: 'help', icon: 'home', label: 'Помочь с жильём', topic: 'flat' },
    { id: 'praise', style: 'praise', icon: 'thumb', label: 'Похвалить' }, { id: 'invite', style: 'invite', icon: 'invite', label: 'Позвать в поход', topic: 'hike' },
    { id: 'contact', style: 'ask', icon: 'phone', label: 'Обменяться контактом' }, { id: 'dream', style: 'dream', icon: 'dream', label: 'Помечтать' },
  ],
  ODDBALLS: [
    { id: 'sax', title: 'Саксофонист', icon: 'sax', catch: 'Играет джаз в 23:00' }, { id: 'bday', title: 'Именинник', icon: 'cake', catch: 'Торт на всех' },
    { id: 'parrot', title: 'С попугаем', icon: 'parrot', catch: 'Попугай знает Python' }, { id: 'magic', title: 'Фокусник', icon: 'wand', catch: 'Карты из воздуха' },
    { id: 'alien', title: 'Криптан', icon: 'coin', catch: 'Всё про токены' }, { id: 'hat', title: 'В шляпе', icon: 'hat', catch: 'Шляпа не снимается' },
  ],
  EVENTS: [
    { id: 'football', title: 'Гол на экране!', icon: 'ball' }, { id: 'rain', title: 'Ливень', icon: 'rain' },
    { id: 'sax', title: 'Саксофон', icon: 'sax' }, { id: 'birthday', title: 'Торт!', icon: 'cake' },
  ],
  CHAT: { before: [
    { from: 'Орг', text: 'Суббота в Батуми 🌊 SushiGO, 19:00. Приходите знакомиться!', pin: true },
    { from: 'Вика', text: 'Буду к восьми 🙌' }, { from: 'Тимур', text: 'Футбол покажут?' }, { from: 'Орг', text: 'Покажут ⚽' },
  ] },
};

const NM = [['Вика', 'f'], ['Тимур', 'm'], ['Андрей', 'm'], ['Нино', 'f'], ['Олег', 'm'], ['Катя', 'f'], ['Гиорги', 'm'], ['Лёва', 'm'], ['Ира', 'f'], ['Макс', 'm'], ['Саша', 'f'], ['Дэн', 'm'], ['Женя', 'f'], ['Серж', 'm']];
// позиции в зале 8×15 м (как в content/layout): бар справа у входа, длинный стол слева, круглые — справа в глубине
const POS = [[5.2, 2.2], [5.9, 2.6], [6.6, 1.9], [1.1, 5.6], [2.2, 6.2], [1.0, 7.4], [2.3, 8.3], [5.0, 6.5], [6.3, 7.0], [5.4, 8.8], [6.6, 12.5], [7.0, 13.3], [2.0, 13.5], [1.6, -1.8]];
function makeWorld(seed = 3) {
  const rng = new RNG(seed), bus = new Bus(), people = new Map();
  NM.forEach(([name, sex], i) => {
    const id = 'n' + i, step = [5, 4, 4, 3, 2, 2, 1, 1, 0, 0, 0, 0, 4, 1][i];
    const topics = rng.shuffle(C.TOPICS.map(t => t.id)).slice(0, 3);
    people.set(id, {
      id, name, age: rng.int(23, 41), sex, look: { sex, style: rng.pick(['it', 'smart', 'sport', 'party']) },
      role: rng.pick(C.ROLES).id, mind: rng.pick(C.MINDS).id, mood: rng.pick(C.MOODS).id, need: rng.pick(C.NEEDS).id, offer: rng.pick(C.NEEDS).id, topics,
      oddball: i === 10 ? 'sax' : i === 12 ? 'parrot' : null,
      step, rapport: [0.9, 0.7, 0.62, 0.5, 0.35, 0.3, 0.15, 0.1, 0, 0, 0, 0, 0.66, 0.1][i],
      known: { name: step >= 1, role: step >= 2, topics: topics.slice(0, Math.max(0, step - 1)), mind: step >= 3, mood: step >= 3, need: step >= 4, offer: step >= 5 },
      x: POS[i][0], z: POS[i][1], rot: 0, pose: i === 7 ? 'wave' : i === 3 || i === 4 || i === 5 ? 'sit' : 'stand', state: 'idle',
    });
  });
  const w = {
    C, bus, people, hour: 19.67, over: false, player: { id: 'me', energy: 0.72, x: 4, z: 4 }, score: {}, log: [],
    talkId: null, _deck: 0,
    step(dt) { this.hour = Math.min(25, this.hour + dt / 180); },
    view() { return [...people.values()]; },
    deck() { const o = this._deck++ % 3; return C.CARDS.slice(o * 3, o * 3 + 4); },
    act(a) {
      this.log.push(a);
      const p = a.id ? people.get(a.id) : people.get(this.talkId);
      if (a.type === 'approach' && p) {
        this.talkId = p.id; bus.emit('talk:start', { id: p.id });
        bus.emit('talk:line', { who: p.id, text: p.step ? `О, привет! Как вечер?` : 'Привет! Мы знакомы?', mood: 'hello' });
        bus.emit('talk:cards', { cards: this.deck() });
      } else if (a.type === 'say' && p) {
        const c = C.CARDS.find(c => c.id === a.card) || { label: a.card };
        bus.emit('talk:line', { who: 'player', text: c.label });
        p.rapport = clamp(p.rapport + 0.12, 0, 1);
        const up = p.step < 5 && p.rapport > (p.step + 1) * 0.17;
        bus.emit('talk:line', { who: p.id, text: up ? 'Ха, точно! Я тоже так думаю.' : 'Ну… да, наверное.', mood: up ? 'good' : 'meh' });
        if (up) {
          p.step++; const f = ['name', 'role', 'mind', 'need', 'offer'][p.step - 1];
          p.known[f] = true; bus.emit('reveal', { id: p.id, field: f }); bus.emit('ladder', { id: p.id, step: p.step });
        }
        bus.emit('talk:cards', { cards: this.deck() });
      } else if (a.type === 'introduce') {
        bus.emit('pair', { a: a.a, b: a.b }); this.score.pairs = (this.score.pairs || 0) + 1;
      } else if (a.type === 'endTalk') {
        bus.emit('talk:end', { id: this.talkId }); this.talkId = null;
      }
    },
  };
  return w;
}

// плоская «сцена»: вид сверху-сбоку на зал 8×15, фасад внизу экрана
class FakeScene {
  constructor(canvas, w) { this.cv = canvas; this.w = w; this.g = canvas.getContext('2d'); this.resize(); addEventListener('resize', () => this.resize()); }
  resize() { const d = devicePixelRatio || 1; this.W = innerWidth; this.H = innerHeight; this.cv.width = this.W * d; this.cv.height = this.H * d; this.g.setTransform(d, 0, 0, d, 0, 0); }
  proj(x, y, z) {
    const s = Math.min(this.W / 11, this.H / 15.5);
    const depth = 1 - z / 30; // перспектива: дальше — мельче
    const cx = this.W / 2 + (x - 4) * s * depth, cy = this.H * 0.92 - (z + 2) * s * 0.78 - y * s * 0.9 * depth;
    return { x: cx, y: cy, s: s * depth };
  }
  toScreen(x, y, z) { const p = this.proj(x, y, z); return { x: p.x, y: p.y, visible: p.y > 0 && p.y < this.H && p.x > 0 && p.x < this.W }; }
  render() {
    const g = this.g, W = this.W, H = this.H;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1a0c10'); bg.addColorStop(0.6, '#3a1c14'); bg.addColorStop(1, '#241310');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const quad = (x0, z0, x1, z1, fill) => { const a = this.proj(x0, 0, z0), b = this.proj(x1, 0, z0), c = this.proj(x1, 0, z1), d = this.proj(x0, 0, z1);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fillStyle = fill; g.fill(); };
    quad(0, 0, 8, 15, '#4a2a1c'); quad(0, -3.6, 8, 0, '#2b2a24');
    quad(4.3, 0.2, 7.8, 1.2, '#f2b233'); quad(0.2, 4.4, 1.6, 12.4, '#e0a0b8'); quad(5.2, 11.4, 7.8, 14.8, '#c03a78');
    for (const [x, z] of [[5, 6], [6.5, 7.5], [5.5, 9.5]]) quad(x - 0.4, z - 0.4, x + 0.4, z + 0.4, '#2a1a14');
    g.fillStyle = 'rgba(80,110,255,.12)'; g.fillRect(0, 0, W, H * 0.25);
    const list = [...this.w.people.values()].sort((a, b) => b.z - a.z);
    for (const p of list) {
      const f = this.proj(p.x, 0, p.z), h = this.proj(p.x, p.pose === 'sit' ? 1.25 : 1.65, p.z);
      g.strokeStyle = ({ it: '#3f5fb0', smart: '#e9e1d2', sport: '#2f9a74', party: '#d94a8c' })[p.look.style] || '#888';
      g.lineWidth = f.s * 0.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(h.x, h.y + f.s * 0.2); g.stroke();
      g.fillStyle = '#e8b890'; g.beginPath(); g.arc(h.x, h.y, f.s * 0.2, 0, 7); g.fill();
    }
  }
}
window.UIFAKE = { C, makeWorld, FakeScene };
})();
