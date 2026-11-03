// 給店員看: the Korean phrases of the 韓文卡 panel (ui/phrase-cards.js shows them). Static, no private data, no network.
// Each phrase: ko (what the staff reads), zh (what the group reads), rr (Revised Romanization, for saying it out loud).
// The groups and their order are fixed: 基本, 購物, 餐廳, 交通.
export const PHRASE_GROUPS = Object.freeze([
  {
    id: 'basic',
    title: '基本',
    phrases: [
      { ko: '저기요', zh: '不好意思（叫人）', rr: 'jeogiyo' },
      { ko: '감사합니다', zh: '謝謝', rr: 'gamsahamnida' },
      { ko: '이거 주세요', zh: '我要這個', rr: 'igeo juseyo' },
      { ko: '괜찮아요', zh: '沒關係、不用了', rr: 'gwaenchanayo' },
    ],
  },
  {
    id: 'shop',
    title: '購物',
    phrases: [
      { ko: '이거 얼마예요?', zh: '這個多少錢？', rr: 'igeo eolmayeyo?' },
      { ko: '한번 써 봐도 돼요?', zh: '可以試用看看嗎？', rr: 'hanbeon sseo bwado dwaeyo?' },
      { ko: '입어 봐도 돼요?', zh: '可以試穿嗎？', rr: 'ibeo bwado dwaeyo?' },
      { ko: '다른 사이즈 있어요?', zh: '有別的尺寸嗎？', rr: 'dareun saijeu isseoyo?' },
      { ko: '다른 색 있어요?', zh: '有別的顏色嗎？', rr: 'dareun saek isseoyo?' },
      { ko: '카드 돼요?', zh: '可以刷卡嗎？', rr: 'kadeu dwaeyo?' },
      { ko: '면세 돼요?', zh: '可以退稅嗎？', rr: 'myeonse dwaeyo?' },
      { ko: '봉투 주세요', zh: '請給我袋子', rr: 'bongtu juseyo' },
    ],
  },
  {
    id: 'eat',
    title: '餐廳',
    phrases: [
      { ko: '다섯 명이에요', zh: '我們五個人', rr: 'daseot myeong-ieyo' },
      { ko: '메뉴판 주세요', zh: '請給我菜單', rr: 'menyupan juseyo' },
      { ko: '덜 맵게 해 주세요', zh: '請做不那麼辣', rr: 'deol maepge hae juseyo' },
      { ko: '물 좀 주세요', zh: '請給我水', rr: 'mul jom juseyo' },
      { ko: '포장돼요?', zh: '可以外帶嗎？', rr: 'pojang-dwaeyo?' },
      { ko: '계산해 주세요', zh: '請幫我結帳', rr: 'gyesanhae juseyo' },
    ],
  },
  {
    id: 'move',
    title: '交通',
    phrases: [
      { ko: '여기로 가 주세요', zh: '請載我到這裡', rr: 'yeogiro ga juseyo' },
    ],
  },
]);
